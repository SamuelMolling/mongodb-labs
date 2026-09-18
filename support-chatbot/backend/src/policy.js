/**
 * Escalation policy.
 *
 * Four independent signals; any one of them is sufficient. They are
 * independent on purpose -- a single blended "escalation score" is
 * untunable, because when it misfires you cannot tell which input moved it,
 * and every threshold change silently re-weights all four.
 *
 *   1. policy      certain intents escalate on arrival, whatever retrieval found
 *   2. explicit    the customer asked for a human
 *   3. confidence  N consecutive weak/none turns
 *   4. affect      frustration on a turn that also failed
 *
 * This module is deliberately pure: no database, no LLM, no clock. That is
 * what makes the policy testable offline -- see scripts/smoke.js -- and a
 * policy nobody can test is a policy nobody can change.
 */
import { tuning } from "./config.js";

/**
 * @param {{
 *   intent: string,
 *   confidence: "strong"|"weak"|"none",
 *   sentiment: string,
 *   explicitRequest?: boolean,
 *   failedTurns?: number,
 * }} input   `failedTurns` is the count BEFORE this turn.
 * @returns {{
 *   escalate: boolean,
 *   reason: string|null,
 *   failedTurns: number,
 * }}   `failedTurns` is the updated count, to persist on the conversation.
 */
export function evaluateEscalation({
  intent,
  confidence,
  sentiment,
  explicitRequest = false,
  failedTurns = 0,
}) {
  const turnFailed = confidence !== "strong";

  // The counter tracks CONSECUTIVE failures. One strong answer resets it:
  // a customer who got a good answer and then asks about something new is
  // not two-thirds of the way to a handoff.
  const nextFailedTurns = turnFailed ? failedTurns + 1 : 0;

  // 1. Authority boundary. Retrieval quality is irrelevant here -- finding a
  //    perfect passage about the refund policy does not give the agent
  //    authority to issue a refund, and a confident answer about a
  //    cancellation is worse than no answer, not better.
  if (tuning.alwaysEscalateIntents.includes(intent)) {
    return { escalate: true, reason: `policy:${intent}`, failedTurns: nextFailedTurns };
  }

  // 2. The customer asked. Talking someone out of a human is how a support
  //    experience earns its reputation.
  if (explicitRequest || intent === "human_handoff") {
    return { escalate: true, reason: "explicit_request", failedTurns: nextFailedTurns };
  }

  // 3. Frustration ALONE is not enough -- an annoyed customer who is being
  //    answered well is being helped. Frustration on a turn that also failed
  //    means the agent is making things worse, and one more attempt is one
  //    more reason to cancel.
  if ((sentiment === "frustrated" || sentiment === "angry") && turnFailed) {
    return { escalate: true, reason: "frustration_with_failed_turn", failedTurns: nextFailedTurns };
  }

  // 4. Repeated low confidence. Strictly greater-than: at the threshold we
  //    are still trying, past it we are wasting the customer's time.
  if (nextFailedTurns > tuning.maxFailedTurns) {
    return { escalate: true, reason: "repeated_low_confidence", failedTurns: nextFailedTurns };
  }

  return { escalate: false, reason: null, failedTurns: nextFailedTurns };
}

/**
 * Builds the handoff packet.
 *
 * WRITE A PACKET, NOT A FLAG. `status: "escalated"` tells the human nothing:
 * they open the conversation, read fourteen turns, and repeat every question
 * the bot already asked -- which is precisely the experience that makes
 * customers say "I had to explain everything twice".
 *
 * The packet is what the agent knows, serialised: what the customer wants,
 * what was tried, what came back and how good it was. The human opens a
 * document, not a transcript.
 */
export function buildHandoffPacket({
  conversation,
  customer,
  condensed,
  passages = [],
  toolResults = [],
  confidence,
  topScore,
  reason,
}) {
  return {
    reason,
    intent: condensed?.intent || null,
    askedFor: condensed?.standaloneQuestion || null,
    sentiment: condensed?.sentiment || null,

    customer: customer
      ? {
          id: customer._id,
          name: customer.name,
          email: customer.email,
          plan: customer.plan,
          seats: customer.seats,
          subscriptionStatus: customer.subscriptionStatus,
          renewsAt: customer.renewsAt,
        }
      : null,

    conversation: {
      id: conversation?._id || null,
      turnCount: conversation?.turnCount || 0,
      failedTurns: conversation?.failedTurns || 0,
      summary: conversation?.summary || "",
      facts: conversation?.facts || [],
    },

    // What the agent tried, with scores -- so the human can see whether this
    // was a knowledge gap (nothing relevant existed) or a retrieval miss
    // (something relevant existed and ranked badly). Those need different
    // fixes, and the distinction is invisible without the numbers.
    attempted: {
      confidence,
      topRerankScore: topScore,
      passages: passages.map((p) => ({
        kind: p.kind,
        title: p.title,
        breadcrumb: p.breadcrumb || null,
        rerankScore: p.rerankScore,
      })),
      tools: toolResults.map((t) => ({
        tool: t.tool,
        ok: t.ok,
        found: t.found ?? null,
      })),
    },
  };
}

/**
 * A note on measuring this, because the tempting metric is the wrong one.
 *
 * DEFLECTION RATE -- conversations that ended without a human -- is easy to
 * collect and actively misleading. A customer who gives up in frustration and
 * closes the tab counts as a deflection. So does one who was told something
 * wrong and believed it. Optimising deflection rewards an agent that is hard
 * to escalate out of, which is the opposite of the goal.
 *
 * RESOLUTION RATE -- conversations where the customer's problem was actually
 * solved -- is the honest one, and it cannot be inferred from the transcript:
 * "ok thanks" is what people type both when it worked and when they have
 * given up. It has to be COLLECTED, which is why there is a feedback endpoint
 * and why the admin metrics report both numbers side by side. The gap between
 * them is the interesting part.
 */
export const METRICS_NOTE =
  "deflection is easy to game; resolution must be collected, not inferred";
