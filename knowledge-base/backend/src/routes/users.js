import { Router } from "express";
import { ObjectId } from "mongodb";
import { Collections, getDB } from "../db.js";

const router = Router();

/**
 * POST /api/users — create a user (simplified, no password).
 */
router.post("/", async (req, res, next) => {
  try {
    const { email, name } = req.body;
    if (!email || !name) {
      return res.status(400).json({ error: "email and name are required" });
    }

    const users = getDB().collection(Collections.users);

    const existing = await users.findOne({ email });
    if (existing) return res.json(existing);

    const doc = {
      email,
      name,
      createdAt: new Date(),
    };
    const result = await users.insertOne(doc);
    res.status(201).json({ _id: result.insertedId, ...doc });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const user = await getDB()
      .collection(Collections.users)
      .findOne({ _id: new ObjectId(req.params.id) });
    if (!user) return res.status(404).json({ error: "user not found" });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

export default router;
