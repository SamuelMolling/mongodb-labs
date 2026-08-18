/**
 * Every number that changes agent behaviour lives here.
 *
 * Retrieval and escalation systems accumulate magic numbers fast: a rerank
 * threshold in one file, a half-life in another, a failed-turn ceiling in a
 * third. When they are scattered, nobody can answer "why did the bot escalate
 * that conversation?" without reading five modules. Centralising them means
 * the tuning surface of the whole agent is one screen of code.
 */
export const tuning = {
  /* -- Retrieval ---------------------------------------------------------- */

  // Reciprocal Rank Fusion damping constant. 60 is the value from the
  // original RRF paper; it flattens the difference between rank 1 and rank 2
  // enough that a single ranker cannot dominate the fused list.
  rrfK: 60,

  // Per-ranker weights. These encode an editorial judgement about evidence
  // quality, not a measurement:
  //   - kbChunks   the vector ranker over curated documentation is the spine
  //   - kbArticles BM25 over whole articles is a boost, not a primary signal;
  //                it rewards exact product/error-code matches that embeddings
  //                smooth away
  //   - tickets    a resolution that worked once for one customer is weaker
  //                evidence than documentation somebody reviewed
  weights: {
    kbChunks: 1.0,
    kbArticles: 0.7,
    tickets: 0.5,
  },

  // Candidate pool sizes. numCandidates is the HNSW search width; limit is
  // how many survive into the fusion step.
  vectorNumCandidates: 200,
  vectorLimit: 40,
  keywordLimit: 30,
  ticketLimit: 20,

  // Shortlist handed to the reranker, and how many passages reach the prompt.
  rerankShortlist: 20,
  topPassages: 5,

  // Tickets decay: a resolution from 18 months ago may describe a UI that no
  // longer exists. Half-life in days -- a ticket exactly this old keeps half
  // its fused score.
  ticketHalfLifeDays: 180,

  // Tickets below this quality never enter the corpus at all. A ticket corpus
  // containing wrong answers is a machine for reproducing past mistakes at
  // scale, and it does it with the confident tone of a resolved case.
  ticketMinQuality: 0.7,

  /* -- Confidence --------------------------------------------------------- */

  // Bands over the TOP rerank score. Below `weak` we have retrieved nothing
  // worth answering from, and the honest move is to say so rather than let
  // the model improvise from parametric knowledge.
  confidence: {
    strong: 0.4,
    weak: 0.3,
  },

  /* -- Escalation --------------------------------------------------------- */

  // Consecutive weak/none turns tolerated before handing off. Strictly
  // greater-than: at 2 we are still trying, at 3 we stop wasting the
  // customer's time.
  maxFailedTurns: 2,

  // Intents that escalate on arrival, whatever retrieval found. Confidence is
  // irrelevant here: finding a perfect passage about the refund policy does
  // not give the agent authority to issue a refund. These are authority
  // boundaries, not knowledge gaps.
  alwaysEscalateIntents: [
    "billing_dispute",
    "cancellation",
    "refund_request",
    "data_deletion",
    "legal",
    "human_handoff",
  ],

  /* -- Memory ------------------------------------------------------------- */

  // Verbatim turns kept in the context window. Everything older is
  // represented by the rolling summary plus extracted facts.
  verbatimTurns: 6,

  // Regenerate the summary every N turns rather than every turn. Summarising
  // on every turn doubles LLM calls per turn to restate information that
  // changes slowly.
  summarizeEveryTurns: 6,

  // TTL for ANONYMOUS sessions only -- 30 days. See the comment in
  // scripts/create-indexes.js for why identified customers are excluded.
  anonymousSessionTtlDays: 30,

  /* -- Chunking ----------------------------------------------------------- */

  maxChunkSize: 1500,

  /* -- Entitlement -------------------------------------------------------- */

  // Which audience tags each plan may be answered from. This is a ladder, not
  // a lookup: `pro` sees everything `free` sees. The value is used as the
  // `audience` pre-filter inside $vectorSearch, so it is an authorization
  // boundary enforced by the index -- see retrieve.js.
  audienceLadder: {
    free: ["all"],
    pro: ["all", "pro"],
    enterprise: ["all", "pro", "enterprise"],
  },
};

/**
 * Resolves the audience tags a customer plan may retrieve from.
 * Unknown or missing plan degrades to the most restrictive rung -- failing
 * closed is the only safe default for an authorization decision.
 */
export function audienceFor(plan) {
  return tuning.audienceLadder[plan] || tuning.audienceLadder.free;
}

/**
 * Maps a top rerank score onto a confidence band.
 * @returns {"strong"|"weak"|"none"}
 */
export function confidenceBand(topScore) {
  if (typeof topScore !== "number" || Number.isNaN(topScore)) return "none";
  if (topScore >= tuning.confidence.strong) return "strong";
  if (topScore >= tuning.confidence.weak) return "weak";
  return "none";
}
