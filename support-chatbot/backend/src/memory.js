/**
 * Conversation memory, in three layers.
 *
 * Layer 1  transcript   every message, in its own collection
 * Layer 2  summary      rolling prose digest on the conversation document
 * Layer 3  facts        extracted structured strings on the same document
 *
 * Why messages are a COLLECTION and never an embedded array
 * ---------------------------------------------------------
 * Embedding the transcript in the conversation document is the obvious first
 * model and it degrades in three separate ways at once:
 *
 *   1. Every append rewrites the ENTIRE document. Turn 40 rewrites 39 turns
 *      of text to add one line. Write amplification grows linearly with
 *      conversation length.
 *   2. The working set is sized by the LONGEST conversation rather than the
 *      median one. One customer who never closes the widget inflates the
 *      memory profile of the whole collection, because any read of that
 *      conversation pulls every turn into cache.
 *   3. There is a hard wall at 16MB. It is far away, and a persistent enough
 *      user will find it -- and when they do, the failure is an unhandled
 *      write error on an ordinary message.
 *
 * A separate collection with `{ conversationId: 1, seq: -1 }` makes "last K
 * turns" an index-covered lookup and keeps appends O(1) regardless of length.
 *
 * Why the context window is BUDGETED, not accumulated
 * ---------------------------------------------------
 * summary + last K verbatim turns + facts is a fixed-size prompt. Replaying
 * the whole transcript instead means cost and latency grow with conversation
 * length, which is exactly backwards: the longest conversations are the ones
 * already going badly.
 */
import { ObjectId } from "mongodb";
import { Collections, getDB } from "./db.js";
import { tuning } from "./config.js";
import { completeText } from "./llm.js";

/**
 * Loads an existing conversation or opens a new one.
 *
 * `expiresAt` is set ONLY for anonymous sessions. See create-indexes.js for
 * the reasoning -- it is a retention decision, not a caching one.
 */
export async function getOrCreateConversation({ conversationId, customerId }) {
  const db = getDB();
  const conversations = db.collection(Collections.conversations);

  if (conversationId) {
    const existing = await conversations.findOne({
      _id: new ObjectId(conversationId),
    });
    if (existing) return existing;
  }

  const now = new Date();
  const isAnonymous = !customerId;

  const doc = {
    customerId: customerId ? new ObjectId(customerId) : null,
    status: "open",
    summary: "",
    facts: [],
    turnCount: 0,
    failedTurns: 0,
    lastIntent: null,
    createdAt: now,
    updatedAt: now,
  };

  if (isAnonymous) {
    doc.expiresAt = new Date(
      now.getTime() + tuning.anonymousSessionTtlDays * 24 * 60 * 60 * 1000,
    );
  }

  const { insertedId } = await conversations.insertOne(doc);
  return { ...doc, _id: insertedId };
}

/**
 * Appends one message. `seq` is derived from the conversation's turnCount
 * rather than a count() on messages -- one round trip instead of two, and it
 * stays correct under concurrent appends because the increment is atomic.
 */
export async function appendMessage({ conversationId, role, content, meta = {} }) {
  const db = getDB();

  const conv = await db.collection(Collections.conversations).findOneAndUpdate(
    { _id: new ObjectId(conversationId) },
    { $inc: { turnCount: 1 }, $set: { updatedAt: new Date() } },
    { returnDocument: "after" },
  );

  const seq = conv?.turnCount ?? 0;

  await db.collection(Collections.messages).insertOne({
    conversationId: new ObjectId(conversationId),
    seq,
    role,
    content,
    meta,
    createdAt: new Date(),
  });

  return seq;
}

/**
 * Builds the context window: rolling summary + last K verbatim turns + facts.
 *
 * The K most recent turns are fetched with `{ conversationId: 1, seq: -1 }`
 * and reversed in memory -- descending index, ascending prompt.
 */
export async function loadWindow(conversation) {
  const db = getDB();

  const recent = await db
    .collection(Collections.messages)
    .find({ conversationId: conversation._id })
    .sort({ seq: -1 })
    .limit(tuning.verbatimTurns)
    .toArray();

  return {
    summary: conversation.summary || "",
    facts: conversation.facts || [],
    recent: recent.reverse(),
  };
}

const SUMMARY_SYSTEM = `You maintain a running summary of a customer support conversation.

Rewrite the summary so it covers the whole conversation including the new turns.

PRESERVE VERBATIM, exactly as written, every:
- identifier (order refs, ticket ids, account ids, emails)
- error code (e.g. AUTH_302)
- product, plan and feature name
- number, quantity, limit or constraint the customer stated

Paraphrasing any of the above is a failure. Everything else may be compressed.
Write 3-6 sentences of plain prose. No preamble, no bullet list.`;

const FACTS_SYSTEM = `Extract durable facts about the customer's situation from this conversation.

A durable fact is something still true in twenty turns: an order reference,
an error code, a plan, a deadline, a stated constraint, a decision made.

Do NOT extract pleasantries, questions, or anything the agent said about
itself. Return at most 8 items.

Reply with a JSON object: {"facts": ["...", "..."]}`;

/**
 * Regenerates the summary every N turns rather than on every turn.
 *
 * Summarising every turn doubles the LLM calls per turn to restate
 * information that changes slowly -- the digest of turns 1..20 is nearly the
 * digest of turns 1..21. The verbatim window covers the recent turns the
 * summary has not absorbed yet, so nothing is lost in between.
 *
 * Returns the (possibly unchanged) summary and facts.
 */
export async function maybeSummarize(conversation, { force = false } = {}) {
  const turnCount = conversation.turnCount || 0;
  const due = force || (turnCount > 0 && turnCount % tuning.summarizeEveryTurns === 0);

  if (!due) {
    return { summary: conversation.summary || "", facts: conversation.facts || [] };
  }

  const db = getDB();
  const all = await db
    .collection(Collections.messages)
    .find({ conversationId: conversation._id })
    .sort({ seq: 1 })
    .toArray();

  if (all.length === 0) {
    return { summary: conversation.summary || "", facts: conversation.facts || [] };
  }

  const transcript = all
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "assistant" ? "Agent" : "Customer"}: ${m.content}`)
    .join("\n");

  let summary = conversation.summary || "";
  let facts = conversation.facts || [];

  try {
    summary = await completeText({
      system: SUMMARY_SYSTEM,
      user: transcript,
      maxTokens: 350,
    });
  } catch (err) {
    console.error("[memory] summary failed:", err.message);
  }

  // The structured layer exists because the summarizer is a paraphraser by
  // construction. The order id mentioned twelve turns ago survives here,
  // where nothing is trying to make it read more fluently.
  try {
    const { completeJSON } = await import("./llm.js");
    const raw = await completeJSON({
      system: FACTS_SYSTEM,
      user: transcript,
      maxTokens: 300,
    });
    if (raw && Array.isArray(raw.facts)) {
      facts = raw.facts.filter((f) => typeof f === "string" && f.trim()).slice(0, 8);
    }
  } catch (err) {
    console.error("[memory] fact extraction failed:", err.message);
  }

  await db.collection(Collections.conversations).updateOne(
    { _id: conversation._id },
    { $set: { summary, facts, updatedAt: new Date() } },
  );

  return { summary, facts };
}

/**
 * Persists the per-turn outcome the escalation policy depends on.
 * `failedTurns` is a counter on the conversation rather than something
 * recomputed from messages: the policy needs CONSECUTIVE failures, and a
 * counter that resets is cheaper and clearer than a window query.
 */
export async function recordTurnOutcome(conversationId, { failedTurns, intent }) {
  await getDB().collection(Collections.conversations).updateOne(
    { _id: new ObjectId(conversationId) },
    { $set: { failedTurns, lastIntent: intent, updatedAt: new Date() } },
  );
}
