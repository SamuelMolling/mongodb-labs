import { Router } from "express";
import { ObjectId } from "mongodb";
import { Collections, getDB } from "../db.js";

const router = Router();

/**
 * POST /api/workspaces
 * Body: { name, slug, ownerId }
 */
router.post("/", async (req, res, next) => {
  try {
    const { name, slug, ownerId } = req.body;
    if (!name || !slug || !ownerId) {
      return res
        .status(400)
        .json({ error: "name, slug and ownerId are required" });
    }

    const doc = {
      name,
      slug,
      ownerId: new ObjectId(ownerId),
      members: [{ userId: new ObjectId(ownerId), role: "owner" }],
      createdAt: new Date(),
    };

    const result = await getDB()
      .collection(Collections.workspaces)
      .insertOne(doc);

    res.status(201).json({ _id: result.insertedId, ...doc });
  } catch (err) {
    next(err);
  }
});

/** GET /api/workspaces — list all workspaces (simplified). */
router.get("/", async (_req, res, next) => {
  try {
    const list = await getDB()
      .collection(Collections.workspaces)
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const ws = await getDB()
      .collection(Collections.workspaces)
      .findOne({ _id: new ObjectId(req.params.id) });
    if (!ws) return res.status(404).json({ error: "workspace not found" });
    res.json(ws);
  } catch (err) {
    next(err);
  }
});

export default router;
