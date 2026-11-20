/**
 * Creates collections, validators and indexes. Idempotent: safe to re-run.
 *
 *   model_versions       $jsonSchema validator + partial unique index
 *   deployments          $jsonSchema + $expr validator (weights sum to 10,000)
 *   deployment_history   unique (deploymentId, revision)
 *   serving_nodes        TTL on lastSeen
 *   inference_log        TIME SERIES collection, with expireAfterSeconds
 *   outcomes, alerts     regular
 *
 * Also creates the demo model "churn-classifier" and its empty prod
 * deployment, if missing.
 */
import "../src/env.js";
import { connectDB, closeDB, getDB, Collections } from "../src/db.js";
import { createModel } from "../src/registry.js";
import { applySchema } from "./apply-schema.js";

const C = "\x1b[36m", G = "\x1b[32m", N = "\x1b[0m";

async function main() {
  await connectDB();
  const db = getDB();

  console.log(`${C}→ collections, validators, indexes${N}`);
  await applySchema(db);

  console.log(`${C}→ demo model${N}`);
  const existing = await db.collection(Collections.models).findOne({ _id: "churn-classifier" });
  if (existing) {
    console.log("  = churn-classifier exists");
  } else {
    await createModel(
      { _id: "churn-classifier", owner: "growth-ml", task: "binary_classification",
        description: "Probability that an account churns in the next 30 days" },
      "setup",
    );
    console.log(`${G}  + churn-classifier + deployment churn-classifier/prod (revision 0)${N}`);
  }
  console.log(`${G}✓ database ready${N}`);
}

main()
  .catch((e) => {
    console.error(`\x1b[31m✗ ${e.message}\x1b[0m`);
    process.exitCode = 1;
  })
  .finally(closeDB);
