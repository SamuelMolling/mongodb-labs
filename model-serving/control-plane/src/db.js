import { MongoClient } from "mongodb";

let client;
let db;

/**
 * `appName` lets MongoDB DevRel measure who actually runs the lab vs. who
 * just reads the article. The driver sends it in the client metadata of every
 * connection and it overrides any appName set in the connection string.
 *
 * Naming convention:  devrel-MEDIUM-PRIMARY-SECONDARY-OPTIONAL
 *
 * The Python side (serving nodes, trainer, load generator) sets the same
 * value, so a run of the lab shows up as one application.
 */
export const APP_NAME =
  process.env.APP_NAME || "devrel-article-changestreams-model-serving";

/**
 * Connects to MongoDB and returns the Db instance.
 * Reuses the same client across calls (connection pool).
 */
export async function connectDB() {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DATABASE || "model_serving";

  if (!uri) {
    throw new Error("MONGODB_URI is not set. Check model-serving/.env.");
  }

  client = new MongoClient(uri, {
    appName: APP_NAME, // overrides any appName in the URI; see comment above
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10_000,
  });

  await client.connect();
  await client.db("admin").command({ ping: 1 });

  db = client.db(dbName);
  console.log(`[mongo] connected to database "${dbName}"`);
  return db;
}

export function getDB() {
  if (!db) throw new Error("DB not initialized. Call connectDB() first.");
  return db;
}

/** Transactions need the client (sessions are client-scoped, not db-scoped). */
export function getClient() {
  if (!client) throw new Error("DB not initialized. Call connectDB() first.");
  return client;
}

export async function closeDB() {
  if (client) await client.close();
  client = undefined;
  db = undefined;
}

/**
 * Collection names, in one place. The Python side keeps the same list in
 * python/common/db.py -- change both together.
 *
 * Three collections hold the control-plane STATE and change inside
 * transactions: model_versions, deployments, deployment_history.
 *
 * inference_log is a time series collection and holds EVIDENCE. Time series
 * collections cannot be written inside a transaction and cannot be watched
 * with a change stream, which is why nothing in the promotion path touches it
 * and why alerting is a scheduled job (monitor.js), not a stream.
 */
export const Collections = {
  models: "models",
  versions: "model_versions",
  deployments: "deployments",
  history: "deployment_history",
  nodes: "serving_nodes",
  inferenceLog: "inference_log",
  outcomes: "outcomes",
  alerts: "alerts",
};

export const ARTIFACT_BUCKET = "artifacts"; // GridFS: artifacts.files + artifacts.chunks
