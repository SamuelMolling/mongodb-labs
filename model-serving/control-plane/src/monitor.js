import { Collections, getDB } from "./db.js";
import { tuning } from "./config.js";
import { drift, metrics } from "./observe.js";

/**
 * The scheduled check.
 *
 * Alerting cannot be push-based off inference_log: time series collections
 * do not support change streams. So a job runs the same aggregations the
 * dashboard runs, on a timer, and writes what it finds to `alerts` -- a
 * regular collection, which CAN be watched by whatever pages a human.
 *
 * Alerts are upserted by a stable key (deployment, version, check, feature),
 * so a problem that persists for an hour is one alert with firstSeen and
 * lastSeen, not sixty.
 */

let timer = null;

async function upsertAlert(key, fields, active) {
  const alerts = getDB().collection(Collections.alerts);
  const now = new Date();
  if (active) {
    await alerts.updateOne(
      { _id: key },
      {
        $set: { ...fields, status: "open", lastSeen: now },
        $setOnInsert: { firstSeen: now },
      },
      { upsert: true },
    );
  } else {
    await alerts.updateOne(
      { _id: key, status: "open" },
      { $set: { status: "resolved", resolvedAt: now } },
    );
  }
}

export async function runChecks() {
  const deployments = await getDB()
    .collection(Collections.deployments)
    .find({ "routes.0": { $exists: true } })
    .toArray();

  let checked = 0;
  for (const dep of deployments) {
    const report = await drift(dep._id, { minutes: tuning.defaultWindowMin });
    for (const r of report.reports) {
      for (const f of r.features) {
        const base = { deploymentId: dep._id, versionId: r.versionId, version: r.version, mode: r.mode, feature: f.feature };

        await upsertAlert(
          `${dep._id}|${r.versionId}|contract|${f.feature}`,
          { ...base, check: "input_contract", level: "alert", value: f.contract.badShare,
            message: `${f.feature}: ${(f.contract.badShare * 100).toFixed(1)}% of requests missing, null or non-numeric` },
          f.contract.broken,
        );

        if (f.band !== "insufficient") {
          await upsertAlert(
            `${dep._id}|${r.versionId}|psi|${f.feature}`,
            { ...base, check: "input_drift", level: f.band, value: f.psi,
              message: `${f.feature}: PSI ${f.psi.toFixed(3)} (${f.band})` },
            f.band === "warn" || f.band === "alert",
          );
        }
        checked++;
      }
    }

    // Output drift: positive rate live vs the training holdout.
    const m = await metrics(dep._id, tuning.defaultWindowMin);
    for (const row of m.rows) {
      if (row.trainingPositiveRate == null || row.n < tuning.minDriftSamples) continue;
      const delta = row.positiveRate - row.trainingPositiveRate;
      await upsertAlert(
        `${dep._id}|${row.versionId}|output|${row.mode}`,
        { deploymentId: dep._id, versionId: row.versionId, version: row.version, mode: row.mode,
          check: "output_drift", level: "warn", value: delta,
          message: `positive rate ${(row.positiveRate * 100).toFixed(1)}% vs ${(row.trainingPositiveRate * 100).toFixed(1)}% at training` },
        Math.abs(delta) >= tuning.outputRateDelta,
      );
    }
  }
  return { deployments: deployments.length, checked };
}

export function startMonitor(intervalSec) {
  if (!intervalSec || intervalSec <= 0) {
    console.log("[monitor] disabled (MONITOR_INTERVAL_SEC=0)");
    return;
  }
  const tick = async () => {
    try {
      const r = await runChecks();
      console.log(`[monitor] checked ${r.checked} feature(s) across ${r.deployments} deployment(s)`);
    } catch (e) {
      console.error("[monitor] check failed:", e.message);
    }
  };
  timer = setInterval(tick, intervalSec * 1000);
  timer.unref();
  setTimeout(tick, 5_000).unref();
  console.log(`[monitor] drift/contract check every ${intervalSec}s`);
}

export function stopMonitor() {
  if (timer) clearInterval(timer);
}
