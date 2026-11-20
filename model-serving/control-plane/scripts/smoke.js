/**
 * Offline smoke test — no cluster, no network.
 *
 * Covers everything whose correctness does not depend on a live database:
 * route arithmetic, deterministic assignment, PSI, the bin semantics the
 * drift check shares with the trainer, the shape of the pipelines and
 * validators, and the HTTP validation that must run before any database call.
 *
 * What it can NOT prove -- that the cluster agrees with all of this -- is
 * what `make e2e` is for.
 *
 * Run: npm run smoke   (or `make smoke` from the lab root)
 */
import { tuning, psiBand } from "../src/config.js";
import {
  validateRoutes, routesForPromotion, routesForCanary, routesForShadow, bucketFor, pickRoute,
} from "../src/routing.js";
import { psi, alignBins, binIndex, buildDriftPipeline, summarizeDrift, OUT_OF_RANGE } from "../src/drift.js";
import { buildMetricsPipeline, buildAccuracyPipeline } from "../src/observe.js";
import { versionValidator, deploymentValidator, regularIndexes, timeSeries } from "./schema.js";
import { createApp } from "../src/app.js";

let passed = 0;
let failed = 0;

const section = (name) => console.log(`\n${name}`);
function ok(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) console.log(`        ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
}
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccc";

/* ========================================================================== */
section("route validation");
/* ========================================================================== */

ok("empty routes are valid (a model with nothing deployed yet)", validateRoutes([]).length === 0);
ok("100% on one version is valid", validateRoutes([{ versionId: A, weight: 10000, mode: "live" }]).length === 0);
ok("live weights must sum to 10,000",
  validateRoutes([{ versionId: A, weight: 9000, mode: "live" }]).some((e) => e.includes("sum")));
ok("fractional weights are rejected (basis points are integers)",
  validateRoutes([{ versionId: A, weight: 9999.5, mode: "live" }, { versionId: B, weight: 0.5, mode: "live" }]).length > 0);
ok("a shadow route must carry weight 0",
  validateRoutes([{ versionId: A, weight: 10000, mode: "live" }, { versionId: B, weight: 1, mode: "shadow" }]).length > 0);
ok("the same version cannot appear twice",
  validateRoutes([{ versionId: A, weight: 5000, mode: "live" }, { versionId: A, weight: 5000, mode: "live" }]).length > 0);
ok("at most one shadow",
  validateRoutes([{ versionId: A, weight: 10000, mode: "live" }, { versionId: B, weight: 0, mode: "shadow" },
    { versionId: C, weight: 0, mode: "shadow" }]).length > 0);

/* ========================================================================== */
section("route builders");
/* ========================================================================== */

const withShadow = [{ versionId: A, weight: 10000, mode: "live" }, { versionId: C, weight: 0, mode: "shadow" }];

let r = routesForCanary(withShadow, A, B, 1000);
ok("canary 10%: production 9000, canary 1000", r[0].weight === 9000 && r[1].weight === 1000);
ok("canary keeps an unrelated shadow", r.some((x) => x.mode === "shadow" && x.versionId === C));
ok("canary result validates", validateRoutes(r).length === 0, validateRoutes(r));
ok("canary at 0 removes the canary", routesForCanary(r, A, null, 0).filter((x) => x.mode === "live").length === 1);
ok(`canary above ${tuning.maxCanaryWeight} is refused -- finish with promote()`,
  throws(() => routesForCanary(withShadow, A, B, 10000)));
ok("canary drops a shadow of the same version",
  !routesForCanary(withShadow, A, C, 500).some((x) => x.mode === "shadow"));

r = routesForPromotion(r, B);
ok("promotion: target at 100%, canary gone", r[0].versionId === B && r[0].weight === 10000 &&
  r.filter((x) => x.mode === "live").length === 1);
ok("promotion keeps an unrelated shadow", r.some((x) => x.mode === "shadow"));
ok("promoting the shadowed version drops its shadow route",
  !routesForPromotion(withShadow, C).some((x) => x.mode === "shadow"));

ok("shadow cannot be a live version", throws(() => routesForShadow(withShadow, A)));
ok("shadow null removes the shadow", routesForShadow(withShadow, null).length === 1);

/* ========================================================================== */
section("deterministic assignment");
/* ========================================================================== */

// Pinned vectors. python/tests/test_smoke.py pins the SAME numbers against
// the Python implementation. If either side changes, both tests fail.
const VECTORS = { "user-1": 2421, "user-2": 6585, "user-42": 9520, "acct-9001": 9646, "": 7524 };
for (const [key, bucket] of Object.entries(VECTORS)) {
  ok(`bucket("churn-classifier/prod", ${JSON.stringify(key)}) = ${bucket}`,
    bucketFor("churn-classifier/prod", key) === bucket, bucketFor("churn-classifier/prod", key));
}
ok("salting: a different deployment id gives a different bucket",
  bucketFor("other/prod", "user-1") !== bucketFor("churn-classifier/prod", "user-1"));

const dep = { _id: "churn-classifier/prod", routes: [
  { versionId: A, weight: 9000, mode: "live" }, { versionId: B, weight: 1000, mode: "live" }] };
let toB = 0;
for (let i = 0; i < 20000; i++) if (pickRoute(dep, `user-${i}`).versionId === B) toB++;
ok(`10% canary gets ~10% of users (${(toB / 200).toFixed(2)}%)`, toB > 1800 && toB < 2200);

const grown = { ...dep, routes: [{ versionId: A, weight: 7500, mode: "live" }, { versionId: B, weight: 2500, mode: "live" }] };
let stayed = true;
for (let i = 0; i < 5000; i++) {
  const k = `user-${i}`;
  if (pickRoute(dep, k).versionId === B && pickRoute(grown, k).versionId !== B) stayed = false;
}
ok("growing the canary 10% -> 25% keeps every user already in it", stayed);

/* ========================================================================== */
section("drift arithmetic");
/* ========================================================================== */

ok("PSI of identical distributions is 0", Math.abs(psi([0.25, 0.25, 0.25, 0.25, 0], [25, 25, 25, 25, 0]).value) < 1e-9);
const shifted = psi([0.25, 0.25, 0.25, 0.25, 0], [70, 10, 10, 10, 0]).value;
ok(`a clear shift scores above the alert band (${shifted.toFixed(3)})`, psiBand(shifted, 1000) === "alert");
const newBin = psi([0.5, 0.5, 0], [40, 40, 20]).value;
ok(`a bin empty at training but non-empty live is finite (${newBin.toFixed(3)})`, Number.isFinite(newBin));
ok("no samples -> no number", psi([0.5, 0.5, 0], [0, 0, 0]).value === null);
ok("too few samples -> 'insufficient', not a precise-looking number", psiBand(0.9, 10) === "insufficient");

const edges = [0, 30, 90, 365, 100000];
ok("bins are [lower, upper): 30 falls in bin 1", binIndex(edges, 30) === 1);
ok("29.999 falls in bin 0", binIndex(edges, 29.999) === 0);
ok("the last edge itself is out of range", binIndex(edges, 100000) === 4);
ok("negative values are out of range", binIndex(edges, -1) === 4);

ok("alignBins maps $bucket _id (lower edge) to the right slot and keeps empty bins",
  JSON.stringify(alignBins(edges, [{ _id: 30, n: 5 }, { _id: OUT_OF_RANGE, n: 2 }, { _id: 0, n: 1 }])) ===
    JSON.stringify([1, 5, 0, 0, 2]));

/* ========================================================================== */
section("pipelines");
/* ========================================================================== */

const baseline = { tenure_days: { edges, ratios: [0.2, 0.3, 0.3, 0.2], outOfRange: 0 } };
const pipe = buildDriftPipeline({ deploymentId: "m/prod", versionId: A, since: new Date(0), baseline });
const facet = pipe[1].$facet;
const bucket = facet.tenure_days__bins.find((s) => s.$bucket)?.$bucket;
ok("drift: $bucket has a default -- out-of-range input must not crash the job", bucket?.default === OUT_OF_RANGE);
ok("drift: nulls are filtered out BEFORE $bucket (contract, not drift)",
  facet.tenure_days__bins[0].$match?.["features.tenure_days"]?.$type === "number");
ok("drift: matches on meta fields, which is what the time series buckets by",
  pipe[0].$match["meta.deploymentId"] === "m/prod" && pipe[0].$match["meta.versionId"] === A);

const summary = summarizeDrift(baseline, {
  tenure_days__contract: [{ n: 100, missing: 0, nulls: 100, nonNumeric: 0 }],
  tenure_days__bins: [],
});
ok("a feature that is null 100% of the time is a broken contract", summary[0].contract.broken === true);

const mp = buildMetricsPipeline("m/prod", new Date(0));
const pct = mp[1].$group.latency.$percentile;
ok("metrics: $percentile with method 'approximate' and p50/p95/p99",
  pct?.method === "approximate" && JSON.stringify(pct.p) === "[0.5,0.95,0.99]");
ok("accuracy: joins outcomes by predictionId",
  buildAccuracyPipeline("m/prod", new Date(0))[1].$lookup.localField === "predictionId");

/* ========================================================================== */
section("schema");
/* ========================================================================== */

ok("version validator requires an sha256 of 64 hex chars",
  versionValidator.$jsonSchema.properties.artifact.properties.sha256.pattern === "^[a-f0-9]{64}$");
ok("deployment validator checks the weight sum with $expr", !!deploymentValidator.$and[1].$expr);
const partial = regularIndexes.model_versions.find((i) => i.options.name === "one_production_per_model");
ok("partial unique index: unique on modelId where stage = production",
  partial?.options.unique === true && partial.options.partialFilterExpression.stage === "production");
ok("serving_nodes has a TTL on lastSeen",
  regularIndexes.serving_nodes.some((i) => i.key.lastSeen === 1 && i.options.expireAfterSeconds > 0));
ok("inference_log is created as a time series with ts/meta and a TTL",
  timeSeries.options.timeseries.timeField === "ts" && timeSeries.options.timeseries.metaField === "meta" &&
  timeSeries.options.expireAfterSeconds > 0);

/* ========================================================================== */
section("http (no database)");
/* ========================================================================== */

const app = createApp();
const server = await new Promise((res) => {
  const s = app.listen(0, () => res(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
const post = (path, body) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

try {
  let res = await fetch(`${base}/health`);
  ok("GET /health -> 200", res.status === 200);

  res = await post("/api/deployments/churn-classifier/prod/promote", { versionId: A });
  ok("promote without expectedRevision -> 400 before any database call", res.status === 400);

  res = await post("/api/deployments/churn-classifier/prod/promote", { versionId: "nope", expectedRevision: 1 });
  ok("promote with a malformed versionId -> 400", res.status === 400);

  res = await post("/api/deployments/churn-classifier/prod/canary", { versionId: A, weight: 10.5, expectedRevision: 1 });
  ok("canary with a fractional weight -> 400", res.status === 400);

  res = await post("/api/outcomes", { outcomes: "nope" });
  ok("outcomes must be an array -> 400", res.status === 400);

  res = await fetch(`${base}/api/nope`);
  ok("unknown route -> 404 JSON", res.status === 404 && (await res.json()).error);
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
