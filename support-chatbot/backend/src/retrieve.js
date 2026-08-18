/**
 * Retrieval: three rankers over two corpora, fused with RRF, then reranked.
 *
 *   1. $search      BM25 over kb_articles          weight 0.7  (boost)
 *   2. $vectorSearch over kb_chunks                weight 1.0  (primary)
 *   3. $vectorSearch over tickets (resolved only)  weight 0.5  (weak evidence)
 *
 * This is the same machinery as the `knowledge-base` lab. What changes in a
 * support agent is not the retrieval -- it is what the corpus contains and
 * who is allowed to see it.
 */
import { ObjectId } from "mongodb";
import { Collections, getDB } from "./db.js";
import { embed, rerank } from "./voyage.js";
import { tuning, audienceFor, confidenceBand } from "./config.js";

const ATLAS_SEARCH_INDEX = () => process.env.ATLAS_SEARCH_INDEX || "kb_articles_search";
const ATLAS_VECTOR_INDEX = () => process.env.ATLAS_VECTOR_INDEX || "kb_chunks_vector";
const ATLAS_TICKETS_INDEX = () => process.env.ATLAS_TICKETS_INDEX || "tickets_vector";

/**
 * Builds the `filter` sub-document for $vectorSearch over kb_chunks.
 *
 * THIS IS AUTHORIZATION, NOT METADATA.
 *
 * A Free-plan customer must never be answered out of an Enterprise-only
 * runbook. The guarantee for that is this pre-filter, evaluated inside the
 * vector index: an Enterprise passage is never scored, never ranked, never
 * reaches the reranker, and cannot appear in the prompt.
 *
 * The tempting alternative -- retrieve everything, then instruct the model
 * "only use passages the customer is entitled to see" -- is not a control.
 * It is a request, addressed to a component whose entire job is to be
 * agreeable, evaluated after the restricted text is already in the context
 * window. The moment it is in the prompt, it is one clever question away from
 * being in the answer.
 *
 * Post-filtering after $vectorSearch is better than a prompt instruction and
 * still wrong: `limit` is applied by the index, so filtering afterwards
 * silently shrinks the result set. Ten Enterprise hits and the Free customer
 * gets an empty page -- correct on paper, broken in the product.
 *
 * @param {{plan?: string, locale?: string}} customer
 */
export function entitlementFilter(customer = {}) {
  const filter = {
    audience: { $in: audienceFor(customer.plan) },
    status: { $eq: "published" },
  };
  if (customer.locale) filter.locale = { $eq: customer.locale };
  return filter;
}

/**
 * Exponential recency decay for ticket evidence.
 *
 * A resolution that worked eighteen months ago may describe a console screen
 * that no longer exists. Halving the contribution every `ticketHalfLifeDays`
 * lets an old ticket still win when nothing else matches, while a fresh
 * document outranks it whenever one exists.
 */
export function recencyDecay(resolvedAt, now = new Date()) {
  if (!resolvedAt) return 0.5; // unknown age: assume one half-life
  const ageDays = (now.getTime() - new Date(resolvedAt).getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / tuning.ticketHalfLifeDays);
}

/**
 * Weighted Reciprocal Rank Fusion.
 *
 *   score(doc) = sum over rankers of  weight_r * 1 / (k + rank_r(doc))
 *
 * RRF fuses by RANK, never by raw score, because the three rankers produce
 * numbers on incomparable scales: BM25 is unbounded, cosine similarity sits
 * in [0,1], and normalising them against each other means inventing a
 * conversion nobody can defend.
 *
 * MongoDB 8.1+ ships `$rankFusion` as a single aggregation stage that does
 * this server-side. It is implemented explicitly here so the article reader
 * can see the arithmetic -- in production on 8.1+, prefer the native stage.
 */
export function fuseRRF(rankedLists, k = tuning.rrfK) {
  const fused = new Map();

  for (const { items, weight, key, multiplier } of rankedLists) {
    items.forEach((item, idx) => {
      const id = key(item);
      const contribution =
        (weight * (multiplier ? multiplier(item) : 1)) / (k + idx + 1);

      const prev = fused.get(id);
      if (prev) {
        prev.score += contribution;
        prev.rankers.push(item.__ranker);
      } else {
        fused.set(id, { id, item, score: contribution, rankers: [item.__ranker] });
      }
    });
  }

  return [...fused.values()].sort((a, b) => b.score - a.score);
}

/* -------------------------------------------------------------------------- */
/* Rankers                                                                    */
/* -------------------------------------------------------------------------- */

async function keywordArticles(query, customer) {
  const db = getDB();
  return db
    .collection(Collections.kbArticles)
    .aggregate([
      {
        $search: {
          index: ATLAS_SEARCH_INDEX(),
          compound: {
            should: [
              { text: { query, path: "title", score: { boost: { value: 3 } } } },
              { text: { query, path: "content" } },
              { text: { query, path: "tags", score: { boost: { value: 2 } } } },
            ],
            // Entitlement is re-stated here as a compound filter. $search has
            // no `filter` field like $vectorSearch does, so the restriction
            // has to be part of the query itself -- still evaluated by the
            // index, still before any document reaches us.
            filter: [
              { in: { path: "audience", value: audienceFor(customer.plan) } },
              { text: { query: "published", path: "status" } },
            ],
            minimumShouldMatch: 1,
          },
        },
      },
      { $limit: tuning.keywordLimit },
      { $project: { _id: 1, title: 1, score: { $meta: "searchScore" } } },
    ])
    .toArray();
}

async function semanticChunks(queryVector, customer) {
  const db = getDB();
  return db
    .collection(Collections.kbChunks)
    .aggregate([
      {
        $vectorSearch: {
          index: ATLAS_VECTOR_INDEX(),
          path: "embedding",
          queryVector,
          numCandidates: tuning.vectorNumCandidates,
          limit: tuning.vectorLimit,
          filter: entitlementFilter(customer),
        },
      },
      {
        $project: {
          _id: 1,
          articleId: 1,
          chunkIndex: 1,
          breadcrumb: 1,
          text: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ])
    .toArray();
}

async function semanticTickets(queryVector, customer) {
  const db = getDB();
  return db
    .collection(Collections.tickets)
    .aggregate([
      {
        $vectorSearch: {
          index: ATLAS_TICKETS_INDEX(),
          path: "embedding",
          queryVector,
          numCandidates: tuning.vectorNumCandidates,
          limit: tuning.ticketLimit,
          // Only resolved, only high quality, only the customer's locale.
          // A ticket corpus that includes unresolved threads or bad answers
          // reproduces past mistakes at scale, in the confident register of
          // a closed case.
          filter: {
            status: { $eq: "resolved" },
            quality: { $gte: tuning.ticketMinQuality },
            ...(customer.locale ? { locale: { $eq: customer.locale } } : {}),
          },
        },
      },
      {
        $project: {
          _id: 1,
          subject: 1,
          problem: 1,
          resolution: 1,
          quality: 1,
          resolvedAt: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ])
    .toArray();
}

/* -------------------------------------------------------------------------- */
/* Orchestration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Runs the full retrieval pipeline for one turn.
 *
 * @param {{
 *   condensedQuestion: string,
 *   originalMessage: string,
 *   customer: object,
 * }} input
 * @returns {Promise<{passages: object[], confidence: string, topScore: number|null, stats: object}>}
 */
export async function retrievePassages({ condensedQuestion, originalMessage, customer = {} }) {
  // EMBED THE CONDENSED QUESTION. The rewrite exists precisely so the vector
  // is computed from a self-contained sentence rather than from "and how much
  // is that?", which embeds to nothing useful.
  const [queryVector] = await embed(condensedQuestion, "query");

  const [articles, chunks, tickets] = await Promise.all([
    keywordArticles(condensedQuestion, customer),
    semanticChunks(queryVector, customer),
    semanticTickets(queryVector, customer),
  ]);

  // Keyword hits are article-level; the other two rankers are passage-level.
  // Expanding every keyword article into all of its chunks would let one
  // long article flood the fused list, so the keyword ranker contributes a
  // BOOST to chunks whose parent article matched, not entries of its own.
  const keywordRankByArticle = new Map();
  articles.forEach((a, idx) => keywordRankByArticle.set(a._id.toString(), idx));

  const chunkItems = chunks.map((c) => ({ ...c, __ranker: "kb" }));
  const ticketItems = tickets.map((t) => ({ ...t, __ranker: "ticket" }));

  const fused = fuseRRF([
    {
      items: chunkItems,
      weight: tuning.weights.kbChunks,
      key: (c) => `kb:${c._id}`,
    },
    {
      items: ticketItems,
      weight: tuning.weights.tickets,
      key: (t) => `ticket:${t._id}`,
      multiplier: (t) => recencyDecay(t.resolvedAt),
    },
  ]);

  // Apply the keyword boost to fused chunk entries.
  for (const entry of fused) {
    if (entry.item.__ranker !== "kb") continue;
    const kwRank = keywordRankByArticle.get(entry.item.articleId?.toString());
    if (kwRank === undefined) continue;
    entry.score += tuning.weights.kbArticles / (tuning.rrfK + kwRank + 1);
    entry.rankers.push("kw");
  }
  fused.sort((a, b) => b.score - a.score);

  const shortlist = fused.slice(0, tuning.rerankShortlist);
  if (shortlist.length === 0) {
    return {
      passages: [],
      confidence: "none",
      topScore: null,
      stats: { articles: articles.length, chunks: chunks.length, tickets: tickets.length },
    };
  }

  // Hydrate chunk entries with their parent article's title.
  const articleIds = [
    ...new Set(
      shortlist
        .filter((e) => e.item.__ranker === "kb" && e.item.articleId)
        .map((e) => e.item.articleId.toString()),
    ),
  ].map((id) => new ObjectId(id));

  const parents = articleIds.length
    ? await getDB()
        .collection(Collections.kbArticles)
        .find({ _id: { $in: articleIds } })
        .project({ title: 1, category: 1, audience: 1 })
        .toArray()
    : [];
  const parentById = new Map(parents.map((a) => [a._id.toString(), a]));

  const candidates = shortlist.map((entry) => {
    const it = entry.item;
    if (it.__ranker === "ticket") {
      return {
        kind: "ticket",
        id: it._id,
        title: it.subject,
        text: `Problem: ${it.problem}\nResolution: ${it.resolution}`,
        quality: it.quality,
        resolvedAt: it.resolvedAt,
        rrfScore: entry.score,
        rankers: entry.rankers,
      };
    }
    const parent = parentById.get(it.articleId?.toString());
    return {
      kind: "kb",
      id: it._id,
      articleId: it.articleId,
      title: parent?.title || it.breadcrumb || "Untitled",
      audience: parent?.audience,
      category: parent?.category,
      breadcrumb: it.breadcrumb,
      text: it.text,
      rrfScore: entry.score,
      rankers: entry.rankers,
    };
  });

  // RERANK AGAINST THE ORIGINAL TURN, not the condensed one.
  //
  // The rewrite is a lossy transformation optimised for embedding similarity:
  // it drops tone, urgency and the customer's own phrasing to produce a clean
  // retrievable sentence. That is the right input for a vector index and the
  // wrong input for judging relevance. The reranker is a cross-encoder that
  // reads query and passage together -- give it what the customer actually
  // wrote, including the words the rewrite threw away.
  const rerankQuery = originalMessage?.trim() || condensedQuestion;
  const docs = candidates.map((c) => `${c.title}\n${c.text}`);
  const ranked = await rerank(rerankQuery, docs, tuning.topPassages);

  const passages = ranked.map((r) => ({
    ...candidates[r.index],
    rerankScore: r.relevance_score,
  }));

  const topScore = passages.length ? passages[0].rerankScore : null;

  return {
    passages,
    confidence: confidenceBand(topScore),
    topScore,
    stats: {
      articles: articles.length,
      chunks: chunks.length,
      tickets: tickets.length,
      fused: fused.length,
    },
  };
}
