import { Router } from "express";
import { ObjectId } from "mongodb";
import { Collections, getDB } from "../db.js";
import { embed, rerank } from "../voyage.js";

const router = Router();

const ATLAS_SEARCH_INDEX =
  process.env.ATLAS_SEARCH_INDEX || "articles_search";
const ATLAS_VECTOR_INDEX =
  process.env.ATLAS_VECTOR_INDEX || "chunks_vector";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function workspaceFilter(workspaceId) {
  return workspaceId ? { workspaceId: new ObjectId(workspaceId) } : {};
}

async function recordHistory({ userId, workspaceId, query, type, count }) {
  try {
    await getDB().collection(Collections.searchHistory).insertOne({
      userId: userId ? new ObjectId(userId) : null,
      workspaceId: workspaceId ? new ObjectId(workspaceId) : null,
      query,
      type,
      resultsCount: count,
      createdAt: new Date(),
    });
  } catch {
    // history is non-critical
  }
}

/* -------------------------------------------------------------------------- */
/* 1. Keyword search via Atlas Search ($search)                               */
/* -------------------------------------------------------------------------- */
/**
 * Demonstrates Atlas Search:
 *  - `text` operator for full-text matching with fuzzy tolerance
 *  - `compound.should` to boost title hits over body hits
 *  - `highlight` to return matched snippets
 *  - `$meta: searchScore` to expose the BM25-style relevance score
 */
router.post("/keyword", async (req, res, next) => {
  try {
    const { query, workspaceId, limit = 10, userId } = req.body;
    if (!query) return res.status(400).json({ error: "query is required" });

    const pipeline = [
      {
        $search: {
          index: ATLAS_SEARCH_INDEX,
          compound: {
            should: [
              {
                text: {
                  query,
                  path: "title",
                  score: { boost: { value: 3 } },
                  fuzzy: { maxEdits: 1 },
                },
              },
              {
                text: {
                  query,
                  path: "content",
                  fuzzy: { maxEdits: 1 },
                },
              },
              {
                text: {
                  query,
                  path: "tags",
                  score: { boost: { value: 2 } },
                },
              },
            ],
            minimumShouldMatch: 1,
          },
          highlight: { path: ["title", "content"] },
        },
      },
      { $match: workspaceFilter(workspaceId) },
      {
        $project: {
          title: 1,
          summary: 1,
          tags: 1,
          category: 1,
          workspaceId: 1,
          updatedAt: 1,
          score: { $meta: "searchScore" },
          highlights: { $meta: "searchHighlights" },
        },
      },
      { $limit: limit },
    ];

    const results = await getDB()
      .collection(Collections.articles)
      .aggregate(pipeline)
      .toArray();

    await recordHistory({
      userId,
      workspaceId,
      query,
      type: "keyword",
      count: results.length,
    });

    res.json({ type: "keyword", query, results });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* 2. Semantic search via Atlas Vector Search ($vectorSearch)                 */
/* -------------------------------------------------------------------------- */
/**
 * Uses chunk-level embeddings and groups results back to the parent article.
 * Voyage's `query` input_type produces vectors tuned for retrieval queries.
 */
router.post("/semantic", async (req, res, next) => {
  try {
    const {
      query,
      workspaceId,
      limit = 10,
      numCandidates = 100,
      userId,
      withRerank = false,
    } = req.body;

    if (!query) return res.status(400).json({ error: "query is required" });

    const [qVector] = await embed(query, "query");

    const filter = workspaceId
      ? { workspaceId: new ObjectId(workspaceId) }
      : undefined;

    const pipeline = [
      {
        $vectorSearch: {
          index: ATLAS_VECTOR_INDEX,
          path: "embedding",
          queryVector: qVector,
          numCandidates,
          limit: limit * 3, // grab extra chunks; we'll dedupe by article
          ...(filter ? { filter } : {}),
        },
      },
      {
        $project: {
          articleId: 1,
          chunkIndex: 1,
          text: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
      // Group: keep the best-scoring chunk per article.
      { $sort: { score: -1 } },
      {
        $group: {
          _id: "$articleId",
          score: { $first: "$score" },
          bestChunk: { $first: "$text" },
          chunkIndex: { $first: "$chunkIndex" },
        },
      },
      { $sort: { score: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: Collections.articles,
          localField: "_id",
          foreignField: "_id",
          as: "article",
        },
      },
      { $unwind: "$article" },
      {
        $project: {
          _id: "$article._id",
          title: "$article.title",
          summary: "$article.summary",
          tags: "$article.tags",
          category: "$article.category",
          workspaceId: "$article.workspaceId",
          updatedAt: "$article.updatedAt",
          bestChunk: 1,
          chunkIndex: 1,
          score: 1,
        },
      },
    ];

    let results = await getDB()
      .collection(Collections.chunks)
      .aggregate(pipeline)
      .toArray();

    // Optional Voyage rerank pass for higher precision.
    if (withRerank && results.length > 0) {
      const passages = results.map((r) => `${r.title}\n${r.bestChunk}`);
      const ranked = await rerank(query, passages, results.length);
      results = ranked.map((r) => ({
        ...results[r.index],
        rerankScore: r.relevance_score,
      }));
    }

    await recordHistory({
      userId,
      workspaceId,
      query,
      type: withRerank ? "semantic+rerank" : "semantic",
      count: results.length,
    });

    res.json({ type: "semantic", query, withRerank, results });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* 3. Hybrid search — Reciprocal Rank Fusion                                  */
/* -------------------------------------------------------------------------- */
/**
 * Combines Atlas Search (keyword) with Vector Search (semantic) using
 * Reciprocal Rank Fusion. RRF is robust because it ignores raw scores
 * (which live on different scales) and only looks at rank position.
 *
 *     rrf_score(doc) = sum over rankers of  1 / (k + rank_i(doc))
 *
 * MongoDB 8.1+ also offers $rankFusion as a single stage; we implement it
 * explicitly here so the article reader can see what is going on.
 */
router.post("/hybrid", async (req, res, next) => {
  try {
    const {
      query,
      workspaceId,
      limit = 10,
      k = 60, // RRF damping constant — 60 is the value in the original paper
      userId,
    } = req.body;

    if (!query) return res.status(400).json({ error: "query is required" });

    const db = getDB();

    // -- Keyword ranks (article _id -> rank) ---------------------------------
    const keywordHits = await db
      .collection(Collections.articles)
      .aggregate([
        {
          $search: {
            index: ATLAS_SEARCH_INDEX,
            compound: {
              should: [
                {
                  text: {
                    query,
                    path: "title",
                    score: { boost: { value: 3 } },
                  },
                },
                { text: { query, path: "content" } },
                { text: { query, path: "tags" } },
              ],
            },
          },
        },
        { $match: workspaceFilter(workspaceId) },
        { $limit: 50 },
        { $project: { _id: 1, score: { $meta: "searchScore" } } },
      ])
      .toArray();

    // -- Semantic ranks ------------------------------------------------------
    const [qVector] = await embed(query, "query");
    const vectorFilter = workspaceId
      ? { workspaceId: new ObjectId(workspaceId) }
      : undefined;

    const semanticHits = await db
      .collection(Collections.chunks)
      .aggregate([
        {
          $vectorSearch: {
            index: ATLAS_VECTOR_INDEX,
            path: "embedding",
            queryVector: qVector,
            numCandidates: 150,
            limit: 50,
            ...(vectorFilter ? { filter: vectorFilter } : {}),
          },
        },
        { $project: { articleId: 1, score: { $meta: "vectorSearchScore" } } },
        { $sort: { score: -1 } },
        {
          $group: {
            _id: "$articleId",
            score: { $first: "$score" },
          },
        },
      ])
      .toArray();

    // -- Fuse via RRF --------------------------------------------------------
    const rrf = new Map();

    const accumulate = (hits) => {
      hits.forEach((hit, idx) => {
        const id = hit._id.toString();
        const prev = rrf.get(id) ?? { id, score: 0 };
        prev.score += 1 / (k + idx + 1);
        rrf.set(id, prev);
      });
    };

    accumulate(keywordHits);
    accumulate(semanticHits);

    const fused = [...rrf.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (fused.length === 0) {
      await recordHistory({ userId, workspaceId, query, type: "hybrid", count: 0 });
      return res.json({ type: "hybrid", query, results: [] });
    }

    const ids = fused.map((r) => new ObjectId(r.id));
    const articles = await db
      .collection(Collections.articles)
      .find(
        { _id: { $in: ids } },
        { projection: { content: 0 } },
      )
      .toArray();

    const byId = new Map(articles.map((a) => [a._id.toString(), a]));
    const results = fused
      .map((r) => {
        const a = byId.get(r.id);
        return a ? { ...a, rrfScore: r.score } : null;
      })
      .filter(Boolean);

    await recordHistory({
      userId,
      workspaceId,
      query,
      type: "hybrid",
      count: results.length,
    });

    res.json({ type: "hybrid", query, results });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* 4. AI answer — retrieve top chunks, return as context                      */
/* -------------------------------------------------------------------------- */
/**
 * Returns the top chunks for a question along with their source articles.
 * The frontend (or another service) can pass these into an LLM as RAG context.
 * Keeping the LLM call out of this lab keeps the dependency surface small.
 */
router.post("/ask", async (req, res, next) => {
  try {
    const { question, workspaceId, topK = 5 } = req.body;
    if (!question)
      return res.status(400).json({ error: "question is required" });

    const [qVector] = await embed(question, "query");

    const vectorFilter = workspaceId
      ? { workspaceId: new ObjectId(workspaceId) }
      : undefined;

    const chunks = await getDB()
      .collection(Collections.chunks)
      .aggregate([
        {
          $vectorSearch: {
            index: ATLAS_VECTOR_INDEX,
            path: "embedding",
            queryVector: qVector,
            numCandidates: 100,
            limit: topK * 4,
            ...(vectorFilter ? { filter: vectorFilter } : {}),
          },
        },
        {
          $project: {
            articleId: 1,
            text: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
        {
          $lookup: {
            from: Collections.articles,
            localField: "articleId",
            foreignField: "_id",
            as: "article",
          },
        },
        { $unwind: "$article" },
        {
          $project: {
            articleId: 1,
            text: 1,
            score: 1,
            title: "$article.title",
            tags: "$article.tags",
          },
        },
      ])
      .toArray();

    // Rerank for precision.
    let context = chunks;
    if (chunks.length > 0) {
      const passages = chunks.map((c) => `${c.title}\n${c.text}`);
      const ranked = await rerank(question, passages, topK);
      context = ranked.map((r) => ({
        ...chunks[r.index],
        rerankScore: r.relevance_score,
      }));
    }

    res.json({
      question,
      context,
      // The frontend can now feed `context` to an LLM. Showing the raw
      // passages also makes the lab inspectable.
    });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* 5. Smart search — what the UI actually calls                               */
/* -------------------------------------------------------------------------- */
/**
 * The single endpoint a real knowledge-base UI should call. Composes:
 *
 *   1. Keyword search on articles (Atlas Search) → expand to all their chunks
 *   2. Vector search on chunks (Atlas Vector Search)
 *   3. RRF fuse the two ranked lists of CHUNK ids
 *   4. Rerank the fused top-N chunks with Voyage rerank-2
 *   5. Return the top results enriched with article metadata
 *
 * The user never sees this pipeline — they just type and get answers.
 * The /keyword, /semantic, /hybrid and /ask endpoints remain for the
 * article (and curl demos) to expose what is happening internally.
 */
router.post("/smart", async (req, res, next) => {
  try {
    const { query, workspaceId, limit = 10, userId, k = 60 } = req.body;
    if (!query) return res.status(400).json({ error: "query is required" });

    const db = getDB();
    const wsId = workspaceId ? new ObjectId(workspaceId) : null;

    // ── 1 & 2: keyword on ARTICLES and semantic on CHUNKS, in parallel ─────
    const [qVector] = await embed(query, "query");

    const [keywordArticles, semanticChunks] = await Promise.all([
      // Keyword search returns ranked article ids — we DO NOT expand to all
      // their chunks (that would pollute the fusion with off-topic chunks
      // from articles that happened to match in keyword).
      db.collection(Collections.articles)
        .aggregate([
          {
            $search: {
              index: ATLAS_SEARCH_INDEX,
              compound: {
                should: [
                  { text: { query, path: "title", score: { boost: { value: 3 } } } },
                  { text: { query, path: "content" } },
                  { text: { query, path: "tags", score: { boost: { value: 2 } } } },
                ],
              },
            },
          },
          ...(wsId ? [{ $match: { workspaceId: wsId } }] : []),
          { $limit: 30 },
          { $project: { _id: 1 } },
        ])
        .toArray(),

      // Semantic search at chunk level — this is the meat of the result.
      db.collection(Collections.chunks)
        .aggregate([
          {
            $vectorSearch: {
              index: ATLAS_VECTOR_INDEX,
              path: "embedding",
              queryVector: qVector,
              numCandidates: 200,
              limit: 50,
              ...(wsId ? { filter: { workspaceId: wsId } } : {}),
            },
          },
          {
            $project: {
              _id: 1,
              articleId: 1,
              chunkIndex: 1,
              text: 1,
              score: { $meta: "vectorSearchScore" },
            },
          },
        ])
        .toArray(),
    ]);

    if (semanticChunks.length === 0) {
      await recordHistory({ userId, workspaceId, query, type: "smart", count: 0 });
      return res.json({ query, results: [] });
    }

    // ── 3: RRF fuse — but anchored on CHUNKS, with keyword as a BOOST ───────
    //
    // For each semantic chunk, we add 1/(k+rank). If the chunk's parent
    // article also appears in the keyword ranking, we add the keyword
    // boost as well. This way keyword pulls related chunks UP without
    // injecting unrelated chunks from keyword-matching articles.
    const keywordArticleRank = new Map();
    keywordArticles.forEach((art, idx) => {
      keywordArticleRank.set(art._id.toString(), idx);
    });

    const fused = semanticChunks.map((chunk, idx) => {
      let score = 1 / (k + idx + 1);
      const kwRank = keywordArticleRank.get(chunk.articleId.toString());
      if (kwRank !== undefined) {
        score += 1 / (k + kwRank + 1);
      }
      return { ...chunk, rrfScore: score, kwMatch: kwRank !== undefined };
    });

    fused.sort((a, b) => b.rrfScore - a.rrfScore);
    const top = fused.slice(0, 20);

    // ── 4: hydrate with article metadata ───────────────────────────────────
    const articleIds = [...new Set(top.map((c) => c.articleId.toString()))]
      .map((id) => new ObjectId(id));
    const articles = await db
      .collection(Collections.articles)
      .find({ _id: { $in: articleIds } })
      .project({ title: 1, summary: 1, tags: 1, category: 1 })
      .toArray();
    const articleById = new Map(articles.map((a) => [a._id.toString(), a]));

    const enriched = top
      .map((c) => {
        const art = articleById.get(c.articleId.toString());
        return art
          ? {
              _id: c._id,
              articleId: c.articleId,
              chunkIndex: c.chunkIndex,
              text: c.text,
              title: art.title,
              summary: art.summary,
              tags: art.tags,
              category: art.category,
              rrfScore: c.rrfScore,
              kwMatch: c.kwMatch,
            }
          : null;
      })
      .filter(Boolean);

    // ── 5: Voyage rerank for the final ordering ─────────────────────────────
    const passages = enriched.map((c) => `${c.title}\n${c.text}`);
    const reranked = await rerank(query, passages, Math.min(limit, enriched.length));

    const results = reranked.map((r) => ({
      ...enriched[r.index],
      rerankScore: r.relevance_score,
    }));

    await recordHistory({
      userId,
      workspaceId,
      query,
      type: "smart",
      count: results.length,
    });

    res.json({ query, results });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* 6. Search history                                                          */
/* -------------------------------------------------------------------------- */
router.get("/history", async (req, res, next) => {
  try {
    const { userId, workspaceId, limit = 20 } = req.query;
    const filter = {};
    if (userId) filter.userId = new ObjectId(userId);
    if (workspaceId) filter.workspaceId = new ObjectId(workspaceId);

    const history = await getDB()
      .collection(Collections.searchHistory)
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .toArray();
    res.json(history);
  } catch (err) {
    next(err);
  }
});

export default router;
