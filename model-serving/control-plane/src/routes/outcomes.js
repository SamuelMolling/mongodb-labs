import { Router } from "express";
import { h } from "./util.js";
import { badRequest } from "../errors.js";
import { recordOutcomes, listAlerts } from "../observe.js";

const router = Router();

/**
 * Ground truth, reported after the fact: { outcomes: [{ predictionId, label }] }.
 * The load generator posts these with a delay to imitate labels that arrive
 * late, which is how labels arrive in real systems.
 */
router.post("/outcomes", h(async (req, res) => {
  const items = req.body?.outcomes;
  if (!Array.isArray(items)) throw badRequest("body must be { outcomes: [{ predictionId, label }] }");
  if (items.length > 5000) throw badRequest("at most 5000 outcomes per call");
  res.json(await recordOutcomes(items));
}));

router.get("/alerts", h(async (req, res) =>
  res.json(await listAlerts({ status: req.query.status || "open", limit: req.query.limit }))));

export default router;
