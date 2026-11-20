/**
 * End-to-end checks against a REAL cluster.
 *
 *   make e2e
 *
 * The smoke test proves the logic; this proves the database agrees with it.
 * Every claim the article makes about MongoDB behaviour is exercised here:
 * transactions, the optimistic lock under real concurrency, the partial
 * unique index, both validators, time series limits, $percentile, and change
 * stream latency.
 *
 * Runs in a THROWAWAY database (<MONGODB_DATABASE>_e2e) and drops it at the
 * end. Your demo data is not touched.
 */
import "../src/env.js";
import { randomBytes, randomUUID } from "node:crypto";

const base = process.env.MONGODB_DATABASE || "model_serving";
process.env.MONGODB_DATABASE = `${base}_e2e`;

const { connectDB, closeDB, getDB, getClient, Collections } = await import("../src/db.js");
const registry = await import("../src/registry.js");
const observe = await import("../src/observe.js");
const { applySchema } = await import("./apply-schema.js");

let passed = 0;
let failed = 0;
const ok = (label, cond, detail) => {
  if (cond) {
    passed++;
    console.log(`  \x1b[32mok\x1b[0m  ${label}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${label}`);
    if (detail !== undefined) console.log(`        ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
};
const section = (s) => console.log(`\n\x1b[36m${s}\x1b[0m`);
const expectError = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
};

const sha = () => randomBytes(32).toString("hex");
const baseline = {
  tenure_days: { edges: [0, 100, 200, 400, 100000], ratios: [0.25, 0.25, 0.25, 0.25], outOfRange: 0 },
};
const versionBody = (n) => ({
  artifact: { uri: `gridfs://artifacts/e2e-${n}`, sha256: sha(), bytes: 1, format: "onnx" },
  inputSchema: [{ name: "tenure_days", type: "double" }],
  metrics: { auc: 0.8, positiveRate: 0.2 },
  baseline,
});

const MODEL = "e2e-model";
const DEP = `${MODEL}/prod`;

async function main() {
  const db = await connectDB();
  console.log(`database: ${db.databaseName}`);

  const hello = await db.admin().command({ hello: 1 });
  const build = await db.admin().command({ buildInfo: 1 });
  section("cluster");
  ok(`replica set (needed for transactions + change streams): ${hello.setName || "none"}`, !!hello.setName);
  const major = Number(build.version.split(".")[0]);
  ok(`server ${build.version} is 7.0+ ($percentile)`, major >= 7);

  await db.dropDatabase();
  section("schema");
  await applySchema(db, () => {});
  const ts = await db.listCollections({ name: Collections.inferenceLog }).toArray();
  ok("inference_log is a time series collection", ts[0]?.type === "timeseries");

  section("registry");
  await registry.createModel({ _id: MODEL }, "e2e");
  const v1 = await registry.registerVersion(MODEL, versionBody(1));
  const v2 = await registry.registerVersion(MODEL, versionBody(2));
  const v3 = await registry.registerVersion(MODEL, versionBody(3));
  ok("version numbers come from the counter: 1, 2, 3", [v1, v2, v3].map((v) => v.version).join() === "1,2,3");

  const bad = await expectError(() => registry.registerVersion(MODEL, { ...versionBody(4), artifact: { uri: "gridfs://x", sha256: "nope" } }));
  ok("registry refuses a version without a valid sha256", bad?.status === 400);

  const raw = await expectError(() =>
    db.collection(Collections.versions).insertOne({ modelId: MODEL, version: 99, stage: "staging",
      artifact: { uri: "gridfs://x" }, inputSchema: [{ name: "a", type: "double" }], baseline: {}, registeredAt: new Date() }),
  );
  ok("$jsonSchema rejects a raw insert without a digest (code 121)", raw?.code === 121, raw?.message);

  section("promotion");
  let dep = await registry.promote(DEP, { versionId: String(v1._id), expectedRevision: 0, actor: "e2e" });
  ok("promote v1 -> revision 1, v1 at 100%", dep.revision === 1 && dep.routes[0].weight === 10000);

  const stale = await expectError(() => registry.promote(DEP, { versionId: String(v2._id), expectedRevision: 0 }));
  ok("stale expectedRevision -> 409", stale?.status === 409);

  // Two promotions racing on the same revision: exactly one may win.
  const race = await Promise.allSettled([
    registry.promote(DEP, { versionId: String(v2._id), expectedRevision: 1, actor: "alice" }),
    registry.promote(DEP, { versionId: String(v3._id), expectedRevision: 1, actor: "bob" }),
  ]);
  const won = race.filter((r) => r.status === "fulfilled");
  const lost = race.filter((r) => r.status === "rejected");
  ok("concurrent promotions: exactly one wins", won.length === 1, race.map((r) => r.status));
  ok("the loser gets 409, not a silent overwrite", lost[0]?.reason?.status === 409, lost[0]?.reason?.message);

  const prodCount = await db.collection(Collections.versions).countDocuments({ modelId: MODEL, stage: "production" });
  ok("exactly one production version after the race", prodCount === 1);

  const dup = await expectError(() =>
    db.collection(Collections.versions).updateMany({ modelId: MODEL }, { $set: { stage: "production" } }),
  );
  ok("partial unique index blocks a second production version (E11000)", dup?.code === 11000, dup?.message);

  const sumBad = await expectError(() =>
    db.collection(Collections.deployments).updateOne(
      { _id: DEP },
      { $set: { routes: [{ versionId: v1._id, weight: 9000, mode: "live" }] } },
    ),
  );
  ok("$expr validator rejects live weights that do not sum to 10,000", sumBad?.code === 121, sumBad?.message);

  section("canary, shadow, rollback");
  dep = await registry.getDeployment(DEP);
  const prod = await db.collection(Collections.versions).findOne({ modelId: MODEL, stage: "production" });
  const staging = await db.collection(Collections.versions).findOne({ modelId: MODEL, stage: "staging" });
  ok("there is a staging version left to canary", !!staging);

  dep = await registry.setCanary(DEP, { versionId: String(staging._id), weight: 1000, expectedRevision: dep.revision });
  ok("canary at 10%: 9000 / 1000", dep.routes.map((r) => r.weight).join() === "9000,1000");

  const tooMuch = await expectError(() => registry.setCanary(DEP, { versionId: String(staging._id), weight: 10000, expectedRevision: dep.revision }));
  ok("canary at 100% is refused (finish with promote)", tooMuch?.status === 400);

  // The version archived by the race is neither production nor the canary.
  const archived = await db.collection(Collections.versions).findOne({ modelId: MODEL, stage: "archived" });
  dep = await registry.setShadow(DEP, { versionId: String(archived._id), expectedRevision: dep.revision }).catch((e) => e);
  ok("shadow route added", Array.isArray(dep.routes) && dep.routes.some((r) => r.mode === "shadow"), dep.message);

  dep = await registry.getDeployment(DEP);
  dep = await registry.rollback(DEP, { expectedRevision: dep.revision, actor: "e2e" });
  const afterRb = await db.collection(Collections.versions).findOne({ modelId: MODEL, stage: "production" });
  ok("rollback brings back the previously archived version", String(afterRb._id) !== String(prod._id));

  const hist = await registry.listHistory(DEP, 100);
  const revs = hist.map((x) => x.revision);
  ok("history has one record per revision, no gaps", revs.length === dep.revision && new Set(revs).size === revs.length);

  section("time series evidence");
  const now = Date.now();
  const logs = [];
  for (let i = 0; i < 400; i++) {
    logs.push({
      ts: new Date(now - i * 500),
      meta: { deploymentId: DEP, versionId: String(afterRb._id), mode: "live" },
      predictionId: randomUUID(),
      features: { tenure_days: i % 50 === 0 ? null : 20 + i },
      output: { score: (i % 10) / 10, label: i % 10 >= 7 ? 1 : 0 },
      latencyMs: 2 + (i % 20),
      imputed: [],
    });
  }
  await db.collection(Collections.inferenceLog).insertMany(logs, { ordered: false });
  await db.collection(Collections.outcomes).insertMany(
    logs.slice(0, 100).map((l) => ({ _id: l.predictionId, label: l.output.label, observedAt: new Date() })),
  );

  const m = await observe.metrics(DEP, 60);
  const row = m.rows[0];
  ok("metrics: $percentile returned p50 <= p95 <= p99",
    row && row.latencyMs.p50 <= row.latencyMs.p95 && row.latencyMs.p95 <= row.latencyMs.p99, row?.latencyMs);

  const d = await observe.drift(DEP, { minutes: 60, versionId: String(afterRb._id) });
  const f = d.reports[0].features[0];
  ok("drift: input contract counted the nulls (8 of 400)", f.contract.nulls === 8, f.contract);
  ok("drift: values above the last edge land in out_of_range, no $bucket error",
    f.binsLive[f.binsLive.length - 1] === 0 && f.binsLive.reduce((s, x) => s + x, 0) === 392, f.binsLive);
  ok("drift: PSI is a finite number", Number.isFinite(f.psi), f.psi);

  const acc = await observe.accuracy(DEP, 60);
  ok("accuracy: $lookup joined 100 outcomes", acc.rows[0]?.labeled === 100, acc.rows);

  section("documented limits (each SHOULD fail)");
  const session = getClient().startSession();
  const txWrite = await expectError(() =>
    session.withTransaction(async () => {
      await db.collection(Collections.inferenceLog).insertOne(
        { ts: new Date(), meta: { deploymentId: DEP, versionId: "x", mode: "live" } }, { session },
      );
    }),
  );
  await session.endSession();
  ok("time series: write inside a transaction is refused", !!txWrite, "it succeeded -- check server version");

  const tsWatch = await expectError(async () => {
    const s = db.collection(Collections.inferenceLog).watch();
    try {
      await Promise.race([s.tryNext(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000))]);
    } finally {
      await s.close();
    }
  });
  ok("time series: change stream is refused", !!tsWatch && tsWatch.message !== "timeout", tsWatch?.message);

  section("change stream propagation");
  const stream = db.collection(Collections.deployments).watch(
    [{ $match: { "documentKey._id": DEP } }],
    { fullDocument: "updateLookup" },
  );
  // Open first, act second: start the cursor before the change happens.
  const first = stream.tryNext();
  await first;
  dep = await registry.getDeployment(DEP);
  const t0 = Date.now();
  const next = stream.next();
  await registry.setShadow(DEP, { versionId: null, expectedRevision: dep.revision });
  const change = await Promise.race([next, new Promise((r) => setTimeout(() => r(null), 10_000))]);
  const ms = Date.now() - t0;
  await stream.close();
  ok(`change event received in ${ms} ms with the new revision`,
    change?.fullDocument?.revision === dep.revision + 1, change?.fullDocument?.revision);
}

main()
  .catch((e) => {
    failed++;
    console.error("\n\x1b[31munexpected error:\x1b[0m", e);
  })
  .finally(async () => {
    try {
      await getDB().dropDatabase();
      console.log(`\n(dropped ${process.env.MONGODB_DATABASE})`);
    } catch {}
    await closeDB();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  });
