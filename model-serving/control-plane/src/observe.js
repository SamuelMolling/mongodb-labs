import { Collections, getDB } from "./db.js";
import { tuning } from "./config.js";
import { buildDriftPipeline, summarizeDrift } from "./drift.js";
import { getDeployment, toObjectId } from "./registry.js";
import { notFound } from "./errors.js";

/**
 * Read side of the platform: what the fleet is serving, how fast, and whether
 * it still looks like what it was trained on.
 *
 * Everything here reads inference_log, a time series collection whose
 * metaField is { deploymentId, versionId, mode }. Measurements that share a
 * meta value are stored in the same compressed buckets, so "per version, per
 * mode, last N minutes" is the cheap question to ask.
 */

const col = (name) => getDB().collection(name);
const sinceMinutes = (m) => new Date(Date.now() - Number(m || tuning.defaultWindowMin) * 60_000);

/** Pure: the per-version summary pipeline. Exported for the smoke test. */
export function buildMetricsPipeline(deploymentId, since) {
  return [
    { $match: { "meta.deploymentId": deploymentId, ts: { $gte: since } } },
    {
      $group: {
        _id: { versionId: "$meta.versionId", mode: "$meta.mode" },
        n: { $sum: 1 },
        // $percentile (MongoDB 7.0+) is approximate by design (t-digest).
        // For p99 over millions of rows that is the right trade. A mean is
        // the wrong tool here: 8 ms average can hide a 400 ms p99.
        latency: {
          $percentile: { input: "$latencyMs", p: [0.5, 0.95, 0.99], method: "approximate" },
        },
        positiveRate: { $avg: "$output.label" },
        meanScore: { $avg: "$output.score" },
        imputed: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ["$imputed", []] } }, 0] }, 1, 0] } },
        first: { $min: "$ts" },
        last: { $max: "$ts" },
      },
    },
    { $sort: { "_id.mode": 1, n: -1 } },
  ];
}

/** Pure: requests and p95 per minute per version, for the charts. */
export function buildTimelinePipeline(deploymentId, since) {
  return [
    { $match: { "meta.deploymentId": deploymentId, ts: { $gte: since } } },
    {
      $group: {
        _id: {
          minute: { $dateTrunc: { date: "$ts", unit: "minute" } },
          versionId: "$meta.versionId",
          mode: "$meta.mode",
        },
        n: { $sum: 1 },
        p95: { $percentile: { input: "$latencyMs", p: [0.95], method: "approximate" } },
        positiveRate: { $avg: "$output.label" },
      },
    },
    { $sort: { "_id.minute": 1 } },
  ];
}

async function versionLabels(ids) {
  const oids = [...new Set(ids)].filter(Boolean).map((id) => toObjectId(id));
  const docs = await col(Collections.versions)
    .find({ _id: { $in: oids } }, { projection: { version: 1, stage: 1, metrics: 1 } })
    .toArray();
  return new Map(docs.map((d) => [String(d._id), d]));
}

export async function metrics(deploymentId, minutes) {
  const since = sinceMinutes(minutes);
  const rows = await col(Collections.inferenceLog)
    .aggregate(buildMetricsPipeline(deploymentId, since))
    .toArray();
  const labels = await versionLabels(rows.map((r) => r._id.versionId));
  return {
    since,
    rows: rows.map((r) => {
      const v = labels.get(r._id.versionId);
      const [p50, p95, p99] = r.latency || [];
      return {
        versionId: r._id.versionId,
        version: v?.version ?? null,
        stage: v?.stage ?? null,
        mode: r._id.mode,
        n: r.n,
        latencyMs: { p50, p95, p99 },
        positiveRate: r.positiveRate,
        trainingPositiveRate: v?.metrics?.positiveRate ?? null,
        meanScore: r.meanScore,
        imputed: r.imputed,
        first: r.first,
        last: r.last,
      };
    }),
  };
}

export async function timeline(deploymentId, minutes) {
  const since = sinceMinutes(minutes);
  const rows = await col(Collections.inferenceLog)
    .aggregate(buildTimelinePipeline(deploymentId, since))
    .toArray();
  const labels = await versionLabels(rows.map((r) => r._id.versionId));
  return {
    since,
    points: rows.map((r) => ({
      minute: r._id.minute,
      versionId: r._id.versionId,
      version: labels.get(r._id.versionId)?.version ?? null,
      mode: r._id.mode,
      n: r.n,
      p95: r.p95?.[0] ?? null,
      positiveRate: r.positiveRate,
    })),
  };
}

/**
 * Drift for one version, or for every version the deployment currently
 * routes to when versionId is omitted. One aggregation per version: the
 * $facet computes the contract counts and the binned distribution of every
 * feature in a single pass over the window.
 */
export async function drift(deploymentId, { minutes, versionId } = {}) {
  const since = sinceMinutes(minutes);
  const dep = await getDeployment(deploymentId);
  const ids = versionId ? [versionId] : dep.routes.map((r) => String(r.versionId));

  const reports = [];
  for (const id of ids) {
    const v = await col(Collections.versions).findOne(
      { _id: toObjectId(id, "versionId") },
      { projection: { version: 1, stage: 1, baseline: 1, metrics: 1 } },
    );
    if (!v) throw notFound(`version ${id} not found`);
    const [facet] = await col(Collections.inferenceLog)
      .aggregate(buildDriftPipeline({ deploymentId, versionId: id, since, baseline: v.baseline }))
      .toArray();
    const mode = dep.routes.find((r) => String(r.versionId) === id)?.mode ?? null;
    reports.push({
      versionId: id,
      version: v.version,
      stage: v.stage,
      mode,
      features: summarizeDrift(v.baseline, facet),
    });
  }
  return { since, thresholds: { ...tuning.psi, minSamples: tuning.minDriftSamples }, reports };
}

/**
 * Real accuracy, once labels exist. Ground truth arrives later than the
 * prediction (a customer churns 30 days after the score), so it lives in a
 * regular `outcomes` collection keyed by predictionId and is joined back here.
 *
 * Shadow predictions share the live request's predictionId, so the same
 * label scores both: that is how a shadow version gets an accuracy number
 * without ever answering a user.
 */
export function buildAccuracyPipeline(deploymentId, since) {
  return [
    { $match: { "meta.deploymentId": deploymentId, ts: { $gte: since } } },
    {
      $lookup: {
        from: Collections.outcomes,
        localField: "predictionId",
        foreignField: "_id",
        as: "outcome",
      },
    },
    { $unwind: "$outcome" },
    {
      $group: {
        _id: { versionId: "$meta.versionId", mode: "$meta.mode" },
        labeled: { $sum: 1 },
        correct: { $sum: { $cond: [{ $eq: ["$output.label", "$outcome.label"] }, 1, 0] } },
        truePositives: {
          $sum: { $cond: [{ $and: [{ $eq: ["$output.label", 1] }, { $eq: ["$outcome.label", 1] }] }, 1, 0] },
        },
        positives: { $sum: "$outcome.label" },
        brier: {
          $avg: { $pow: [{ $subtract: ["$output.score", "$outcome.label"] }, 2] },
        },
        actualPositiveRate: { $avg: "$outcome.label" },
      },
    },
  ];
}

export async function accuracy(deploymentId, minutes) {
  const since = sinceMinutes(minutes || 60);
  const rows = await col(Collections.inferenceLog)
    .aggregate(buildAccuracyPipeline(deploymentId, since))
    .toArray();
  const labels = await versionLabels(rows.map((r) => r._id.versionId));
  return {
    since,
    rows: rows.map((r) => ({
      versionId: r._id.versionId,
      version: labels.get(r._id.versionId)?.version ?? null,
      mode: r._id.mode,
      labeled: r.labeled,
      accuracy: r.labeled ? r.correct / r.labeled : null,
      // Accuracy alone rewards a model that flags nobody: with a 12% churn
      // rate, "nobody churns" is 88% accurate. Recall (share of real churners
      // flagged) and the Brier score (calibration of the probability) are what
      // expose it.
      recall: r.positives ? r.truePositives / r.positives : null,
      brier: r.brier,
      actualPositiveRate: r.actualPositiveRate,
    })),
  };
}

/**
 * Did the fleet converge? A promotion is not finished when the transaction
 * commits. It is finished when every live node reports the new revision.
 */
export async function fleet(deploymentId) {
  const dep = await getDeployment(deploymentId);
  const nodes = await col(Collections.nodes)
    .find({ "deployments.deploymentId": deploymentId })
    .sort({ _id: 1 })
    .toArray();

  const staleBefore = Date.now() - tuning.staleAfterSec * 1000;
  const rows = nodes.map((n) => {
    const d = n.deployments.find((x) => x.deploymentId === deploymentId) || {};
    const stale = new Date(n.lastSeen).getTime() < staleBefore;
    return {
      nodeId: n._id,
      url: n.url,
      lastSeen: n.lastSeen,
      startedAt: n.startedAt,
      stale,
      revision: d.revision ?? null,
      versions: d.versions || [],
      status: stale ? "stale" : d.status || "unknown",
      lastError: d.lastError || null,
      stats: n.stats || {},
    };
  });

  const live = rows.filter((r) => !r.stale);
  const behind = live.filter((r) => r.revision !== dep.revision);
  return {
    revision: dep.revision,
    converged: live.length > 0 && behind.length === 0,
    liveNodes: live.length,
    behind: behind.length,
    nodes: rows,
  };
}

export async function recordOutcomes(items) {
  if (!Array.isArray(items) || items.length === 0) return { inserted: 0 };
  const docs = items
    .filter((o) => typeof o?.predictionId === "string" && (o.label === 0 || o.label === 1))
    .map((o) => ({ _id: o.predictionId, label: o.label, observedAt: new Date() }));
  if (docs.length === 0) return { inserted: 0 };
  try {
    // ordered:false so a duplicate (an outcome reported twice) does not stop
    // the rest of the batch.
    const r = await col(Collections.outcomes).insertMany(docs, { ordered: false });
    return { inserted: r.insertedCount };
  } catch (e) {
    if (e.code === 11000 || e.writeErrors) {
      return { inserted: e.result?.insertedCount ?? e.insertedCount ?? 0, duplicates: true };
    }
    throw e;
  }
}

export async function listAlerts({ deploymentId, status = "open", limit = 50 } = {}) {
  const q = {};
  if (deploymentId) q.deploymentId = deploymentId;
  if (status !== "all") q.status = status;
  return col(Collections.alerts)
    .find(q)
    .sort({ lastSeen: -1 })
    .limit(Math.min(Number(limit) || 50, 200))
    .toArray();
}
