import { Router } from "express";
import { h, actorOf, requireRevision, requireVersionId, depId } from "./util.js";
import { badRequest } from "../errors.js";
import { getDB, Collections } from "../db.js";
import {
  getDeployment, listHistory, promote, rollback, setCanary, setShadow,
} from "../registry.js";
import { metrics, timeline, drift, accuracy, fleet, listAlerts } from "../observe.js";

const router = Router({ mergeParams: true });

async function labelled(dep) {
  const ids = dep.routes.map((r) => r.versionId);
  const versions = await getDB().collection(Collections.versions)
    .find({ _id: { $in: ids } }, { projection: { version: 1, stage: 1, metrics: 1 } }).toArray();
  const vmap = new Map(versions.map((v) => [String(v._id), v]));
  return {
    ...dep,
    routes: dep.routes.map((r) => {
      const v = vmap.get(String(r.versionId));
      return { ...r, version: v?.version ?? null, stage: v?.stage ?? null };
    }),
  };
}

router.get("/", h(async (req, res) => {
  res.json(await labelled(await getDeployment(depId(req))));
}));

/* -- Mutations: validate the body first, touch the database second -------- */

router.post("/promote", h(async (req, res) => {
  const expectedRevision = requireRevision(req.body);
  const versionId = requireVersionId(req.body);
  const dep = await promote(depId(req), {
    versionId, expectedRevision, actor: actorOf(req), note: req.body.note,
  });
  res.json(await labelled(dep));
}));

router.post("/rollback", h(async (req, res) => {
  const expectedRevision = requireRevision(req.body);
  const dep = await rollback(depId(req), { expectedRevision, actor: actorOf(req), note: req.body.note });
  res.json(await labelled(dep));
}));

router.post("/canary", h(async (req, res) => {
  const expectedRevision = requireRevision(req.body);
  const weight = req.body?.weight;
  if (!Number.isInteger(weight)) throw badRequest("weight must be an integer, in basis points (1000 = 10%)");
  const versionId = weight === 0 ? null : requireVersionId(req.body);
  const dep = await setCanary(depId(req), {
    versionId, weight, expectedRevision, actor: actorOf(req), note: req.body.note,
  });
  res.json(await labelled(dep));
}));

router.post("/shadow", h(async (req, res) => {
  const expectedRevision = requireRevision(req.body);
  const versionId = req.body?.versionId == null ? null : requireVersionId(req.body);
  const dep = await setShadow(depId(req), {
    versionId, expectedRevision, actor: actorOf(req), note: req.body.note,
  });
  res.json(await labelled(dep));
}));

/* -- Read side ------------------------------------------------------------- */

router.get("/history", h(async (req, res) => res.json(await listHistory(depId(req), req.query.limit))));
router.get("/fleet", h(async (req, res) => res.json(await fleet(depId(req)))));
router.get("/metrics", h(async (req, res) => res.json(await metrics(depId(req), req.query.minutes))));
router.get("/timeline", h(async (req, res) => res.json(await timeline(depId(req), req.query.minutes))));
router.get("/drift", h(async (req, res) =>
  res.json(await drift(depId(req), { minutes: req.query.minutes, versionId: req.query.versionId }))));
router.get("/accuracy", h(async (req, res) => res.json(await accuracy(depId(req), req.query.minutes))));
router.get("/alerts", h(async (req, res) =>
  res.json(await listAlerts({ deploymentId: depId(req), status: req.query.status || "open" }))));

export default router;
