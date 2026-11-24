import { badRequest } from "../errors.js";

/** Wraps an async handler so a thrown error reaches the central handler. */
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Who made the change. There is no authentication in this lab (see README),
 * so this is a label, not an identity: it goes into deployment_history so the
 * audit trail has the right SHAPE, and in production it comes from a
 * verified session.
 */
export const actorOf = (req) =>
  String(req.get("x-actor") || req.body?.actor || "anonymous").slice(0, 64);

/**
 * Validation that runs BEFORE any database call. The smoke test exercises
 * these paths with no cluster, which is only possible because nothing here
 * touches MongoDB.
 */
export function requireRevision(body) {
  const r = body?.expectedRevision;
  if (!Number.isInteger(r)) {
    throw badRequest(
      "expectedRevision (integer) is required: send the revision you are changing",
    );
  }
  return r;
}

export function requireVersionId(body) {
  const v = body?.versionId;
  if (typeof v !== "string" || !/^[a-f0-9]{24}$/.test(v)) {
    throw badRequest("versionId must be a 24-char hex ObjectId string");
  }
  return v;
}

export const depId = (req) => `${req.params.modelId}/${req.params.env}`;
