import { tuning } from "../src/config.js";

/**
 * Collection validators and indexes, as data. setup-db.js applies them; the
 * smoke test checks their shape offline; e2e.js proves they hold on a real
 * cluster.
 *
 * Validators are the second of three layered defenses. The transaction makes
 * a promotion atomic, but it does not make the resulting STATE valid; a
 * validator holds for every writer, including the script someone runs by
 * hand at 3 a.m. during an incident.
 */

export const versionValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["modelId", "version", "stage", "artifact", "inputSchema", "baseline", "registeredAt"],
    properties: {
      modelId: { bsonType: "string" },
      version: { bsonType: ["int", "long"], minimum: 1 },
      stage: { enum: ["none", "staging", "production", "archived"] },
      artifact: {
        bsonType: "object",
        required: ["uri", "sha256"],
        properties: {
          uri: { bsonType: "string", pattern: "^(gridfs|file|s3|gs)://" },
          // A version without a digest cannot be served safely: there is no
          // way to prove the bytes a node loaded are the bytes evaluated.
          sha256: { bsonType: "string", pattern: "^[a-f0-9]{64}$" },
        },
      },
      inputSchema: {
        bsonType: "array",
        minItems: 1,
        items: {
          bsonType: "object",
          required: ["name", "type"],
          properties: { name: { bsonType: "string" }, type: { enum: ["double", "int"] } },
        },
      },
      baseline: { bsonType: "object" },
    },
  },
};

/**
 * Deployments: the $jsonSchema covers each route; the $expr covers the
 * invariant across routes that $jsonSchema cannot express -- the weights of
 * live routes sum to exactly 10,000 (or there are none yet).
 */
export const deploymentValidator = {
  $and: [
    {
      $jsonSchema: {
        bsonType: "object",
        required: ["modelId", "routes", "revision"],
        properties: {
          revision: { bsonType: ["int", "long"], minimum: 0 },
          routes: {
            bsonType: "array",
            maxItems: 3,
            items: {
              bsonType: "object",
              required: ["versionId", "weight", "mode"],
              properties: {
                versionId: { bsonType: "objectId" },
                weight: { bsonType: ["int", "long"], minimum: 0, maximum: tuning.totalWeight },
                mode: { enum: ["live", "shadow"] },
              },
            },
          },
        },
      },
    },
    {
      $expr: {
        $in: [
          {
            $reduce: {
              input: { $filter: { input: "$routes", cond: { $eq: ["$$this.mode", "live"] } } },
              initialValue: 0,
              in: { $add: ["$$value", "$$this.weight"] },
            },
          },
          [0, tuning.totalWeight],
        ],
      },
    },
  ],
};

export const regularIndexes = {
  model_versions: [
    { key: { modelId: 1, version: 1 }, options: { unique: true, name: "model_version_unique" } },
    {
      // "At most one production version per model" as a property of the
      // database, not of the code. Any writer that tries to create a second
      // one -- including a hand-run script -- gets a duplicate key error.
      key: { modelId: 1 },
      options: {
        unique: true,
        name: "one_production_per_model",
        partialFilterExpression: { stage: "production" },
      },
    },
    { key: { modelId: 1, stage: 1, archivedAt: -1 }, options: { name: "rollback_lookup" } },
  ],
  deployment_history: [
    // One record per revision: the audit trail cannot fork.
    { key: { deploymentId: 1, revision: -1 }, options: { unique: true, name: "history_by_revision" } },
  ],
  serving_nodes: [
    { key: { lastSeen: 1 }, options: { expireAfterSeconds: tuning.nodeTtlSec, name: "dead_nodes_ttl" } },
    { key: { "deployments.deploymentId": 1 }, options: { name: "nodes_by_deployment" } },
  ],
  inference_log: [
    // Time series secondary index on metaField subfields + timeField.
    { key: { "meta.deploymentId": 1, "meta.versionId": 1, ts: -1 }, options: { name: "by_version_time" } },
  ],
  alerts: [{ key: { deploymentId: 1, status: 1, lastSeen: -1 }, options: { name: "open_alerts" } }],
};

export const timeSeries = {
  name: "inference_log",
  options: {
    timeseries: { timeField: "ts", metaField: "meta", granularity: "seconds" },
    expireAfterSeconds: tuning.inferenceLogTtlDays * 24 * 3600,
  },
};
