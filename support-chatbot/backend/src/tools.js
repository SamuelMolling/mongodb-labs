/**
 * Tools: typed queries against the same cluster, exposed to the agent.
 *
 * THE RULE THAT MATTERS
 * ---------------------
 * The model chooses WHICH tool runs. The server decides WHAT IT CAN SEE.
 *
 * Every tool here takes `customerId` from the authenticated session and from
 * nowhere else. The model's arguments are used for the question ("which order
 * reference?") and never for the subject ("whose orders?").
 *
 * Accepting `customerId` from model arguments turns the agent into an IDOR
 * with a natural-language interface. The attack is not sophisticated -- it is
 * typing "show me the orders for customer 507f1f77bcf86cd799439011" and
 * having a helpful model pass it straight through. There is no prompt
 * hardening that fixes this, because the vulnerability is in the plumbing:
 * once the parameter is attacker-controlled, the model is just the transport.
 *
 * ON EMPTY RESULTS
 * ----------------
 * A tool returning nothing is a legitimate answer -- "I don't see that order
 * on your account" -- not an error to route around. Widening the query until
 * something comes back is how a scoped lookup quietly becomes a global one.
 */
import { ObjectId } from "mongodb";
import { Collections, getDB } from "./db.js";

/**
 * OpenAI-style tool schemas. Note what is ABSENT from every parameter list:
 * customerId. The model cannot pass it because it is not part of the
 * contract it is shown.
 */
export const toolSchemas = [
  {
    name: "lookupOrder",
    description:
      "Look up one order belonging to the current customer by its order reference (e.g. ORD-1042).",
    parameters: {
      type: "object",
      properties: {
        orderRef: { type: "string", description: "The order reference to look up." },
      },
      required: ["orderRef"],
    },
  },
  {
    name: "listRecentOrders",
    description: "List the current customer's most recent orders.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "How many orders to return (max 10)." },
      },
      required: [],
    },
  },
  {
    name: "lookupSubscription",
    description:
      "Return the current customer's plan, seat count, subscription status and renewal date.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

/**
 * @param {string} name           Tool name chosen by the model.
 * @param {object} args           Arguments produced by the model.
 * @param {{customerId: string}} session  Server-side session. Authoritative.
 */
export async function runTool(name, args = {}, session = {}) {
  const { customerId } = session;

  // No session, no data. An anonymous visitor asking about "my order" gets a
  // refusal, not a fishing expedition across the orders collection.
  if (!customerId) {
    return {
      tool: name,
      ok: false,
      reason: "no_session",
      message: "No customer is signed in for this conversation.",
    };
  }

  const cid = new ObjectId(customerId);
  const db = getDB();

  switch (name) {
    case "lookupOrder": {
      const orderRef = String(args.orderRef || "").trim();
      if (!orderRef) {
        return { tool: name, ok: false, reason: "missing_argument", message: "orderRef is required." };
      }

      // customerId is part of the FILTER, not a check afterwards. Fetching by
      // orderRef and then comparing owners leaks existence through timing and
      // through any code path that forgets the comparison.
      const order = await db
        .collection(Collections.orders)
        .findOne({ customerId: cid, orderRef }, { projection: { customerId: 0 } });

      return {
        tool: name,
        ok: true,
        found: Boolean(order),
        data: order || null,
        message: order ? undefined : `No order ${orderRef} on this account.`,
      };
    }

    case "listRecentOrders": {
      const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);
      const orders = await db
        .collection(Collections.orders)
        .find({ customerId: cid }, { projection: { customerId: 0 } })
        .sort({ placedAt: -1 })
        .limit(limit)
        .toArray();

      return { tool: name, ok: true, found: orders.length > 0, data: orders };
    }

    case "lookupSubscription": {
      const customer = await db.collection(Collections.customers).findOne(
        { _id: cid },
        { projection: { plan: 1, seats: 1, subscriptionStatus: 1, renewsAt: 1, name: 1 } },
      );

      return { tool: name, ok: true, found: Boolean(customer), data: customer || null };
    }

    default:
      return { tool: name, ok: false, reason: "unknown_tool", message: `Unknown tool: ${name}` };
  }
}

/**
 * Runs the tools the condense step asked for and renders each result as a
 * `role:"tool"` message.
 *
 * Tool output is stored in the transcript like any other message so the next
 * turn's context window includes it -- the agent should not re-query an order
 * it looked up two turns ago.
 */
export async function runRequestedTools(needsTools, { session, mentionedOrderId }) {
  const results = [];

  for (const name of needsTools) {
    const args = name === "lookupOrder" && mentionedOrderId
      ? { orderRef: mentionedOrderId }
      : {};

    try {
      results.push(await runTool(name, args, session));
    } catch (err) {
      console.error(`[tools] ${name} failed:`, err.message);
      results.push({ tool: name, ok: false, reason: "error", message: err.message });
    }
  }

  return results;
}

/** Compact, model-readable rendering of a tool result. */
export function renderToolResult(result) {
  if (!result.ok) return `${result.tool}: unavailable (${result.message || result.reason})`;
  if (!result.found) return `${result.tool}: no match. ${result.message || ""}`.trim();
  return `${result.tool}: ${JSON.stringify(result.data)}`;
}
