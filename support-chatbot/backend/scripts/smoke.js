/**
 * Offline smoke test — no cluster, no API keys, no network.
 *
 * What it covers is chosen by one rule: everything whose correctness does not
 * depend on a remote service. That turns out to be most of the interesting
 * logic in this lab — the chunker, the entitlement ladder and the escalation
 * policy are all pure functions, and they are pure functions on purpose.
 *
 * A policy nobody can test offline is a policy nobody changes with
 * confidence, which is how support agents end up with escalation rules
 * everyone is afraid to touch.
 *
 * The HTTP section boots the real Express app on an ephemeral port. It cannot
 * exercise a full turn (that needs Mongo and an LLM) but it catches the class
 * of bug that is cheapest to prevent and most annoying to discover in
 * production: a route mounted at the wrong path, or validation that runs
 * after the expensive call instead of before it.
 *
 * Run: npm run smoke   (or `make smoke` from the lab root)
 */
import { chunkArticle } from "../src/utils/chunker.js";
import { tuning, audienceFor, confidenceBand } from "../src/config.js";
import { evaluateEscalation, buildHandoffPacket } from "../src/policy.js";
import { normalize, INTENTS } from "../src/condense.js";
import { entitlementFilter, recencyDecay, fuseRRF } from "../src/retrieve.js";
import { toolSchemas, renderToolResult } from "../src/tools.js";
import { createApp } from "../src/app.js";

let passed = 0;
let failed = 0;
let group = "";

function section(name) {
  group = name;
  console.log(`\n${name}`);
}

function ok(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) console.log(`        ${detail}`);
  }
}

/* ========================================================================== */
section("modules");
/* ========================================================================== */

ok("every module imports without a database or API key",
  typeof chunkArticle === "function" &&
  typeof evaluateEscalation === "function" &&
  typeof entitlementFilter === "function" &&
  typeof createApp === "function" &&
  typeof normalize === "function" &&
  Array.isArray(toolSchemas));

ok("no tool schema exposes customerId as a model argument",
  toolSchemas.every((t) => !Object.keys(t.parameters.properties || {}).includes("customerId")),
  "a model-supplied customerId is an IDOR with a natural-language interface");

/* ========================================================================== */
section("chunker");
/* ========================================================================== */

const ARTICLE = `# SAML SSO

Intro paragraph explaining single sign-on.

## Configuration

Open Settings and paste the metadata.

\`\`\`bash
# rebuild the search index
npm run create-indexes
\`\`\`

## Pricing

Included on Pro and Enterprise.`;

const chunks = chunkArticle("SAML SSO", ARTICLE, { maxChunkSize: 400 });

ok("headings become chunks with breadcrumbs",
  chunks.length >= 3 &&
  chunks.some((c) => c.breadcrumb === "SAML SSO > Configuration") &&
  chunks.some((c) => c.breadcrumb === "SAML SSO > Pricing"),
  JSON.stringify(chunks.map((c) => c.breadcrumb)));

ok("a '# comment' inside a code fence is not a heading",
  !chunks.some((c) => /rebuild the search index/.test(c.breadcrumb)) &&
  chunks.some((c) => /rebuild the search index/.test(c.text)),
  JSON.stringify(chunks.map((c) => c.breadcrumb)));

ok("an H1 matching the article title does not duplicate the breadcrumb",
  !chunks.some((c) => /SAML SSO > SAML SSO/.test(c.breadcrumb)),
  JSON.stringify(chunks.map((c) => c.breadcrumb)));

ok("no chunk is ever produced without context",
  chunks.length > 0 && chunks.every((c) => c.breadcrumb && c.breadcrumb.length > 0));

// A "sentence" with no terminator at all — a minified blob or a wide table
// row. Sentence-first splitting would emit this as one oversized chunk.
const BLOB = "x".repeat(5000);
const blobChunks = chunkArticle("Reference", `# Reference\n\n${BLOB}`, { maxChunkSize: 400 });

ok("an unpunctuated blob is still cut at the window",
  blobChunks.length > 1 && blobChunks.every((c) => c.text.length <= 400),
  `chunks=${blobChunks.length} max=${Math.max(...blobChunks.map((c) => c.text.length))}`);

ok("every sub-chunk of a split section keeps its breadcrumb",
  blobChunks.every((c) => c.text.startsWith("Reference")));

/* ========================================================================== */
section("entitlement");
/* ========================================================================== */

ok("plan ladder gates the retrieval filter",
  audienceFor("free").join() === "all" &&
  audienceFor("pro").join() === "all,pro" &&
  audienceFor("enterprise").join() === "all,pro,enterprise");

ok("a free customer's filter cannot reach enterprise content",
  !entitlementFilter({ plan: "free" }).audience.$in.includes("enterprise"));

ok("an unknown plan fails closed to the most restrictive rung",
  audienceFor("platinum").join() === "all" && audienceFor(undefined).join() === "all",
  "an authorization default must fail closed");

ok("the filter also pins status to published",
  entitlementFilter({ plan: "enterprise" }).status.$eq === "published");

/* ========================================================================== */
section("ranking");
/* ========================================================================== */

ok("ticket recency decays by half every half-life",
  Math.abs(recencyDecay(daysAgo(tuning.ticketHalfLifeDays)) - 0.5) < 0.02,
  String(recencyDecay(daysAgo(tuning.ticketHalfLifeDays))));

ok("a fresh ticket keeps nearly all of its weight",
  recencyDecay(daysAgo(1)) > 0.99);

ok("an 18-month-old ticket is worth well under a quarter of a fresh one",
  recencyDecay(daysAgo(540)) < 0.25,
  String(recencyDecay(daysAgo(540))));

const fused = fuseRRF([
  { items: [{ _id: "a", __ranker: "kb" }, { _id: "b", __ranker: "kb" }], weight: 1.0, key: (i) => i._id },
  { items: [{ _id: "b", __ranker: "ticket" }], weight: 0.5, key: (i) => i._id },
]);

ok("RRF fuses by rank and a document found by two rankers outranks one found by one",
  fused[0].id === "b" && fused[0].rankers.length === 2,
  JSON.stringify(fused.map((f) => [f.id, Number(f.score.toFixed(5))])));

ok("confidence bands map onto the tuning thresholds",
  confidenceBand(0.8) === "strong" &&
  confidenceBand(0.5) === "weak" &&
  confidenceBand(0.33) === "none" &&
  confidenceBand(null) === "none",
  "thresholds calibrated against measured rerank-2 scores, see config.js");

/* ========================================================================== */
section("escalation policy");
/* ========================================================================== */

const base = { intent: "how_to", confidence: "strong", sentiment: "neutral", failedTurns: 0 };

ok("cancellation escalates regardless of confidence",
  evaluateEscalation({ ...base, intent: "cancellation" }).escalate === true,
  "a perfect passage about the refund policy is not authority to issue one");

ok("every always-escalate intent is a recognised intent",
  tuning.alwaysEscalateIntents.every((i) => INTENTS.includes(i)));

ok("an explicit request for a human escalates",
  evaluateEscalation({ ...base, intent: "human_handoff" }).escalate === true);

ok("one weak answer does not escalate",
  evaluateEscalation({ ...base, confidence: "weak" }).escalate === false);

ok("repeated low confidence escalates",
  evaluateEscalation({ ...base, confidence: "weak", failedTurns: tuning.maxFailedTurns }).escalate === true,
  `failedTurns=${tuning.maxFailedTurns} + one more weak turn`);

ok("frustration alone, on a good answer, does not escalate",
  evaluateEscalation({ ...base, sentiment: "frustrated" }).escalate === false,
  "an annoyed customer who is being answered well is being helped");

ok("frustration plus a failing turn escalates immediately",
  evaluateEscalation({ ...base, confidence: "weak", sentiment: "frustrated" }).escalate === true);

ok("a strong answer resets the failure counter",
  evaluateEscalation({ ...base, confidence: "strong", failedTurns: 2 }).failedTurns === 0);

ok("a weak answer increments the failure counter",
  evaluateEscalation({ ...base, confidence: "weak", failedTurns: 1 }).failedTurns === 2);

const packet = buildHandoffPacket({
  conversation: { _id: "c1", turnCount: 6, failedTurns: 3, summary: "SSO trouble", facts: ["ORD-1042"] },
  customer: { _id: "u1", name: "Dana", email: "d@e.com", plan: "enterprise" },
  condensed: { intent: "troubleshooting", standaloneQuestion: "Why does SSO fail?", sentiment: "frustrated" },
  passages: [{ kind: "kb", title: "Login errors", rerankScore: 0.21 }],
  toolResults: [{ tool: "lookupSubscription", ok: true, found: true }],
  confidence: "none",
  topScore: 0.21,
  reason: "repeated_low_confidence",
});

ok("the handoff is a packet, not a flag",
  packet.reason === "repeated_low_confidence" &&
  packet.askedFor === "Why does SSO fail?" &&
  packet.conversation.facts[0] === "ORD-1042" &&
  packet.attempted.passages[0].rerankScore === 0.21 &&
  packet.attempted.tools[0].tool === "lookupSubscription",
  "a human should not have to re-read the transcript to see what was tried");

/* ========================================================================== */
section("condense contract");
/* ========================================================================== */

ok("a malformed classifier response degrades to the raw turn",
  (() => {
    const n = normalize(null, "and how much is that?");
    return n.standaloneQuestion === "and how much is that?" &&
      n.intent === "other" &&
      n.degraded === true;
  })());

ok("an unrecognised intent is clamped to the closed set",
  normalize({ intent: "please_escalate_now", standaloneQuestion: "hi" }, "hi").intent === "other",
  "an unknown intent would otherwise slip past the escalation policy untested");

ok("unknown tool names are dropped",
  normalize({ needsTools: ["lookupOrder", "dropDatabase"], standaloneQuestion: "x" }, "x")
    .needsTools.join() === "lookupOrder");

ok("a fabricated non-string order id is discarded",
  normalize({ mentionedOrderId: { $ne: null }, standaloneQuestion: "x" }, "x").mentionedOrderId === null);

ok("tool results render without leaking internals",
  renderToolResult({ tool: "lookupOrder", ok: true, found: false, message: "No order ORD-9 on this account." })
    .includes("no match"));

/* ========================================================================== */
section("http wiring");
/* ========================================================================== */

const app = createApp();
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const port = server.address().port;

try {
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  const healthBody = await health.json();
  ok("app boots and serves /health without a database",
    health.status === 200 && healthBody.status === "ok",
    JSON.stringify(healthBody));

  // Reaching the LLM would throw (no key, no cluster). A 400 proves
  // validation runs first.
  const empty = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "   " }),
  });
  const emptyBody = await empty.json();
  ok("POST /api/chat rejects an empty message before touching the LLM",
    empty.status === 400 && /required/.test(emptyBody.error),
    `${empty.status} ${JSON.stringify(emptyBody)}`);

  const badFeedback = await fetch(`http://127.0.0.1:${port}/api/chat/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId: "abc" }),
  });
  ok("POST /api/chat/feedback validates its body",
    badFeedback.status === 400);

  const missing = await fetch(`http://127.0.0.1:${port}/api/nope`);
  ok("unknown routes 404 instead of hanging",
    missing.status === 404);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

/* ========================================================================== */

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000);
}

console.log(
  failed === 0
    ? `\nall green — ${passed} checks passed\n`
    : `\n${failed} FAILED, ${passed} passed\n`,
);

process.exit(failed === 0 ? 0 : 1);
