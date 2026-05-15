import { Router } from "express";
import { ObjectId } from "mongodb";
import { Collections, getDB } from "../db.js";
import { embed, rerank } from "../voyage.js";
import { streamChat } from "../llm.js";

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
/**
 * The retrieval pipeline behind both /smart (returns JSON) and /chat
 * (returns the same passages and then streams an LLM answer using them).
 *
 *   1. Keyword search on articles (Atlas Search) → ranked article ids
 *   2. Vector search on chunks (Atlas Vector Search) → ranked chunk ids
 *   3. RRF fuse — anchored on chunks; keyword adds a BOOST when the chunk's
 *      parent article also matches in keyword. This avoids polluting the
 *      ranking with every chunk from every keyword-matching article.
 *   4. Hydrate with article metadata via $lookup
 *   5. Voyage rerank-2 for the final ordering
 */
export async function smartRetrieve(query, workspaceId, limit = 10, k = 60) {
  const db = getDB();
  const wsId = workspaceId ? new ObjectId(workspaceId) : null;

  const [qVector] = await embed(query, "query");

  const [keywordArticles, semanticChunks] = await Promise.all([
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

  if (semanticChunks.length === 0) return [];

  // RRF fusion anchored on chunks, keyword as boost.
  const keywordArticleRank = new Map();
  keywordArticles.forEach((art, idx) =>
    keywordArticleRank.set(art._id.toString(), idx),
  );

  const fused = semanticChunks
    .map((chunk, idx) => {
      let score = 1 / (k + idx + 1);
      const kwRank = keywordArticleRank.get(chunk.articleId.toString());
      if (kwRank !== undefined) score += 1 / (k + kwRank + 1);
      return { ...chunk, rrfScore: score, kwMatch: kwRank !== undefined };
    })
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, 20);

  const articleIds = [...new Set(fused.map((c) => c.articleId.toString()))]
    .map((id) => new ObjectId(id));

  const articles = await db
    .collection(Collections.articles)
    .find({ _id: { $in: articleIds } })
    .project({ title: 1, summary: 1, tags: 1, category: 1 })
    .toArray();

  const articleById = new Map(articles.map((a) => [a._id.toString(), a]));

  const enriched = fused
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

  if (enriched.length === 0) return [];

  const passages = enriched.map((c) => `${c.title}\n${c.text}`);
  const reranked = await rerank(query, passages, Math.min(limit, enriched.length));

  return reranked.map((r) => ({
    ...enriched[r.index],
    rerankScore: r.relevance_score,
  }));
}

router.post("/smart", async (req, res, next) => {
  try {
    const { query, workspaceId, limit = 10, userId, k = 60 } = req.body;
    if (!query) return res.status(400).json({ error: "query is required" });

    const results = await smartRetrieve(query, workspaceId, limit, k);

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
/* 6. Chat — RAG with streaming LLM answer                                    */
/* -------------------------------------------------------------------------- */
/**
 * The full RAG experience. Same retrieval as /smart, then plugs the top
 * passages into an LLM (OpenAI by default) and streams the answer back.
 *
 * Protocol: NDJSON (newline-delimited JSON) so the frontend can parse it
 * with a simple fetch + ReadableStream. Three event kinds:
 *
 *   {"event":"passages","passages":[...]}     // fired once, up front
 *   {"event":"token","text":"...chunk..."}    // fired N times
 *   {"event":"done","model":"gpt-4o-mini"}    // fired once, at the end
 *   {"event":"error","message":"..."}         // only if something failed mid-stream
 */
router.post("/chat", async (req, res, next) => {
  const { question, workspaceId, limit = 5, userId, k = 60 } = req.body;
  if (!question) return res.status(400).json({ error: "question is required" });

  let streamStarted = false;

  try {
    const passages = await smartRetrieve(question, workspaceId, limit, k);

    // Open NDJSON stream.
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering if behind nginx
    res.flushHeaders?.();
    streamStarted = true;

    const send = (event, data) => {
      res.write(JSON.stringify({ event, ...data }) + "\n");
    };

    send("passages", { passages });

    if (passages.length === 0) {
      send("token", {
        text:
          "I could not find any passages in the knowledge base that match your question. " +
          "Try rephrasing it or seeding more content.",
      });
      send("done", { model: null });
      await recordHistory({ userId, workspaceId, query: question, type: "chat", count: 0 });
      return res.end();
    }

    const context = passages
      .map((p, i) => `[${i + 1}] ${p.title}\n${p.text}`)
      .join("\n\n---\n\n");

    const system = [
      "You are a helpful assistant answering questions using ONLY the passages",
      "provided below. Cite the passages you used as bracketed numbers like [1] or [2].",
      "If the passages do not contain enough information to answer, say so honestly.",
      "Reply in the same language as the user's question.",
      "Be concise: 2 to 5 sentences unless the user asks for detail.",
    ].join(" ");

    const userPrompt = `Passages:\n\n${context}\n\nQuestion: ${question}`;

    const { model } = await streamChat({
      system,
      user: userPrompt,
      onToken: (text) => send("token", { text }),
    });

    send("done", { model });
    res.end();

    await recordHistory({
      userId,
      workspaceId,
      query: question,
      type: "chat",
      count: passages.length,
    });
  } catch (err) {
    if (!streamStarted) return next(err);
    try {
      res.write(JSON.stringify({ event: "error", message: err.message }) + "\n");
    } catch {}
    res.end();
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
