/**
 * Bulk seed: generates N synthetic articles, chunks them, embeds the
 * chunks in batches via Voyage AI, and inserts everything with insertMany.
 *
 * Usage:
 *   npm run seed-bulk -- --count=1000
 *   npm run seed-bulk -- --count=5000 --workspace=demo-large --embed-batch=96
 *   npm run seed-bulk -- --count=200 --no-embed   # skip Voyage (no vector search, just docs)
 *
 * Flags:
 *   --count        How many articles to create.            default: 1000
 *   --workspace    Slug for the workspace.                  default: demo-bulk
 *   --embed-batch  Texts per Voyage call (max 128).         default: 96
 *   --insert-batch Articles per Mongo insertMany call.      default: 250
 *   --concurrency  Parallel Voyage requests in flight.      default: 4
 *   --seed         RNG seed for reproducible generation.    default: 42
 *   --no-embed     Skip embedding (fast, but no vector search).
 *   --reset        Drop the target workspace before seeding.
 *
 * Notes on cost & time:
 *   - voyage-3 is priced per token. Each article produces ~3–5 chunks of
 *     ~800 chars each → ~250 tokens per chunk. 1000 articles ≈ ~3500
 *     chunks ≈ ~875K tokens. Check the live pricing before running
 *     anything in the 10k+ range.
 *   - --no-embed lets you stress-test Atlas Search alone without any
 *     Voyage spend.
 */
import "dotenv/config";
import { ObjectId } from "mongodb";
import { Collections, connectDB, closeDB, getDB } from "../src/db.js";
import { embed } from "../src/voyage.js";
import { chunkText } from "../src/utils/chunker.js";
import { buildArticle } from "./generators.js";

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */
function parseArgs() {
  const args = {
    count: 1000,
    workspace: "demo-bulk",
    embedBatch: 96,
    insertBatch: 250,
    concurrency: 4,
    seed: 42,
    noEmbed: false,
    reset: false,
  };

  for (const raw of process.argv.slice(2)) {
    const [k, v] = raw.replace(/^--/, "").split("=");
    switch (k) {
      case "count":        args.count = parseInt(v, 10); break;
      case "workspace":    args.workspace = v; break;
      case "embed-batch":  args.embedBatch = parseInt(v, 10); break;
      case "insert-batch": args.insertBatch = parseInt(v, 10); break;
      case "concurrency":  args.concurrency = parseInt(v, 10); break;
      case "seed":         args.seed = parseInt(v, 10); break;
      case "no-embed":     args.noEmbed = true; break;
      case "reset":        args.reset = true; break;
      default: throw new Error(`unknown flag --${k}`);
    }
  }
  if (args.embedBatch > 128) {
    console.warn("⚠ Voyage's max batch is 128; clamping --embed-batch=128");
    args.embedBatch = 128;
  }
  return args;
}

/* -------------------------------------------------------------------------- */
/* Concurrency helper                                                         */
/* -------------------------------------------------------------------------- */
async function parallelMap(items, concurrency, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return out;
}

/* -------------------------------------------------------------------------- */
/* Setup                                                                      */
/* -------------------------------------------------------------------------- */
async function ensureWorkspace(slug, reset) {
  const db = getDB();
  let ws = await db.collection(Collections.workspaces).findOne({ slug });

  if (ws && reset) {
    console.log(`→ dropping previous workspace "${slug}"`);
    await db.collection(Collections.articles).deleteMany({ workspaceId: ws._id });
    await db.collection(Collections.chunks).deleteMany({ workspaceId: ws._id });
    await db.collection(Collections.workspaces).deleteOne({ _id: ws._id });
    ws = null;
  }

  if (!ws) {
    const userRes = await db.collection(Collections.users).findOneAndUpdate(
      { email: "bulk-seed@knowledge-base.dev" },
      {
        $setOnInsert: {
          email: "bulk-seed@knowledge-base.dev",
          name: "Bulk Seed",
          createdAt: new Date(),
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    const user = userRes;

    const insert = await db.collection(Collections.workspaces).insertOne({
      name: `Bulk Workspace (${slug})`,
      slug,
      ownerId: user._id,
      members: [{ userId: user._id, role: "owner" }],
      createdAt: new Date(),
    });
    ws = await db
      .collection(Collections.workspaces)
      .findOne({ _id: insert.insertedId });
    console.log(`→ created workspace ${ws._id} (${slug})`);
  } else {
    console.log(`→ reusing workspace ${ws._id} (${slug})`);
  }
  return ws;
}

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                   */
/* -------------------------------------------------------------------------- */
function logProgress(label, done, total, startedAt) {
  const pct = ((done / total) * 100).toFixed(1);
  const elapsed = (Date.now() - startedAt) / 1000;
  const rate = done / Math.max(elapsed, 0.01);
  const eta = rate > 0 ? ((total - done) / rate).toFixed(0) : "?";
  process.stdout.write(
    `\r  ${label}: ${done}/${total} (${pct}%) · ${rate.toFixed(1)}/s · eta ${eta}s   `,
  );
}

async function main() {
  const args = parseArgs();
  console.log("→ bulk seed configuration", args);

  const db = await connectDB();
  const ws = await ensureWorkspace(args.workspace, args.reset);

  /* ---------- 1. generate article drafts ---------- */
  console.log(`\n→ generating ${args.count} synthetic articles`);
  const drafts = Array.from({ length: args.count }, (_, i) =>
    buildArticle(i, args.seed),
  );

  /* ---------- 2. insert articles ---------- */
  console.log(`\n→ inserting articles (batch=${args.insertBatch})`);
  const startedArticles = Date.now();
  const articlesCol = db.collection(Collections.articles);
  const insertedArticles = [];

  for (let i = 0; i < drafts.length; i += args.insertBatch) {
    const slice = drafts.slice(i, i + args.insertBatch).map((d) => ({
      workspaceId: ws._id,
      authorId: ws.ownerId,
      title: d.title,
      content: d.content,
      summary: d.summary,
      tags: d.tags,
      category: d.category,
      visibility: "workspace",
      status: "published",
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const res = await articlesCol.insertMany(slice, { ordered: false });
    for (let j = 0; j < slice.length; j++) {
      slice[j]._id = res.insertedIds[j];
      insertedArticles.push(slice[j]);
    }
    logProgress("articles", insertedArticles.length, drafts.length, startedArticles);
  }
  console.log("\n  ✓ articles inserted");

  /* ---------- 3. build chunk records (no embedding yet) ---------- */
  console.log(`\n→ chunking ${insertedArticles.length} articles`);
  const chunks = [];
  for (const art of insertedArticles) {
    // Title as H1 so it becomes the breadcrumb root in every chunk.
    const pieces = chunkText(`# ${art.title}\n\n${art.content}`);
    pieces.forEach((text, idx) => {
      chunks.push({
        articleId: art._id,
        workspaceId: ws._id,
        chunkIndex: idx,
        text,
        tags: art.tags,
        category: art.category,
        visibility: art.visibility,
        createdAt: new Date(),
      });
    });
  }
  console.log(`  ✓ ${chunks.length} chunks ready`);

  /* ---------- 4. embed + insert chunks ---------- */
  if (args.noEmbed) {
    console.log("\n→ --no-embed: inserting chunks without embeddings");
    for (let i = 0; i < chunks.length; i += args.insertBatch) {
      const slice = chunks.slice(i, i + args.insertBatch);
      await db.collection(Collections.chunks).insertMany(slice, { ordered: false });
    }
    console.log("  ✓ chunks inserted (no embeddings, vector search will be empty)");
  } else {
    console.log(
      `\n→ embedding ${chunks.length} chunks (Voyage batch=${args.embedBatch}, concurrency=${args.concurrency})`,
    );
    const startedEmbeds = Date.now();

    // Split into Voyage-sized batches first, then run them in parallel.
    const batches = [];
    for (let i = 0; i < chunks.length; i += args.embedBatch) {
      batches.push({ start: i, end: Math.min(i + args.embedBatch, chunks.length) });
    }

    let embeddedCount = 0;

    await parallelMap(batches, args.concurrency, async (batch) => {
      const slice = chunks.slice(batch.start, batch.end);
      const texts = slice.map((c) => c.text);

      let attempt = 0;
      while (true) {
        try {
          const vectors = await embed(texts, "document");
          slice.forEach((c, k) => (c.embedding = vectors[k]));
          break;
        } catch (err) {
          attempt++;
          if (attempt > 4) throw err;
          // Voyage rate-limits with 429; back off exponentially.
          const wait = 500 * 2 ** attempt + Math.random() * 200;
          process.stdout.write(`\n  ⚠ embed retry ${attempt} in ${wait.toFixed(0)}ms: ${err.message}`);
          await new Promise((r) => setTimeout(r, wait));
        }
      }

      // Insert this slice's chunks immediately — keeps memory flat for huge runs.
      await db
        .collection(Collections.chunks)
        .insertMany(slice, { ordered: false });

      embeddedCount += slice.length;
      logProgress("chunks", embeddedCount, chunks.length, startedEmbeds);
    });

    console.log("\n  ✓ chunks embedded + inserted");
  }

  /* ---------- 5. summary ---------- */
  const articlesTotal = await db
    .collection(Collections.articles)
    .countDocuments({ workspaceId: ws._id });
  const chunksTotal = await db
    .collection(Collections.chunks)
    .countDocuments({ workspaceId: ws._id });

  console.log("\n✓ bulk seed complete");
  console.log(`  workspace : ${ws._id}  (slug=${ws.slug})`);
  console.log(`  articles  : ${articlesTotal}`);
  console.log(`  chunks    : ${chunksTotal}`);
  console.log(
    `  use this id in NEXT_PUBLIC_WORKSPACE_ID or ?workspaceId=${ws._id}`,
  );

  await closeDB();
}

main().catch(async (err) => {
  console.error("\n✗ bulk seed failed:", err);
  await closeDB();
  process.exit(1);
});
