import { Router } from "express";
import { ObjectId } from "mongodb";
import { Collections, getDB } from "../db.js";

const router = Router();

/**
 * Lists customers so the demo UI can switch between them.
 *
 * In a real product this endpoint would not exist — the customer comes from
 * the session, not from a dropdown. It is here because switching plans is how
 * you exercise the entitlement pre-filter by hand: ask the same question as
 * the Free customer and as the Enterprise one and watch the passages change.
 */
router.get("/", async (_req, res, next) => {
  try {
    const customers = await getDB()
      .collection(Collections.customers)
      .find({})
      .project({ name: 1, email: 1, plan: 1, locale: 1, seats: 1, subscriptionStatus: 1 })
      .sort({ plan: 1 })
      .toArray();

    res.json(customers);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const customer = await getDB()
      .collection(Collections.customers)
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!customer) return res.status(404).json({ error: "customer not found" });
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

export default router;
