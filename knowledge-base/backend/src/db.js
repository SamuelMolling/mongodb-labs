import { MongoClient } from "mongodb";

let client;
let db;

/**
 * `appName` lets MongoDB DevRel measure who actually runs the lab vs. who
 * just reads the article. The driver appends this to every connection's
 * client metadata and overrides any appName the user may have set in the
 * connection string.
 *
 * Naming convention:  devrel-MEDIUM-PRIMARY-SECONDARY-OPTIONAL
 *
 * For this lab: an article about MongoDB Atlas Vector Search applied to a
 * RAG knowledge base. PRIMARY=vectorsearch, SECONDARY=rag.
 */
const APP_NAME = process.env.APP_NAME || "devrel-article-vectorsearch-rag";

/**
 * Connects to MongoDB Atlas and returns the Db instance.
 * Reuses the same client across calls (connection pool).
 */
export async function connectDB() {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DATABASE || "knowledge_base";

  if (!uri) {
    throw new Error("MONGODB_URI is not set. Check your .env file.");
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

export async function closeDB() {
  if (client) await client.close();
}

/**
 * Collection helpers — centralise names so we don't sprinkle strings.
 */
export const Collections = {
  users: "users",
  workspaces: "workspaces",
  articles: "articles",
  chunks: "chunks",
  searchHistory: "search_history",
};
