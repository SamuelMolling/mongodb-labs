/**
 * Turn 1 of the pipeline: condensation + classification, in ONE LLM call.
 *
 * The problem
 * -----------
 * Retrieval assumes a self-contained query. Conversation guarantees the
 * opposite. By turn three the customer is typing "and how much is that?" --
 * six words, no product, no plan, no verb worth embedding. Sent to a vector
 * index as-is it retrieves noise, and the failure looks like bad retrieval
 * rather than a missing rewrite step.
 *
 * So the turn is rewritten into a standalone question before it touches an
 * index. Classification rides along in the same call because it needs exactly
 * the same context, and a second round-trip to ask "what kind of question was
 * that?" would double per-turn latency for no new information.
 *
 * The contract has to be stated in the NEGATIVE
 * ---------------------------------------------
 * An unconstrained rewriter is a helpful little machine for inventing facts.
 * Given "and how much is that?" after a thread about SSO, it happily produces
 *
 *   "How much does SAML SSO cost on the Pro plan for a 50-seat team
 *    billed annually?"
 *
 * Three constraints the customer never said -- plan, seat count, billing
 * period -- each of which prunes the candidate set inside the index. The
 * right passage is now unreachable, and nothing in the logs says "the query
 * was fabricated": you see a reasonable-looking question that returned bad
 * results. Over-condensation fails silently and reads as a retrieval bug.
 *
 * Hence the prompt spends more words on what NOT to do than on the task.
 */
import { completeJSON } from "./llm.js";

/**
 * Closed intent set. `other` is the escape hatch -- an open-ended taxonomy
 * drifts, and downstream policy switches on these exact strings.
 */
export const INTENTS = [
  "how_to",
  "troubleshooting",
  "billing_question",
  "billing_dispute",
  "refund_request",
  "cancellation",
  "order_status",
  "account_access",
  "data_deletion",
  "legal",
  "human_handoff",
  "smalltalk",
  "other",
];

export const TOOLS = ["lookupOrder", "listRecentOrders", "lookupSubscription"];

const SENTIMENTS = ["neutral", "confused", "frustrated", "angry", "positive"];

const SYSTEM = `You rewrite the latest customer turn into a standalone question and classify it.

REWRITE RULES -- read the prohibitions first:
- Do NOT answer the question. You are not the support agent.
- Do NOT add any constraint, number, product name, plan name, version,
  quantity or qualifier that the customer did not actually say. If the
  conversation never mentioned a plan, the rewrite must not mention a plan.
- Do NOT resolve ambiguity by guessing. If "it" is genuinely unclear, keep it
  vague rather than picking a referent.
- Do NOT translate. Keep the customer's language.
- DO resolve pronouns and elisions that the earlier turns make unambiguous:
  "how much is that?" after a thread about SAML SSO becomes "How much does
  SAML SSO cost?" -- and nothing more.
- If the turn is already standalone, return it essentially unchanged.

CLASSIFICATION:
- intent: one of how_to, troubleshooting, billing_question, billing_dispute,
  refund_request, cancellation, order_status, account_access, data_deletion,
  legal, human_handoff, smalltalk, other
- needsRetrieval: false when no document could help -- greetings, thanks,
  "that worked", pure account lookups. True otherwise.
- needsTools: any of lookupOrder, listRecentOrders, lookupSubscription that
  would help answer. Empty array if none.
- sentiment: neutral, confused, frustrated, angry or positive.
- mentionedOrderId: an order reference the customer typed (e.g. "ORD-1042"),
  or null. Copy it verbatim; never invent one.

Reply with a JSON object with exactly these keys:
standaloneQuestion, intent, needsRetrieval, needsTools, sentiment, mentionedOrderId`;

/**
 * @param {{
 *   message: string,
 *   history?: {role: string, content: string}[],
 *   summary?: string,
 *   facts?: string[],
 * }} input
 * @returns {Promise<{
 *   standaloneQuestion: string,
 *   intent: string,
 *   needsRetrieval: boolean,
 *   needsTools: string[],
 *   sentiment: string,
 *   mentionedOrderId: string|null,
 *   degraded: boolean,
 * }>}
 */
export async function condense({ message, history = [], summary = "", facts = [] }) {
  const transcript = history
    .map((m) => `${m.role === "assistant" ? "Agent" : "Customer"}: ${m.content}`)
    .join("\n");

  const context = [
    summary ? `Conversation summary so far:\n${summary}` : "",
    facts.length ? `Known facts:\n- ${facts.join("\n- ")}` : "",
    transcript ? `Recent turns:\n${transcript}` : "",
    `Latest customer turn:\n${message}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let raw = null;
  try {
    raw = await completeJSON({
      system: SYSTEM,
      user: context,
      model: process.env.LLM_CONDENSE_MODEL || process.env.LLM_MODEL,
      maxTokens: 300,
    });
  } catch (err) {
    // A classifier outage should degrade the turn, not end it. Falling back
    // to the raw message loses the rewrite but still answers the customer --
    // and `degraded` surfaces in the inspector so the behaviour is visible
    // rather than mysterious.
    console.error("[condense] failed, falling back to raw turn:", err.message);
  }

  return normalize(raw, message);
}

/**
 * JSON mode guarantees valid JSON, not a valid shape. Every field is clamped
 * to the closed set the rest of the pipeline switches on -- an unrecognised
 * intent would otherwise slip past the escalation policy untested.
 */
export function normalize(raw, originalMessage) {
  const degraded = !raw || typeof raw !== "object";
  const obj = degraded ? {} : raw;

  const question =
    typeof obj.standaloneQuestion === "string" && obj.standaloneQuestion.trim()
      ? obj.standaloneQuestion.trim()
      : String(originalMessage || "").trim();

  const intent = INTENTS.includes(obj.intent) ? obj.intent : "other";
  const sentiment = SENTIMENTS.includes(obj.sentiment) ? obj.sentiment : "neutral";

  const needsTools = Array.isArray(obj.needsTools)
    ? obj.needsTools.filter((t) => TOOLS.includes(t))
    : [];

  // Default to retrieving when the flag is missing or malformed: skipping
  // retrieval on a real question is a visible failure (the agent claims not
  // to know something it has documented), while retrieving unnecessarily on
  // smalltalk only costs a few tokens.
  const needsRetrieval =
    typeof obj.needsRetrieval === "boolean"
      ? obj.needsRetrieval
      : intent !== "smalltalk";

  const mentionedOrderId =
    typeof obj.mentionedOrderId === "string" && obj.mentionedOrderId.trim()
      ? obj.mentionedOrderId.trim()
      : null;

  return {
    standaloneQuestion: question,
    intent,
    needsRetrieval,
    needsTools,
    sentiment,
    mentionedOrderId,
    degraded,
  };
}
