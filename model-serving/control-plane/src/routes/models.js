import { Router } from "express";
import { h, actorOf } from "./util.js";
import { badRequest } from "../errors.js";
import {
  createModel, listModels, getModel, registerVersion, listVersions, getVersion,
  deploymentIdFor,
} from "../registry.js";
import { getDB, Collections } from "../db.js";

const router = Router();

/** Every model with its prod deployment, routes labelled with version numbers. */
router.get("/", h(async (_req, res) => {
  const models = await listModels();
  const deps = await getDB().collection(Collections.deployments)
    .find({ modelId: { $in: models.map((m) => m._id) } }).toArray();
  const versionIds = deps.flatMap((d) => d.routes.map((r) => r.versionId));
  const versions = await getDB().collection(Collections.versions)
    .find({ _id: { $in: versionIds } }, { projection: { version: 1, stage: 1 } }).toArray();
  const vmap = new Map(versions.map((v) => [String(v._id), v]));

  res.json(models.map((m) => {
    const d = deps.find((x) => x._id === deploymentIdFor(m._id));
    return {
      ...m,
      deployment: d && {
        _id: d._id,
        revision: d.revision,
        updatedAt: d.updatedAt,
        routes: d.routes.map((r) => ({ ...r, version: vmap.get(String(r.versionId))?.version ?? null })),
      },
    };
  }));
}));

router.post("/", h(async (req, res) => {
  if (!req.body?._id) throw badRequest("_id is required");
  res.status(201).json(await createModel(req.body, actorOf(req)));
}));

router.get("/:modelId", h(async (req, res) => {
  const model = await getModel(req.params.modelId);
  const versions = await listVersions(req.params.modelId);
  res.json({ model, versions });
}));

/**
 * What the trainer calls (through scripts/register.js) after uploading an
 * artifact. Exposed over HTTP too, so a CI job could register without a
 * database connection of its own.
 */
router.post("/:modelId/versions", h(async (req, res) => {
  res.status(201).json(await registerVersion(req.params.modelId, req.body));
}));

router.get("/:modelId/versions/:versionId", h(async (req, res) => {
  const v = await getVersion(req.params.versionId);
  if (v.modelId !== req.params.modelId) throw badRequest("version belongs to another model");
  res.json(v);
}));

export default router;
