import { Router } from "express";
import { ObjectId } from "mongodb";

import { Collections, getDB } from "../db.js";
import { condense } from "../condense.js";
import {
  getOrCreateConversation,
  appendMessage,
  loadWindow,
  maybeSummarize,
  recordTurnOutcome,
} from "../memory.js";
import { retrievePassages } from "../retrieve.js";
import { runRequestedTools, renderToolResult } from "../tools.js";
import { evaluateEscalation, buildHandoffPacket } from "../policy.js";
import { streamChat } from "../llm.js";
import { tuning } from "../config.js";

const router = Router();

/**
 * One turn of the agent, streamed as NDJSON.
 *
 * Protocol -- one JSON object per line:
 *
 *   {"event":"state","stage":"condensing"}            pipeline progress
 *   {"event":"state","stage":"retrieving", ...}       carries the condense result
 *   {"event":"passages","passages":[...]}             fired once, before tokens
 *   {"event":"token","text":"..."}                    fired N times
 *   {"event":"escalation","reason":"...","packet":{}} fired when handing off
 *   {"event":"done", ...}                             fired once
 *   {"event":"error","message":"..."}                 only mid-stream failures
 *
 * The `state` events exist because this pipeline has four sequential remote
 * calls before the first token. Without them the customer stares at a
 * spinner for several seconds; with them the UI can say what is happening,
 * and the inspector panel can show the pipeline working.
 */
router.post("/", async (req, res, next) => {
  const { message, conversationId, customerId } = req.body || {};

  // Validate BEFORE any model call. An empty message costs nothing to reject
  // here and one condense round-trip to reject downstream.
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  let streamStarted = false;

  try {
    const db = getDB();

    const customer = customerId
      ? await db.collection(Collections.customers).findOne({ _id: new ObjectId(customerId) })
      : null;

    const conversation = await getOrCreateConversation({ conversationId, customerId });
    const window = await loadWindow(conversation);

    await appendMessage({
      conversationId: conversation._id,
      role: "user",
      content: message.trim(),
    });

    // Open the stream now so the client can render progress while the
    // pipeline runs.
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering behind nginx
    res.flushHeaders?.();
    streamStarted = true;

    const send = (event, data = {}) => {
      res.write(JSON.stringify({ event, ...data }) + "\n");
    };

    send("state", { stage: "condensing", conversationId: conversation._id });

    /* -- 1. Condense + classify ------------------------------------------ */
    const condensed = await condense({
      message: message.trim(),
      history: window.recent.map((m) => ({ role: m.role, content: m.content })),
      summary: window.summary,
      facts: window.facts,
    });

    send("state", {
      stage: "condensed",
      intent: condensed.intent,
      sentiment: condensed.sentiment,
      needsRetrieval: condensed.needsRetrieval,
      needsTools: condensed.needsTools,
      condensedQuestion: condensed.standaloneQuestion,
      degraded: condensed.degraded,
    });

    /* -- 2. Tools --------------------------------------------------------- */
    let toolResults = [];
    if (condensed.needsTools.length > 0) {
      send("state", { stage: "tools", tools: condensed.needsTools });

      // customerId comes from the request session, NEVER from the model's
      // arguments. See tools.js.
      toolResults = await runRequestedTools(condensed.needsTools, {
        session: { customerId },
        mentionedOrderId: condensed.mentionedOrderId,
      });

      for (const result of toolResults) {
        await appendMessage({
          conversationId: conversation._id,
          role: "tool",
          content: renderToolResult(result),
          meta: { tool: result.tool, ok: result.ok, found: result.found ?? null },
        });
      }
    }

    /* -- 3. Retrieval ----------------------------------------------------- */
    let retrieval = { passages: [], confidence: "none", topScore: null, stats: {} };

    if (condensed.needsRetrieval) {
      send("state", { stage: "retrieving" });
      retrieval = await retrievePassages({
        condensedQuestion: condensed.standaloneQuestion,
        originalMessage: message.trim(),
        customer: customer || {},
      });
      // Ship the thresholds with the passages. The inspector colours each
      // score by band, and a second copy of these numbers in the frontend is
      // a copy that drifts -- which it did, silently, the first time they
      // were recalibrated here.
      send("passages", {
        passages: retrieval.passages,
        stats: retrieval.stats,
        thresholds: tuning.confidence,
      });
    } else {
      // Smalltalk skips embedding + two vector searches + a rerank + five
      // passages in the prompt. "thanks, that worked" does not need a
      // retrieval pipeline, and running one on every turn is most of the
      // per-turn cost of a naive agent.
      send("state", { stage: "retrieval_skipped", reason: condensed.intent });
    }

    /* -- 4. Escalation policy --------------------------------------------- */
    const decision = evaluateEscalation({
      intent: condensed.intent,
      confidence: retrieval.confidence,
      sentiment: condensed.sentiment,
      failedTurns: conversation.failedTurns || 0,
    });

    let handoff = null;
    if (decision.escalate) {
      handoff = buildHandoffPacket({
        conversation,
        customer,
        condensed,
        passages: retrieval.passages,
        toolResults,
        confidence: retrieval.confidence,
        topScore: retrieval.topScore,
        reason: decision.reason,
      });

      await db.collection(Collections.escalations).insertOne({
        conversationId: conversation._id,
        customerId: customer?._id || null,
        reason: decision.reason,
        intent: condensed.intent,
        handoff,
        status: "pending",
        createdAt: new Date(),
      });

      await db.collection(Collections.conversations).updateOne(
        { _id: conversation._id },
        { $set: { status: "escalated", updatedAt: new Date() } },
      );

      send("escalation", { reason: decision.reason, packet: handoff });
    }

    /* -- 5. Generation ---------------------------------------------------- */
    send("state", { stage: "generating", confidence: retrieval.confidence });

    const messages = buildPrompt({
      window,
      condensed,
      passages: retrieval.passages,
      toolResults,
      confidence: retrieval.confidence,
      escalated: decision.escalate,
      userMessage: message.trim(),
      customer,
    });

    let answer = "";
    let model = null;

    try {
      const result = await streamChat({
        messages,
        onToken: (text) => {
          answer += text;
          send("token", { text });
        },
      });
      model = result.model;
    } catch (err) {
      // Generation failed after retrieval succeeded. Say something true
      // rather than nothing at all.
      const fallback = decision.escalate
        ? "I'm handing this to a human colleague now."
        : "Sorry — I couldn't generate an answer just now. Please try again.";
      answer = fallback;
      send("token", { text: fallback });
      console.error("[chat] generation failed:", err.message);
    }

    /* -- 6. Persist the turn ---------------------------------------------- */
    await appendMessage({
      conversationId: conversation._id,
      role: "assistant",
      content: answer,
      meta: {
        // These three fields are what the knowledge-gap aggregation reads.
        // Storing them per message is what makes the docs backlog a query
        // instead of a guess.
        intent: condensed.intent,
        confidence: retrieval.confidence,
        condensedQuestion: condensed.standaloneQuestion,
        topRerankScore: retrieval.topScore,
        escalated: decision.escalate,
        passageCount: retrieval.passages.length,
        model,
      },
    });

    await recordTurnOutcome(conversation._id, {
      failedTurns: decision.failedTurns,
      intent: condensed.intent,
    });

    // Refresh the doc so turnCount reflects the messages just appended.
    const updated = await db
      .collection(Collections.conversations)
      .findOne({ _id: conversation._id });
    await maybeSummarize(updated);

    send("done", {
      model,
      conversationId: conversation._id,
      confidence: retrieval.confidence,
      topRerankScore: retrieval.topScore,
      intent: condensed.intent,
      escalated: decision.escalate,
      failedTurns: decision.failedTurns,
    });

    res.end();
  } catch (err) {
    if (!streamStarted) return next(err);
    try {
      res.write(JSON.stringify({ event: "error", message: err.message }) + "\n");
    } catch {}
    res.end();
  }
});

/**
 * Assembles the generation prompt.
 *
 * Order matters: system rules, then the durable memory layers, then tool
 * results, then passages, then the actual turn. The customer's message is
 * last so it is the most recent thing in the context.
 */
function buildPrompt({
  window,
  condensed,
  passages,
  toolResults,
  confidence,
  escalated,
  userMessage,
  customer,
}) {
  const rules = [
    "You are a customer support agent.",
    "Answer ONLY from the passages and tool results provided. Cite passages as [1], [2].",
    "Tool results are authoritative facts about THIS customer's account: state them directly, do not cite them as passages.",
    "If the passages do not contain enough to answer, say so plainly and do not fill the gap with general knowledge.",
    "Never invent an order reference, date, price, or policy.",
    "Reply in the same language as the customer.",
    "Be concise: 2-5 sentences unless the customer asked for detail.",
  ];

  if (confidence === "none") {
    rules.push(
      "Retrieval found nothing relevant. Say you don't have that information rather than guessing.",
    );
  }
  if (escalated) {
    rules.push(
      "This conversation is being handed to a human. Tell the customer briefly and do not promise an outcome.",
    );
  }

  const messages = [{ role: "system", content: rules.join(" ") }];

  const context = [];
  if (customer) {
    context.push(
      `Customer: ${customer.name} (plan: ${customer.plan}, status: ${customer.subscriptionStatus}).`,
    );
  }
  if (window.summary) context.push(`Conversation so far: ${window.summary}`);
  if (window.facts?.length) context.push(`Known facts:\n- ${window.facts.join("\n- ")}`);
  if (context.length) messages.push({ role: "system", content: context.join("\n\n") });

  // Verbatim recent turns.
  for (const m of window.recent) {
    if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content: m.content });
    } else if (m.role === "tool") {
      messages.push({ role: "system", content: `Earlier tool result — ${m.content}` });
    }
  }

  if (toolResults.length) {
    messages.push({
      role: "system",
      content:
        "Tool results for this turn:\n" + toolResults.map(renderToolResult).join("\n"),
    });
  }

  if (passages.length) {
    const rendered = passages
      .map(
        (p, i) =>
          `[${i + 1}] (${p.kind === "ticket" ? "past ticket" : "documentation"}) ${p.title}\n${p.text}`,
      )
      .join("\n\n---\n\n");
    messages.push({ role: "system", content: `Passages:\n\n${rendered}` });
  }

  messages.push({ role: "user", content: userMessage });
  return messages;
}

/**
 * Feedback endpoint.
 *
 * Resolution rate has to be COLLECTED. "ok thanks" is what customers type
 * both when the problem is solved and when they have given up, so the
 * transcript cannot tell you which happened. See the note in policy.js.
 */
router.post("/feedback", async (req, res, next) => {
  try {
    const { conversationId, resolved, comment } = req.body || {};
    if (!conversationId || typeof resolved !== "boolean") {
      return res.status(400).json({ error: "conversationId and resolved are required" });
    }

    await getDB().collection(Collections.conversations).updateOne(
      { _id: new ObjectId(conversationId) },
      {
        $set: {
          resolved,
          feedbackComment: comment || null,
          status: resolved ? "resolved" : "unresolved",
          updatedAt: new Date(),
        },
      },
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
