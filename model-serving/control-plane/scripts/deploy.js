/**
 * Deployment operations from the command line, by version NUMBER.
 *
 *   node scripts/deploy.js status   churn-classifier
 *   node scripts/deploy.js promote  churn-classifier 2
 *   node scripts/deploy.js canary   churn-classifier 2 1000     # 10%
 *   node scripts/deploy.js canary   churn-classifier 0 0        # stop canary
 *   node scripts/deploy.js shadow   churn-classifier 3          # or "off"
 *   node scripts/deploy.js rollback churn-classifier
 *   node scripts/deploy.js count    churn-classifier            # prints the number of versions
 *
 * Goes through exactly the same registry functions as the API and the UI.
 * It reads the current revision immediately before acting, which is the
 * honest version of "I know what I'm doing": if something changes in
 * between, the optimistic lock still rejects it.
 */
import "../src/env.js";
import { connectDB, closeDB, getDB, Collections } from "../src/db.js";
import {
  deploymentIdFor, getDeployment, promote, rollback, setCanary, setShadow,
} from "../src/registry.js";

const [cmd, modelId, a, b] = process.argv.slice(2);
const usage = () => {
  console.error("usage: deploy.js <status|count|promote|canary|shadow|rollback> <modelId> [version] [weightBps]");
  process.exit(2);
};
if (!cmd || !modelId) usage();

async function versionIdOf(n) {
  const v = await getDB().collection(Collections.versions).findOne({ modelId, version: Number(n) });
  if (!v) throw new Error(`${modelId} v${n} not found`);
  return String(v._id);
}

async function show(dep) {
  const ids = dep.routes.map((r) => r.versionId);
  const vs = await getDB().collection(Collections.versions).find({ _id: { $in: ids } }).toArray();
  const label = (id) => `v${vs.find((v) => String(v._id) === String(id))?.version ?? "?"}`;
  console.log(`${dep._id}  revision ${dep.revision}`);
  if (dep.routes.length === 0) console.log("  (no routes)");
  for (const r of dep.routes) {
    console.log(`  ${r.mode.padEnd(6)} ${label(r.versionId).padEnd(5)} ${(r.weight / 100).toFixed(2).padStart(6)}%`);
  }
}

try {
  await connectDB();
  const id = deploymentIdFor(modelId);
  const { revision } = await getDeployment(id);
  const actor = process.env.USER || "cli";
  let dep;

  if (cmd === "count") {
    console.log(await getDB().collection(Collections.versions).countDocuments({ modelId }));
    process.exit(0);
  }
  if (cmd === "status") dep = await getDeployment(id);
  else if (cmd === "promote") dep = await promote(id, { versionId: await versionIdOf(a), expectedRevision: revision, actor });
  else if (cmd === "rollback") dep = await rollback(id, { expectedRevision: revision, actor });
  else if (cmd === "canary") {
    const weight = Number(b);
    dep = await setCanary(id, {
      versionId: weight === 0 ? null : await versionIdOf(a), weight, expectedRevision: revision, actor,
    });
  } else if (cmd === "shadow") {
    dep = await setShadow(id, {
      versionId: a === "off" ? null : await versionIdOf(a), expectedRevision: revision, actor,
    });
  } else usage();

  await show(dep);
} catch (e) {
  console.error(`\x1b[31m✗ ${e.message}\x1b[0m`);
  process.exitCode = 1;
} finally {
  await closeDB();
}
