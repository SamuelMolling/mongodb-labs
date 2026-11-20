import { createHash } from "node:crypto";
import { tuning } from "./config.js";

/**
 * Route arithmetic for a deployment. Pure functions, no database: the smoke
 * test covers every rule here without a cluster.
 *
 * A deployment holds routes:
 *   { versionId, weight, mode: "live" | "shadow" }
 *
 *   live    answers real requests; weights of live routes sum to totalWeight
 *   shadow  gets a copy of the request, never answers; weight is always 0
 */

const idStr = (v) => (v == null ? null : String(v));

/**
 * @returns {string[]} problems; empty means valid
 */
export function validateRoutes(routes) {
  const errors = [];
  if (!Array.isArray(routes)) return ["routes must be an array"];

  const seen = new Set();
  let liveSum = 0;
  let live = 0;
  let shadow = 0;

  for (const r of routes) {
    const id = idStr(r?.versionId);
    if (!id) errors.push("every route needs a versionId");
    if (seen.has(id)) errors.push(`version ${id} appears twice`);
    seen.add(id);

    if (r.mode === "live") {
      live++;
      if (!Number.isInteger(r.weight) || r.weight < 0 || r.weight > tuning.totalWeight) {
        errors.push(`live weight must be an integer in [0, ${tuning.totalWeight}]`);
      }
      liveSum += r.weight;
    } else if (r.mode === "shadow") {
      shadow++;
      if (r.weight !== 0) errors.push("shadow routes carry weight 0");
    } else {
      errors.push(`unknown mode "${r?.mode}"`);
    }
  }

  if (live > 0 && liveSum !== tuning.totalWeight) {
    errors.push(`live weights sum to ${liveSum}, expected ${tuning.totalWeight}`);
  }
  if (live > 2) errors.push("at most one production route and one canary");
  if (shadow > 1) errors.push("at most one shadow route");
  return errors;
}

export const liveRoutes = (routes = []) => routes.filter((r) => r.mode === "live");
export const shadowRoute = (routes = []) => routes.find((r) => r.mode === "shadow") || null;

/**
 * Full rollout. The canary (if any) is dropped; a shadow survives unless it
 * IS the version being promoted.
 */
export function routesForPromotion(current, versionId) {
  const target = idStr(versionId);
  const shadow = shadowRoute(current);
  const routes = [{ versionId, weight: tuning.totalWeight, mode: "live" }];
  if (shadow && idStr(shadow.versionId) !== target) routes.push(shadow);
  return routes;
}

/**
 * Production keeps (total - weight), the canary gets weight. weight 0 removes
 * the canary. A canary is never allowed to reach 100%: see maxCanaryWeight.
 */
export function routesForCanary(current, productionVersionId, canaryVersionId, weight) {
  if (!Number.isInteger(weight) || weight < 0 || weight > tuning.maxCanaryWeight) {
    throw new RangeError(
      `canary weight must be an integer in [0, ${tuning.maxCanaryWeight}] basis points`,
    );
  }
  const shadow = shadowRoute(current);
  const routes =
    weight === 0
      ? [{ versionId: productionVersionId, weight: tuning.totalWeight, mode: "live" }]
      : [
          { versionId: productionVersionId, weight: tuning.totalWeight - weight, mode: "live" },
          { versionId: canaryVersionId, weight, mode: "live" },
        ];
  if (shadow && idStr(shadow.versionId) !== idStr(canaryVersionId)) routes.push(shadow);
  return routes;
}

/** Replaces the shadow route. versionId null removes it. */
export function routesForShadow(current, versionId) {
  const live = liveRoutes(current);
  if (versionId == null) return live;
  if (live.some((r) => idStr(r.versionId) === idStr(versionId))) {
    throw new RangeError("a version cannot shadow itself: it is already live");
  }
  return [...live, { versionId, weight: 0, mode: "shadow" }];
}

/**
 * Deterministic, stateless assignment: the same routing key always lands in
 * the same bucket on every node, in every process, in every language.
 *
 * The Python serving node implements the same function (python/serving/routing.py)
 * and the smoke tests on both sides pin the same vectors. If they ever
 * disagree, a user flips between versions depending on which pod answers --
 * and nothing errors, which is why the vectors are pinned.
 *
 * Salted with the deployment id so two experiments running at once do not
 * put the same users in the same bucket.
 */
export function bucketFor(deploymentId, routingKey) {
  const digest = createHash("sha256").update(`${deploymentId}:${routingKey}`).digest();
  return Number(digest.readBigUInt64BE(0) % BigInt(tuning.totalWeight));
}

export function pickRoute(deployment, routingKey) {
  const bucket = bucketFor(deployment._id, routingKey);
  let acc = 0;
  for (const r of liveRoutes(deployment.routes)) {
    acc += r.weight;
    if (bucket < acc) return r;
  }
  return null;
}
