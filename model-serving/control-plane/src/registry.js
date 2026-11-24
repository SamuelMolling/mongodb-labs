import { ObjectId } from "mongodb";
import { Collections, getClient, getDB } from "./db.js";
import { tuning } from "./config.js";
import { HttpError, badRequest, conflict, notFound } from "./errors.js";
import {
  validateRoutes,
  liveRoutes,
  routesForPromotion,
  routesForCanary,
  routesForShadow,
} from "./routing.js";

/**
 * The registry: models, versions, deployments, and every operation that moves
 * a version between stages or changes what a deployment routes to.
 *
 * Every mutating operation follows the same shape:
 *
 *   1. one multi-document transaction
 *   2. an optimistic lock on deployments.revision (the caller says which
 *      revision it is changing; if that is no longer current, 409)
 *   3. one deployment_history record, written in the same transaction
 *
 * The transaction makes the change atomic. It does not make the state valid:
 * the partial unique index and the $jsonSchema validator (scripts/setup-db.js)
 * do that, and they hold even for a script someone runs by hand during an
 * incident.
 */

const col = {
  models: () => getDB().collection(Collections.models),
  versions: () => getDB().collection(Collections.versions),
  deployments: () => getDB().collection(Collections.deployments),
  history: () => getDB().collection(Collections.history),
};

export const deploymentIdFor = (modelId, env = "prod") => `${modelId}/${env}`;

const MODEL_ID = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function toObjectId(id, what = "id") {
  if (id instanceof ObjectId) return id;
  if (typeof id === "string" && ObjectId.isValid(id) && id.length === 24) return new ObjectId(id);
  throw badRequest(`${what} is not a valid ObjectId`);
}

/**
 * Runs fn inside a transaction and returns what fn returned.
 *
 * withTransaction retries the whole callback on transient errors, so fn must
 * be safe to run more than once: it only reads and writes through `session`,
 * and keeps no side effects outside the database.
 */
async function inTransaction(fn) {
  const session = getClient().startSession();
  let result;
  try {
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        readPreference: "primary",
      },
    );
    return result;
  } finally {
    await session.endSession();
  }
}

/* ========================================================================== */
/* Models                                                                     */
/* ========================================================================== */

/**
 * Creates the model AND its (empty) prod deployment together, so every later
 * operation can lock on an existing deployment.revision instead of special-
 * casing "first promotion" with an upsert.
 */
export async function createModel({ _id, owner, task, description }, actor = "system") {
  if (!MODEL_ID.test(_id || "")) {
    throw badRequest("model id must be lowercase letters, digits and dashes (2-63 chars)");
  }
  const now = new Date();
  return inTransaction(async (session) => {
    try {
      await col.models().insertOne(
        { _id, owner: owner || null, task: task || "binary_classification",
          description: description || "", lastVersion: 0, createdAt: now },
        { session },
      );
    } catch (e) {
      if (e.code === 11000) throw conflict(`model "${_id}" already exists`);
      throw e;
    }
    const dep = {
      _id: deploymentIdFor(_id),
      modelId: _id,
      env: "prod",
      routes: [],
      revision: 0,
      createdAt: now,
      updatedAt: now,
      updatedBy: actor,
    };
    await col.deployments().insertOne(dep, { session });
    return { model: { _id }, deployment: dep };
  });
}

export async function listModels() {
  return col.models().find({}).sort({ _id: 1 }).toArray();
}

export async function getModel(modelId) {
  const m = await col.models().findOne({ _id: modelId });
  if (!m) throw notFound(`model "${modelId}" not found`);
  return m;
}

/* ========================================================================== */
/* Versions                                                                   */
/* ========================================================================== */

const REQUIRED_VERSION_FIELDS = ["artifact", "inputSchema", "baseline"];

/**
 * Registers an immutable version in stage "staging".
 *
 * The version NUMBER comes from a counter on the model document ($inc is
 * atomic), not from "find the max and add one", which two concurrent training
 * jobs would both read as 41 and both turn into 42.
 *
 * The artifact must already be uploaded: the registry points at bytes, it
 * does not hold them. The sha256 is what lets a serving node prove that the
 * bytes it loaded are the bytes these metrics describe.
 */
export async function registerVersion(modelId, body) {
  for (const f of REQUIRED_VERSION_FIELDS) {
    if (body?.[f] == null) throw badRequest(`missing field "${f}"`);
  }
  const a = body.artifact;
  if (!a.uri || !/^[a-f0-9]{64}$/.test(a.sha256 || "")) {
    throw badRequest("artifact needs a uri and a lowercase hex sha256");
  }
  if (!Array.isArray(body.inputSchema) || body.inputSchema.length === 0) {
    throw badRequest("inputSchema must be a non-empty array of { name, type }");
  }

  const counter = await col.models().findOneAndUpdate(
    { _id: modelId },
    { $inc: { lastVersion: 1 } },
    { returnDocument: "after" },
  );
  if (!counter) throw notFound(`model "${modelId}" not found`);

  const doc = {
    modelId,
    version: counter.lastVersion,
    stage: "staging",
    framework: body.framework || null,
    artifact: { uri: a.uri, sha256: a.sha256, bytes: a.bytes ?? null, format: a.format || "onnx" },
    inputSchema: body.inputSchema,
    output: body.output || null,
    metrics: body.metrics || {},
    trainingRef: body.trainingRef || {},
    baseline: body.baseline,
    description: body.description || "",
    registeredAt: new Date(),
  };

  try {
    const { insertedId } = await col.versions().insertOne(doc);
    return { _id: insertedId, ...doc };
  } catch (e) {
    // 121 = DocumentValidationFailure: the $jsonSchema validator said no.
    if (e.code === 121) {
      throw badRequest("version rejected by schema validation", e.errInfo?.details);
    }
    throw e;
  }
}

export async function listVersions(modelId) {
  return col
    .versions()
    .find({ modelId }, { projection: { baseline: 0 } })
    .sort({ version: -1 })
    .toArray();
}

export async function getVersion(versionId) {
  const v = await col.versions().findOne({ _id: toObjectId(versionId, "versionId") });
  if (!v) throw notFound("version not found");
  return v;
}

/* ========================================================================== */
/* Deployments                                                                */
/* ========================================================================== */

export async function getDeployment(deploymentId) {
  const d = await col.deployments().findOne({ _id: deploymentId });
  if (!d) throw notFound(`deployment "${deploymentId}" not found`);
  return d;
}

export async function listHistory(deploymentId, limit = 50) {
  return col
    .history()
    .find({ deploymentId })
    .sort({ revision: -1 })
    .limit(Math.min(Number(limit) || 50, 200))
    .toArray();
}

/**
 * The shared skeleton of every deployment change.
 *
 * `plan(dep, session)` reads whatever it needs through the session, applies
 * any stage changes, and returns { routes, action, versionId?, note? }.
 * This function owns the parts that must never differ between operations:
 * the revision check, route validation, the $inc, and the history record.
 */
async function changeDeployment(deploymentId, expectedRevision, actor, plan) {
  if (!Number.isInteger(expectedRevision)) {
    throw badRequest(
      "expectedRevision is required: send the revision you are changing, " +
        "so a concurrent change fails instead of being silently overwritten",
    );
  }

  return inTransaction(async (session) => {
    const dep = await col.deployments().findOne({ _id: deploymentId }, { session });
    if (!dep) throw notFound(`deployment "${deploymentId}" not found`);
    if (dep.revision !== expectedRevision) {
      throw conflict(
        `deployment is at revision ${dep.revision}, not ${expectedRevision}: ` +
          "someone changed it since you looked",
        { current: dep },
      );
    }

    const { routes, action, versionId, note } = await plan(dep, session);

    const problems = validateRoutes(routes);
    if (problems.length) throw badRequest("invalid routes", problems);

    const now = new Date();
    const updated = await col.deployments().findOneAndUpdate(
      { _id: deploymentId, revision: expectedRevision }, // optimistic lock
      { $set: { routes, updatedAt: now, updatedBy: actor }, $inc: { revision: 1 } },
      { session, returnDocument: "after" },
    );
    if (!updated) {
      // Unreachable in practice (we read the same revision in this snapshot),
      // but the filter is the real guarantee, so the check stays.
      throw conflict("concurrent change to deployment", { deploymentId });
    }

    await col.history().insertOne(
      {
        deploymentId,
        revision: updated.revision,
        action,
        versionId: versionId ?? null,
        routes,
        previousRoutes: dep.routes,
        actor,
        note: note || "",
        at: now,
      },
      { session },
    );

    return updated;
  });
}

async function versionInTxn(session, modelId, versionId) {
  const v = await col.versions().findOne(
    { _id: toObjectId(versionId, "versionId"), modelId },
    { session, projection: { baseline: 0 } },
  );
  if (!v) throw notFound("version not found for this model");
  return v;
}

/**
 * Full rollout of one version.
 *
 *   current production  -> archived
 *   target              -> production
 *   routes              -> [target 100% live] (+ an unrelated shadow, if any)
 *
 * The archive happens BEFORE the promotion inside the transaction. The partial
 * unique index ({ modelId: 1 } where stage = "production") is checked per
 * statement, and the reverse order would briefly hold two production versions
 * and fail with a duplicate key -- which is the index doing its job.
 *
 * `from` widens which stages may be promoted: "staging" for a normal release,
 * "archived" for a rollback. Same transaction, same lock, same history
 * record: there is no separate rollback path to rot from disuse.
 */
export async function promote(deploymentId, { versionId, expectedRevision, actor = "system", note,
  action = "promote", from = ["staging"] }) {
  return changeDeployment(deploymentId, expectedRevision, actor, async (dep, session) => {
    const target = await versionInTxn(session, dep.modelId, versionId);
    if (!from.includes(target.stage)) {
      throw conflict(`version v${target.version} is "${target.stage}"; ${action} accepts ${from.join(" or ")}`);
    }

    const now = new Date();
    await col.versions().updateOne(
      { modelId: dep.modelId, stage: "production" },
      { $set: { stage: "archived", archivedAt: now } },
      { session },
    );
    const res = await col.versions().updateOne(
      { _id: target._id, stage: target.stage },
      { $set: { stage: "production", promotedAt: now }, $unset: { archivedAt: "" } },
      { session },
    );
    if (res.modifiedCount !== 1) throw conflict("version stage changed concurrently");

    return {
      routes: routesForPromotion(dep.routes, target._id),
      action,
      versionId: target._id,
      note: note || `v${target.version} to 100%`,
    };
  });
}

/**
 * Rollback = promote the most recently archived version.
 * Picked by archivedAt, i.e. "what was in production right before".
 */
export async function rollback(deploymentId, { expectedRevision, actor = "system", note }) {
  const dep = await getDeployment(deploymentId);
  const previous = await col
    .versions()
    .find({ modelId: dep.modelId, stage: "archived" }, { projection: { _id: 1, version: 1 } })
    .sort({ archivedAt: -1 })
    .limit(1)
    .next();
  if (!previous) throw conflict("nothing to roll back to: no archived version");
  return promote(deploymentId, {
    versionId: previous._id,
    expectedRevision,
    actor,
    action: "rollback",
    from: ["archived"],
    note: note || `rollback to v${previous.version}`,
  });
}

/**
 * Canary: a second live route with a small weight. The canary stays in
 * stage "staging" -- only one version is ever "production" -- and finishing
 * the rollout is a promote().
 */
export async function setCanary(deploymentId, { versionId, weight, expectedRevision, actor = "system", note }) {
  return changeDeployment(deploymentId, expectedRevision, actor, async (dep, session) => {
    const prod = await col.versions().findOne(
      { modelId: dep.modelId, stage: "production" },
      { session, projection: { _id: 1, version: 1 } },
    );
    if (!prod) throw conflict("no production version yet: promote one before starting a canary");

    const w = Number(weight);
    let canaryId = null;
    let label = "canary removed";
    if (w !== 0) {
      const target = await versionInTxn(session, dep.modelId, versionId);
      if (target.stage !== "staging") {
        throw conflict(`only staging versions can be canaried; v${target.version} is "${target.stage}"`);
      }
      canaryId = target._id;
      label = `v${target.version} canary at ${(w / 100).toFixed(2)}%`;
    }

    let routes;
    try {
      routes = routesForCanary(dep.routes, prod._id, canaryId, w);
    } catch (e) {
      throw badRequest(e.message);
    }
    return { routes, action: w === 0 ? "canary_stop" : "canary", versionId: canaryId, note: note || label };
  });
}

/** Shadow: copy of every request, prediction logged, never returned. */
export async function setShadow(deploymentId, { versionId, expectedRevision, actor = "system", note }) {
  return changeDeployment(deploymentId, expectedRevision, actor, async (dep, session) => {
    if (liveRoutes(dep.routes).length === 0) {
      throw conflict("nothing to shadow: the deployment has no live route yet");
    }
    let shadowId = null;
    let label = "shadow removed";
    if (versionId != null) {
      const target = await versionInTxn(session, dep.modelId, versionId);
      if (!["staging", "archived"].includes(target.stage)) {
        throw conflict(`v${target.version} is "${target.stage}" and cannot be a shadow`);
      }
      shadowId = target._id;
      label = `v${target.version} shadowing`;
    }
    let routes;
    try {
      routes = routesForShadow(dep.routes, shadowId);
    } catch (e) {
      throw badRequest(e.message);
    }
    return { routes, action: shadowId ? "shadow" : "shadow_stop", versionId: shadowId, note: note || label };
  });
}

export { HttpError, tuning };
