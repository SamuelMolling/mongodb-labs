import { Router } from "express";
import { Collections, getDB } from "../db.js";

const router = Router();

/**
 * GET /api/admin/knowledge-gaps
 *
 * The editorial backlog for the docs team, DERIVED rather than guessed.
 *
 * Every turn stores its confidence band and the condensed question on the
 * message document. Grouping the weak/none turns by intent turns the agent's
 * failures into a ranked list of things the documentation does not cover —
 * with the customer's own phrasing attached, which is usually a better title
 * than whatever the docs team would have invented.
 *
 * This is the aggregation that makes the whole confidence machinery pay for
 * itself twice: once at answer time (don't bluff) and once at planning time
 * (write this article next).
 */
router.get("/knowledge-gaps", async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 20;

    const gaps = await getDB()
      .collection(Collections.messages)
      .aggregate([
        {
          $match: {
            role: "assistant",
            "meta.confidence": { $in: ["weak", "none"] },
          },
        },
        {
          $group: {
            _id: "$meta.intent",
            count: { $sum: 1 },
            avgTopScore: { $avg: "$meta.topRerankScore" },
            escalated: { $sum: { $cond: ["$meta.escalated", 1, 0] } },
            examples: { $addToSet: "$meta.condensedQuestion" },
          },
        },
        {
          $project: {
            _id: 0,
            intent: "$_id",
            count: 1,
            escalated: 1,
            avgTopScore: { $round: ["$avgTopScore", 3] },
            examples: { $slice: ["$examples", 5] },
          },
        },
        { $sort: { count: -1 } },
        { $limit: limit },
      ])
      .toArray();

    res.json({ gaps });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/metrics
 *
 * Reports deflection rate and resolution rate side by side, on purpose.
 *
 * Deflection (conversations that ended without a human) is the number that
 * looks good in a slide and rewards the wrong behaviour: a customer who gave
 * up in frustration counts as deflected, and so does one who was told
 * something wrong and believed it.
 *
 * Resolution comes from the feedback endpoint — collected, not inferred. The
 * gap between the two is the number worth watching.
 */
router.get("/metrics", async (_req, res, next) => {
  try {
    const db = getDB();

    const [row] = await db
      .collection(Collections.conversations)
      .aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            escalated: { $sum: { $cond: [{ $eq: ["$status", "escalated"] }, 1, 0] } },
            withFeedback: { $sum: { $cond: [{ $ne: ["$resolved", undefined] }, 1, 0] } },
            resolved: { $sum: { $cond: [{ $eq: ["$resolved", true] }, 1, 0] } },
          },
        },
      ])
      .toArray();

    const total = row?.total || 0;
    const escalated = row?.escalated || 0;
    const withFeedback = row?.withFeedback || 0;
    const resolved = row?.resolved || 0;

    res.json({
      conversations: total,
      escalated,
      // Easy to collect, easy to game.
      deflectionRate: total ? Number(((total - escalated) / total).toFixed(3)) : null,
      // Honest, and only meaningful over the conversations that answered.
      resolutionRate: withFeedback ? Number((resolved / withFeedback).toFixed(3)) : null,
      feedbackCoverage: total ? Number((withFeedback / total).toFixed(3)) : null,
      note: "deflection counts customers who gave up; resolution is collected from feedback",
    });
  } catch (err) {
    next(err);
  }
});

/** Pending handoffs, newest first — the human queue. */
router.get("/escalations", async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 20;

    const escalations = await getDB()
      .collection(Collections.escalations)
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    res.json({ escalations });
  } catch (err) {
    next(err);
  }
});

export default router;
