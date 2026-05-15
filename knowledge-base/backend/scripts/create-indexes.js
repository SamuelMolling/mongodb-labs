/**
 * Creates every index the platform needs:
 *
 *   1. Regular MongoDB indexes for fast operational queries
 *      (workspace lookups, history sort, etc.).
 *
 *   2. Atlas Search index on `articles` for keyword search ($search).
 *
 *   3. Atlas Vector Search index on `chunks` for semantic search
 *      ($vectorSearch).
 *
 * Atlas Search / Vector Search indexes are created via the
 * `createSearchIndexes` database command (driver method
 * `collection.createSearchIndex` / `createSearchIndexes`).
 * They are managed by Atlas separately from regular indexes.
 *
 * Run: npm run create-indexes
 */
import "dotenv/config";
import { Collections, connectDB, closeDB } from "../src/db.js";

const ATLAS_SEARCH_INDEX =
  process.env.ATLAS_SEARCH_INDEX || "articles_search";
const ATLAS_VECTOR_INDEX =
  process.env.ATLAS_VECTOR_INDEX || "chunks_vector";

// voyage-3 → 1024 dims, cosine similarity is the recommended metric.
const EMBEDDING_DIMENSIONS = 1024;
const VECTOR_SIMILARITY = "cosine";

async function createRegularIndexes(db) {
  console.log("\n→ creating regular indexes");

  await db.collection(Collections.users).createIndexes([
    { key: { email: 1 }, name: "users_email_unique", unique: true },
  ]);

  await db.collection(Collections.workspaces).createIndexes([
    { key: { slug: 1 }, name: "workspaces_slug_unique", unique: true },
    { key: { ownerId: 1 }, name: "workspaces_owner" },
  ]);

  await db.collection(Collections.articles).createIndexes([
    { key: { workspaceId: 1, updatedAt: -1 }, name: "articles_ws_updated" },
    { key: { tags: 1 }, name: "articles_tags" },
    { key: { category: 1 }, name: "articles_category" },
  ]);

  await db.collection(Collections.chunks).createIndexes([
    { key: { articleId: 1, chunkIndex: 1 }, name: "chunks_article_idx" },
    { key: { workspaceId: 1 }, name: "chunks_workspace" },
  ]);

  await db.collection(Collections.searchHistory).createIndexes([
    { key: { userId: 1, createdAt: -1 }, name: "history_user_date" },
    { key: { workspaceId: 1, createdAt: -1 }, name: "history_ws_date" },
  ]);

  console.log("  ✓ regular indexes ready");
}

/**
 * Atlas Search index — full-text search on the `articles` collection.
 * Fields: title, content (analysed with English text analyzer), tags (keyword).
 *
 * Reference:
 *   https://www.mongodb.com/docs/atlas/atlas-search/define-field-mappings/
 */
async function createAtlasSearchIndex(db) {
  console.log(`\n→ creating Atlas Search index "${ATLAS_SEARCH_INDEX}"`);

  const definition = {
    name: ATLAS_SEARCH_INDEX,
    definition: {
      mappings: {
        dynamic: false,
        fields: {
          title: { type: "string", analyzer: "lucene.english" },
          content: { type: "string", analyzer: "lucene.english" },
          summary: { type: "string", analyzer: "lucene.english" },
          tags: { type: "string", analyzer: "lucene.keyword" },
          category: { type: "string", analyzer: "lucene.keyword" },
          workspaceId: { type: "objectId" },
          visibility: { type: "string", analyzer: "lucene.keyword" },
          status: { type: "string", analyzer: "lucene.keyword" },
        },
      },
    },
  };

  await safeCreateSearchIndex(
    db.collection(Collections.articles),
    definition,
  );

  console.log("  ✓ Atlas Search index requested (may take ~1 min to build)");
}

/**
 * Atlas Vector Search index — for $vectorSearch on `chunks.embedding`.
 *
 * `filter` fields enable pre-filtering by workspaceId / visibility inside
 * the $vectorSearch stage itself (much faster than a $match downstream).
 *
 * Reference:
 *   https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-type/
 */
async function createVectorIndex(db) {
  console.log(`\n→ creating Atlas Vector Search index "${ATLAS_VECTOR_INDEX}"`);

  const definition = {
    name: ATLAS_VECTOR_INDEX,
    type: "vectorSearch",
    definition: {
      fields: [
        {
          type: "vector",
          path: "embedding",
          numDimensions: EMBEDDING_DIMENSIONS,
          similarity: VECTOR_SIMILARITY,
        },
        { type: "filter", path: "workspaceId" },
        { type: "filter", path: "visibility" },
        { type: "filter", path: "tags" },
        { type: "filter", path: "category" },
      ],
    },
  };

  await safeCreateSearchIndex(
    db.collection(Collections.chunks),
    definition,
  );

  console.log("  ✓ Vector index requested (may take a couple of minutes)");
}

async function safeCreateSearchIndex(collection, definition) {
  try {
    await collection.createSearchIndex(definition);
  } catch (err) {
    // The driver throws if the index already exists — fine, that's idempotent.
    if (err.codeName === "IndexAlreadyExists" || /already exists/i.test(err.message)) {
      console.log(`  ⚠ index "${definition.name}" already exists, skipping`);
      return;
    }
    throw err;
  }
}

async function main() {
  const db = await connectDB();
  await createRegularIndexes(db);
  await createAtlasSearchIndex(db);
  await createVectorIndex(db);
  console.log("\n✓ all indexes processed");
  await closeDB();
}

main().catch((err) => {
  console.error("\n✗ failed:", err);
  process.exit(1);
});
