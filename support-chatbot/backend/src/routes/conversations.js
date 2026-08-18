import { Router } from "express";
import { ObjectId } from "mongodb";
import { Collections, getDB } from "../db.js";

const router = Router();

/**
 * Full transcript for one conversation.
 *
 * The messages query is exactly what `{ conversationId: 1, seq: -1 }` was
 * built for. Sorting ascending here uses the same index in reverse — an
 * index scan either direction, no in-memory sort.
 */
router.get("/:id", async (req, res, next) => {
  try {
    const _id = new ObjectId(req.params.id);
    const db = getDB();

    const conversation = await db.collection(Collections.conversations).findOne({ _id });
    if (!conversation) return res.status(404).json({ error: "conversation not found" });

    const messages = await db
      .collection(Collections.messages)
      .find({ conversationId: _id })
      .sort({ seq: 1 })
      .toArray();

    const escalations = await db
      .collection(Collections.escalations)
      .find({ conversationId: _id })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ conversation, messages, escalations });
  } catch (err) {
    next(err);
  }
});

/** Recent conversations for a customer — uses { customerId: 1, updatedAt: -1 }. */
router.get("/", async (req, res, next) => {
  try {
    const { customerId, limit = 20 } = req.query;
    const filter = customerId ? { customerId: new ObjectId(customerId) } : {};

    const conversations = await getDB()
      .collection(Collections.conversations)
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(Number(limit))
      .toArray();

    res.json(conversations);
  } catch (err) {
    next(err);
  }
});

export default router;
