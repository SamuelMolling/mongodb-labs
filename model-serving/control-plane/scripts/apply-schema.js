import { Collections } from "../src/db.js";
import { versionValidator, deploymentValidator, regularIndexes, timeSeries } from "./schema.js";

const G = "\x1b[32m", Y = "\x1b[33m", N = "\x1b[0m";

async function ensureCollection(db, name, options, log) {
  const exists = (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
  if (!exists) {
    await db.createCollection(name, options);
    log(`${G}  + created ${name}${N}`);
    return;
  }
  if (options?.validator) {
    await db.command({
      collMod: name,
      validator: options.validator,
      validationLevel: "strict",
      validationAction: "error",
    });
    log(`  = ${name} exists, validator updated`);
  } else {
    log(`  = ${name} exists`);
  }
}

/**
 * Applies collections, validators and indexes to `db`. Idempotent.
 * Shared by setup-db.js (the demo database) and e2e.js (a throwaway one).
 */
export async function applySchema(db, log = console.log) {
  const strict = { validationLevel: "strict", validationAction: "error" };
  await ensureCollection(db, Collections.models, undefined, log);
  await ensureCollection(db, Collections.versions, { validator: versionValidator, ...strict }, log);
  await ensureCollection(db, Collections.deployments, { validator: deploymentValidator, ...strict }, log);
  await ensureCollection(db, Collections.history, undefined, log);
  await ensureCollection(db, Collections.nodes, undefined, log);
  await ensureCollection(db, Collections.outcomes, undefined, log);
  await ensureCollection(db, Collections.alerts, undefined, log);

  const tsInfo = await db.listCollections({ name: timeSeries.name }).toArray();
  if (tsInfo.length === 0) {
    await db.createCollection(timeSeries.name, timeSeries.options);
    log(`${G}  + created ${timeSeries.name} (time series)${N}`);
  } else if (tsInfo[0].type !== "timeseries") {
    // A regular collection cannot be converted into a time series in place.
    throw new Error(
      `${timeSeries.name} exists but is not a time series collection: drop it and re-run`,
    );
  } else {
    log(`  = ${timeSeries.name} exists (time series)`);
  }

  for (const [coll, specs] of Object.entries(regularIndexes)) {
    for (const { key, options } of specs) {
      await db.collection(coll).createIndex(key, options);
      log(`  ✓ index ${coll}.${options.name}`);
    }
  }
}

export { Y, N };
