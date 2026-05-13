import { Router } from "express";
import { ObjectId } from "mongodb";
import { Collections, getDB } from "../db.js";
import { embed } from "../voyage.js";
import { chunkText } from "../utils/chunker.js";

const router = Router();

/**
 * Generates chunks + embeddings and stores them in the `chunks` collection,
 * one document per chunk. We embed in a single batched Voyage call.
 */
async function indexArticleChunks(article) {
  const db = getDB();
  const chunksCol = db.collection(Collections.chunks);

  // Replace any existing chunks for this article (simplifies re-indexing).
  await chunksCol.deleteMany({ articleId: article._id });

  const corpus = `${article.title}\n\n${article.content}`;
  const pieces = chunkText(corpus);

  if (pieces.length === 0) return 0;

  const vectors = await embed(pieces, "document");

  const docs = pieces.map((text, i) => ({
    articleId: article._id,
    workspaceId: article.workspaceId,
    chunkIndex: i,
    text,
    embedding: vectors[i],
    tags: article.tags ?? [],
    category: article.category ?? null,
    visibility: article.visibility,
    createdAt: new Date(),
  }));

  await chunksCol.insertMany(docs);
  return docs.length;
}

/**
 * POST /api/articles — create + index a new article.
 */
router.post("/", async (req, res, next) => {
  try {
    const {
      workspaceId,
      authorId,
      title,
      content,
      summary = "",
      tags = [],
      category = null,
      visibility = "workspace",
      status = "published",
    } = req.body;

    if (!workspaceId || !authorId || !title || !content) {
      return res.status(400).json({
        error: "workspaceId, authorId, title and content are required",
      });
    }

    const articles = getDB().collection(Collections.articles);

    const doc = {
      workspaceId: new ObjectId(workspaceId),
      authorId: new ObjectId(authorId),
      title,
      content,
      summary,
      tags,
      category,
      visibility,
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await articles.insertOne(doc);
    const saved = { _id: result.insertedId, ...doc };

    const chunkCount = await indexArticleChunks(saved);

    res.status(201).json({ ...saved, chunkCount });
  } catch (err) {
    next(err);
  }
});

/** GET /api/articles — list with simple filters. */
router.get("/", async (req, res, next) => {
  try {
    const { workspaceId, tag, category, status } = req.query;
    const filter = {};
    if (workspaceId) filter.workspaceId = new ObjectId(workspaceId);
    if (tag) filter.tags = tag;
    if (category) filter.category = category;
    if (status) filter.status = status;

    const list = await getDB()
      .collection(Collections.articles)
      .find(filter, { projection: { content: 0 } })
      .sort({ updatedAt: -1 })
      .limit(100)
      .toArray();

    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const article = await getDB()
      .collection(Collections.articles)
      .findOne({ _id: new ObjectId(req.params.id) });
    if (!article) return res.status(404).json({ error: "article not found" });
    res.json(article);
  } catch (err) {
    next(err);
  }
});

/** PUT /api/articles/:id — update and re-index. */
router.put("/:id", async (req, res, next) => {
  try {
    const id = new ObjectId(req.params.id);
    const articles = getDB().collection(Collections.articles);

    const updatable = [
      "title",
      "content",
      "summary",
      "tags",
      "category",
      "visibility",
      "status",
    ];
    const update = { updatedAt: new Date() };
    for (const key of updatable) {
      if (key in req.body) update[key] = req.body[key];
    }

    const result = await articles.findOneAndUpdate(
      { _id: id },
      { $set: update },
      { returnDocument: "after" },
    );

    if (!result) return res.status(404).json({ error: "article not found" });

    // Only re-index if title/content changed (avoid wasted Voyage calls).
    let chunkCount;
    if ("title" in req.body || "content" in req.body) {
      chunkCount = await indexArticleChunks(result);
    }

    res.json({ ...result, ...(chunkCount !== undefined && { chunkCount }) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const id = new ObjectId(req.params.id);
    await getDB().collection(Collections.chunks).deleteMany({ articleId: id });
    const result = await getDB()
      .collection(Collections.articles)
      .deleteOne({ _id: id });
    if (result.deletedCount === 0)
      return res.status(404).json({ error: "article not found" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
