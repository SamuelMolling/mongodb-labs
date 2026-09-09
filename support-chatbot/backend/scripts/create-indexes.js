/**
 * Creates every index this lab needs:
 *
 *   1. Regular MongoDB indexes for the operational queries (transcript
 *      lookups, analytics grouping, order history, TTL on anonymous sessions).
 *   2. Atlas Search index on `kb_articles` for keyword search ($search).
 *   3. Atlas Vector Search on `kb_chunks` and on `tickets` ($vectorSearch).
 *
 * Atlas Search / Vector Search indexes are created with the
 * `createSearchIndexes` command (driver: `collection.createSearchIndex`).
 * Atlas manages them separately from regular indexes and they take a minute
 * or two to build.
 *
 * Run: npm run create-indexes
 */
import "dotenv/config";
import { Collections, connectDB, closeDB } from "../src/db.js";
import { tuning } from "../src/config.js";

const ATLAS_SEARCH_INDEX = process.env.ATLAS_SEARCH_INDEX || "kb_articles_search";
const ATLAS_VECTOR_INDEX = process.env.ATLAS_VECTOR_INDEX || "kb_chunks_vector";
const ATLAS_TICKETS_INDEX = process.env.ATLAS_TICKETS_INDEX || "tickets_vector";

// voyage-3.5 → 1024 dims; cosine is the recommended metric.
const EMBEDDING_DIMENSIONS = 1024;
const VECTOR_SIMILARITY = "cosine";

/**
 * Creates every collection up front.
 *
 * `createIndexes` creates a missing collection implicitly; `createSearchIndex`
 * does not, and fails with NamespaceNotFound instead. On a fresh cluster the
 * search-index step therefore runs against collections nothing has written to
 * yet, which is exactly the state a first-time reader of this lab is in.
 */
async function ensureCollections(db) {
  console.log("\n→ ensuring collections exist");

  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );

  for (const name of Object.values(Collections)) {
    if (existing.has(name)) continue;
    try {
      await db.createCollection(name);
    } catch (err) {
      // Racing with another run, or created between the list and the call.
      if (err.codeName !== "NamespaceExists") throw err;
    }
  }

  console.log(`  ✓ ${Object.values(Collections).length} collections ready`);
}

async function createRegularIndexes(db) {
  console.log("\n→ creating regular indexes");

  await db.collection(Collections.customers).createIndexes([
    { key: { email: 1 }, name: "customers_email_unique", unique: true },
  ]);

  await db.collection(Collections.orders).createIndexes([
    { key: { customerId: 1, placedAt: -1 }, name: "orders_customer_date" },
    { key: { orderRef: 1 }, name: "orders_ref" },
  ]);

  // The transcript index. Every turn reads "the last K messages of this
  // conversation", which this serves as a covered index scan — descending on
  // seq so the newest turns are at the front of the range.
  await db.collection(Collections.messages).createIndexes([
    { key: { conversationId: 1, seq: -1 }, name: "messages_conversation_seq" },

    // The analytics index. Supports the knowledge-gaps aggregation, which
    // matches on confidence and groups by intent.
    { key: { "meta.confidence": 1, "meta.intent": 1 }, name: "messages_confidence_intent" },
  ]);

  await db.collection(Collections.conversations).createIndexes([
    { key: { customerId: 1, updatedAt: -1 }, name: "conversations_customer_updated" },

    /**
     * TTL on `expiresAt`, with expireAfterSeconds: 0.
     *
     * The subtlety that makes this safe: a TTL index only expires documents
     * that HAVE the indexed field. Documents without `expiresAt` are ignored
     * forever. And `expiresAt` is written in exactly one place — session
     * creation for an ANONYMOUS visitor (see memory.js).
     *
     * So the retention rule this expresses is: an anonymous session is a
     * cache, and a signed-in customer's conversation is not.
     *
     * A uniform TTL across all conversations is the version of this that
     * looks tidier and is data loss in slow motion. A customer's support
     * history is operational data with a retention policy, a compliance
     * story, and a "what did you tell me in March" question attached to it.
     * Deleting it on a rolling 30-day window destroys the record silently,
     * one document at a time, with no error and no backup — and you find out
     * when someone asks for the March conversation.
     */
    { key: { expiresAt: 1 }, name: "conversations_ttl_anonymous", expireAfterSeconds: 0 },
  ]);

  await db.collection(Collections.escalations).createIndexes([
    { key: { status: 1, createdAt: -1 }, name: "escalations_status_date" },
    { key: { conversationId: 1 }, name: "escalations_conversation" },
  ]);

  console.log("  ✓ regular indexes ready");
}

/**
 * Atlas Search index on kb_articles.
 *
 * `dynamic: false` throughout. Dynamic mapping indexes every field of every
 * document — including the ones no query touches — which inflates index size
 * and build time, and quietly makes fields searchable that were never meant
 * to be. Declaring the five fields we actually query is both cheaper and a
 * statement of intent.
 *
 * `audience`, `locale` and `status` are keyword-analysed because they are
 * enumerations, not prose: an English analyser would stem "published" and
 * make exact matching unreliable.
 */
async function createAtlasSearchIndex(db) {
  console.log(`\n→ creating Atlas Search index "${ATLAS_SEARCH_INDEX}"`);

  await safeCreateSearchIndex(db.collection(Collections.kbArticles), {
    name: ATLAS_SEARCH_INDEX,
    definition: {
      mappings: {
        dynamic: false,
        fields: {
          title: { type: "string", analyzer: "lucene.english" },
          content: { type: "string", analyzer: "lucene.english" },
          // `tags` stays an analysed string: it is scored in compound.should,
          // not filtered on.
          tags: { type: "string", analyzer: "lucene.keyword" },
          category: { type: "string", analyzer: "lucene.keyword" },

          // These three are FILTERED, never scored, so they are indexed as
          // `token`. The `in` and `equals` operators do not match an analysed
          // string field -- they return zero hits and no error, which turns
          // the whole keyword ranker off without anything in the logs saying
          // so. `token` is the type those operators are built for.
          audience: { type: "token" },
          locale: { type: "token" },
          status: { type: "token" },
        },
      },
    },
  });

  console.log("  ✓ Atlas Search index requested (may take ~1 min to build)");
}

/**
 * Vector index on kb_chunks.
 *
 * The `filter` fields are the important part. `audience` is what makes plan
 * entitlement an index-level guarantee rather than a prompt instruction: a
 * Free customer's query is never scored against an Enterprise passage, so
 * that passage cannot reach the reranker, the prompt, or the answer.
 *
 * Filter fields must be declared here to be usable in the $vectorSearch
 * `filter` — see retrieve.js.
 */
async function createVectorIndex(db) {
  console.log(`\n→ creating Vector Search index "${ATLAS_VECTOR_INDEX}"`);

  await safeCreateSearchIndex(db.collection(Collections.kbChunks), {
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
        { type: "filter", path: "audience" },
        { type: "filter", path: "locale" },
        { type: "filter", path: "status" },
        { type: "filter", path: "category" },
        { type: "filter", path: "tags" },
      ],
    },
  });

  console.log("  ✓ chunk vector index requested (may take a couple of minutes)");
}

/**
 * Vector index on tickets — the second corpus.
 *
 * `quality` is a filter field so the minimum-quality bar (see
 * tuning.ticketMinQuality) is enforced inside the index rather than after it.
 * Filtering afterwards would silently shrink the result set: `limit` is
 * applied by the index, so post-filtering a page of low-quality hits leaves
 * you with fewer results, not different ones.
 */
async function createTicketsIndex(db) {
  console.log(`\n→ creating Vector Search index "${ATLAS_TICKETS_INDEX}"`);

  await safeCreateSearchIndex(db.collection(Collections.tickets), {
    name: ATLAS_TICKETS_INDEX,
    type: "vectorSearch",
    definition: {
      fields: [
        {
          type: "vector",
          path: "embedding",
          numDimensions: EMBEDDING_DIMENSIONS,
          similarity: VECTOR_SIMILARITY,
        },
        { type: "filter", path: "status" },
        { type: "filter", path: "locale" },
        { type: "filter", path: "quality" },
      ],
    },
  });

  console.log("  ✓ ticket vector index requested");
}

async function safeCreateSearchIndex(collection, definition) {
  try {
    await collection.createSearchIndex(definition);
  } catch (err) {
    if (err.codeName === "IndexAlreadyExists" || /already exists/i.test(err.message)) {
      // Update rather than skip. Skipping makes the script silently
      // non-idempotent: a changed mapping never reaches a cluster that ran an
      // earlier version, and the mismatch only shows up as bad results.
      console.log(`  ⚠ index "${definition.name}" exists, updating definition`);
      await collection.updateSearchIndex(definition.name, definition.definition);
      return;
    }
    throw err;
  }
}

async function main() {
  const db = await connectDB();
  await ensureCollections(db);
  await createRegularIndexes(db);
  await createAtlasSearchIndex(db);
  await createVectorIndex(db);
  await createTicketsIndex(db);

  console.log("\n✓ all indexes processed");
  console.log(`  anonymous session TTL: ${tuning.anonymousSessionTtlDays} days`);
  console.log("  (identified customers have no expiresAt and are never expired)");

  await closeDB();
}

main().catch((err) => {
  console.error("\n✗ failed:", err);
  process.exit(1);
});
