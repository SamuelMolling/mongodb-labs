/**
 * Registers a trained version from the manifest the trainer wrote.
 *
 *   node scripts/register.js ../python/trainer/out/churn-classifier-logreg.json
 *
 * The trainer uploads the artifact and computes the digest and baseline; the
 * registry assigns the version number and stores the record. Keeping that
 * split means there is exactly one implementation of "register a version",
 * and it is the same one the HTTP API uses.
 */
import "../src/env.js";
import { readFile } from "node:fs/promises";
import { connectDB, closeDB } from "../src/db.js";
import { registerVersion } from "../src/registry.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/register.js <manifest.json>");
  process.exit(2);
}

try {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  await connectDB();
  const v = await registerVersion(manifest.modelId, manifest);
  console.log(
    `\x1b[32m✓ registered ${v.modelId} v${v.version}\x1b[0m  id=${v._id}  stage=${v.stage}  ` +
      `auc=${v.metrics?.auc?.toFixed?.(3) ?? "?"}  sha256=${v.artifact.sha256.slice(0, 12)}…`,
  );
} catch (e) {
  console.error(`\x1b[31m✗ ${e.message}\x1b[0m`, e.details ? JSON.stringify(e.details, null, 2) : "");
  process.exitCode = 1;
} finally {
  await closeDB();
}
