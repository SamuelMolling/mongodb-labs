/**
 * Seeds a demo workspace with a handful of articles, then chunks and
 * embeds every article so Vector Search has data to work with.
 *
 * Run: npm run seed
 *
 * Idempotent: re-running drops the demo workspace and re-creates it.
 */
import "dotenv/config";
import { Collections, connectDB, closeDB, getDB } from "../src/db.js";
import { embed } from "../src/voyage.js";
import { chunkText } from "../src/utils/chunker.js";

const DEMO_SLUG = "demo";

const ARTICLES = [
  {
    title: "Getting started with MongoDB Atlas Vector Search",
    summary:
      "How to enable vector search on an Atlas cluster and run your first $vectorSearch query.",
    tags: ["mongodb", "atlas", "vector-search", "tutorial"],
    category: "tutorial",
    content: `MongoDB Atlas Vector Search lets you store embeddings alongside the
documents they describe and query them with the $vectorSearch aggregation
stage. There is no separate vector database to operate.

To get started, create an Atlas cluster on M10 or higher, define a vector
search index that points at the field holding your embeddings, then issue a
$vectorSearch query with a query vector. The stage returns the documents
whose embeddings are closest under the similarity metric you chose (cosine,
dot product, or euclidean).

A common pattern is to chunk long documents, embed each chunk, store the
chunks in their own collection with a reference back to the parent, and
$lookup the parent document at query time. That keeps the operational
collection small while letting semantic search work at paragraph
granularity.`,
  },
  {
    title: "Atlas Search vs. Vector Search: when to use which",
    summary:
      "A practical comparison of keyword search and semantic search on MongoDB Atlas.",
    tags: ["mongodb", "atlas", "search", "vector-search"],
    category: "guide",
    content: `Atlas Search is built on Apache Lucene and gives you classic
full-text retrieval: BM25 scoring, language analyzers, autocomplete, fuzzy
matching, faceting, and highlights. It excels when the user knows the
keywords they are looking for.

Atlas Vector Search returns documents whose embeddings are closest to a
query embedding. It excels when the user describes what they want in
natural language and the wording differs from what is in the corpus —
synonyms, paraphrases, multilingual queries.

In practice, hybrid search wins. Run both, fuse the rankings with
Reciprocal Rank Fusion, and you get the recall of semantic search with the
precision of keyword search. MongoDB 8.1 added $rankFusion as a single
aggregation stage to do exactly this.`,
  },
  {
    title: "Designing a chunking strategy for RAG",
    summary:
      "Picking chunk size, overlap, and boundaries when feeding documents to an embedding model.",
    tags: ["rag", "embeddings", "chunking"],
    category: "guide",
    content: `Chunking is the unglamorous step that decides how good your
retrieval feels. Chunks that are too large dilute the embedding — a single
vector cannot represent five unrelated paragraphs. Chunks that are too
small lose context — the embedding describes a fragment with no
surroundings.

A reasonable default is 500–1000 characters per chunk with 10–20% overlap
between consecutive chunks. Break on natural boundaries (paragraph,
sentence) rather than fixed character counts. For technical documentation
with code blocks, prefer larger chunks so the code stays together.

Store one document per chunk in MongoDB with a reference to the parent
article. That way you can answer "which article does this passage come
from?" with a single $lookup, and re-indexing a single article is just a
deleteMany + insertMany on its chunks.`,
  },
  {
    title: "Reciprocal Rank Fusion explained",
    summary:
      "Why RRF is the default way to combine multiple ranked lists in hybrid search.",
    tags: ["search", "rrf", "hybrid"],
    category: "concept",
    content: `Reciprocal Rank Fusion combines several ranked result lists into a
single ranking. For each document and each ranker, it adds 1 / (k + rank)
to the document's score, where k is a damping constant (60 is the value
from the original paper). Documents that appear near the top of multiple
rankers get the highest fused score.

RRF is popular for hybrid keyword + vector search because the two rankers
produce scores on completely different scales: Atlas Search returns
BM25-style scores that can climb into the tens, while Vector Search
returns cosine similarities between 0 and 1. Trying to normalise and add
them is fragile. RRF only looks at rank position, so the scale problem
disappears.

The trade-off is that RRF discards score magnitude — a document that is
slightly ahead in one ranker counts the same as one that is far ahead.
For most applications this is a feature, not a bug.`,
  },
  {
    title: "Voyage AI embeddings overview",
    summary:
      "Models, dimensions, and input types offered by Voyage AI for embeddings and reranking.",
    tags: ["voyage-ai", "embeddings", "rerank"],
    category: "reference",
    content: `Voyage AI provides general-purpose and domain-specific embedding
models. voyage-3 returns 1024-dimensional vectors and supports an
input_type field that switches the model between "document" mode (for
passages you store) and "query" mode (for user queries). Using the right
input_type measurably improves retrieval quality.

For reranking, Voyage offers the rerank-2 model. A typical pipeline does
a coarse retrieval with Vector Search (say, the top 50 chunks), passes
those candidates plus the query to the reranker, and keeps the top 5–10
after reranking. The reranker is more expensive per pair than the
embedding model, so you only call it on the shortlist.`,
  },
  {
    title: "Why store embeddings in MongoDB",
    summary:
      "The case for a single database for operational data and vectors.",
    tags: ["mongodb", "architecture", "vector-database"],
    category: "opinion",
    content: `Running a separate vector database means a second store to
provision, monitor, secure, and keep in sync with your primary database.
For most applications, the gain in raw query latency is dwarfed by the
cost of consistency: when a document changes, its embedding must change
too, and the two systems can drift.

Storing embeddings in MongoDB removes that class of problem. Your
permissions live next to the vector. Your tags filter the same way at
$match time as they do inside $vectorSearch via the filter field. You
can update an article and re-index its chunks in a single transaction.
Atlas Vector Search scales horizontally with your cluster, so you do not
pay a "single database" penalty for staying simple.`,
  },
];

async function main() {
  const db = await connectDB();

  console.log("→ cleaning previous demo data");

  const oldWs = await db
    .collection(Collections.workspaces)
    .findOne({ slug: DEMO_SLUG });

  if (oldWs) {
    await db
      .collection(Collections.articles)
      .deleteMany({ workspaceId: oldWs._id });
    await db
      .collection(Collections.chunks)
      .deleteMany({ workspaceId: oldWs._id });
    await db
      .collection(Collections.workspaces)
      .deleteOne({ _id: oldWs._id });
  }

  console.log("→ creating demo user + workspace");

  const userRes = await db.collection(Collections.users).findOneAndUpdate(
    { email: "demo@knowledge-base.dev" },
    {
      $setOnInsert: {
        email: "demo@knowledge-base.dev",
        name: "Demo User",
        createdAt: new Date(),
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  const user = userRes;

  const ws = {
    name: "Demo Workspace",
    slug: DEMO_SLUG,
    ownerId: user._id,
    members: [{ userId: user._id, role: "owner" }],
    createdAt: new Date(),
  };
  const wsInsert = await db.collection(Collections.workspaces).insertOne(ws);
  ws._id = wsInsert.insertedId;

  console.log(`  ✓ workspace ${ws._id} created`);

  console.log(`→ inserting ${ARTICLES.length} articles`);
  for (const [i, a] of ARTICLES.entries()) {
    const doc = {
      workspaceId: ws._id,
      authorId: user._id,
      title: a.title,
      content: a.content,
      summary: a.summary,
      tags: a.tags,
      category: a.category,
      visibility: "workspace",
      status: "published",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const ins = await db.collection(Collections.articles).insertOne(doc);
    doc._id = ins.insertedId;

    // Chunk + embed in one batched Voyage call.
    const pieces = chunkText(`${doc.title}\n\n${doc.content}`);
    const vectors = await embed(pieces, "document");

    const chunkDocs = pieces.map((text, idx) => ({
      articleId: doc._id,
      workspaceId: ws._id,
      chunkIndex: idx,
      text,
      embedding: vectors[idx],
      tags: doc.tags,
      category: doc.category,
      visibility: doc.visibility,
      createdAt: new Date(),
    }));

    await db.collection(Collections.chunks).insertMany(chunkDocs);
    console.log(
      `  [${i + 1}/${ARTICLES.length}] ${a.title} → ${pieces.length} chunks`,
    );
  }

  console.log("\n✓ seed complete");
  console.log(`  user:      ${user._id}`);
  console.log(`  workspace: ${ws._id}`);

  await closeDB();
}

main().catch((err) => {
  console.error("\n✗ seed failed:", err);
  process.exit(1);
});
