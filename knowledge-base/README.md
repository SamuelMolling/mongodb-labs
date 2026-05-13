# 🧠 Knowledge Base Platform with AI Search

A full-stack knowledge management system built **MongoDB-first**: every piece
of state — articles, embeddings, chunks, search history, permissions — lives
in a single MongoDB Atlas cluster. There is no separate search engine and no
separate vector database.

This is a **lab project written for an article**: the code is intentionally
small so the MongoDB pieces are visible. It is not production-ready.

---

## 🎯 What this lab demonstrates

| Capability | MongoDB feature |
|---|---|
| Operational CRUD (articles, users, workspaces) | Regular collections + indexes |
| Keyword search with fuzzy matching & highlights | **Atlas Search** (`$search`) |
| Semantic search over chunk embeddings | **Atlas Vector Search** (`$vectorSearch`) |
| Hybrid search (best of both) | **Reciprocal Rank Fusion** in an aggregation pipeline |
| Retrieval-Augmented Generation context fetch | `$vectorSearch` + `$lookup` + Voyage rerank |
| Pre-filtering vectors by tenant / tag | `filter` field in the vector index |
| Search analytics | `search_history` collection |

> The point of the lab: you can build a full “AI search platform” without
> Elasticsearch, Pinecone, Weaviate, or any other extra component. MongoDB
> handles operational data and vectors with the same query language.

---

## 🏗️ Architecture

```
┌──────────────────┐        REST         ┌──────────────────────┐
│  Next.js (React) │  ─────────────────▶ │  Express API (Node)  │
│  /articles, /search,                   │  /api/articles       │
│  /ask                                  │  /api/search/*       │
└──────────────────┘                     └─────────┬────────────┘
                                                   │
                                       Voyage AI  ─┤  embeddings + rerank
                                                   │
                                          ┌────────▼─────────┐
                                          │   MongoDB Atlas  │
                                          │ ┌──────────────┐ │
                                          │ │  articles    │ │  full text → Atlas Search index
                                          │ │  chunks      │ │  embedding → Vector index
                                          │ │  workspaces  │ │
                                          │ │  users       │ │
                                          │ │  history     │ │
                                          │ └──────────────┘ │
                                          └──────────────────┘
```

### Data model

```js
users:        { _id, email, name, createdAt }
workspaces:   { _id, name, slug, ownerId, members: [{ userId, role }] }
articles:     { _id, workspaceId, authorId, title, content, summary,
                tags, category, visibility, status, createdAt, updatedAt }
chunks:       { _id, articleId, workspaceId, chunkIndex, text,
                embedding: [1024 floats],   // ← lives next to its doc
                tags, category, visibility, createdAt }
search_history: { _id, userId, workspaceId, query, type, resultsCount, createdAt }
```

Why `chunks` is a **separate collection** instead of an embedded array:

- Each chunk gets its own `_id` so `$vectorSearch` returns chunk-level hits.
- Updating one article only re-indexes its chunks (delete + insert).
- The articles collection stays small for operational queries.
- The vector index can pre-filter on tags/visibility without scanning blobs.

---

## 📁 Project layout

```
knowledge-base/
├── backend/
│   ├── src/
│   │   ├── index.js                 # Express bootstrap
│   │   ├── db.js                    # MongoDB connection + collection names
│   │   ├── voyage.js                # embed() and rerank() over fetch
│   │   ├── utils/chunker.js         # sentence-aware text chunking
│   │   └── routes/
│   │       ├── users.js
│   │       ├── workspaces.js
│   │       ├── articles.js          # CRUD + auto re-index on write
│   │       └── search.js            # keyword / semantic / hybrid / ask
│   └── scripts/
│       ├── create-indexes.js        # builds Atlas Search + Vector indexes
│       ├── seed.js                  # demo workspace + sample articles
│       ├── seed-bulk.js             # generates N synthetic articles (1k–10k+)
│       └── generators.js            # topic × tech × problem article generator
└── frontend/
    ├── app/
    │   ├── page.js                  # landing
    │   ├── articles/                # list, create, view, edit
    │   ├── search/                  # three-mode search UI
    │   └── ask/                     # RAG-style retrieval UI
    ├── components/                  # NavBar, ArticleForm
    └── lib/                         # API client + workspace resolver
```

---

## ⚙️ Setup

### Prerequisites

- **Node.js 20+**
- **MongoDB Atlas** cluster on a tier that supports Atlas Search + Vector
  Search (M10 free of charge for development is enough, but the shared free
  tier also supports both today).
- A **[Voyage AI](https://www.voyageai.com/)** API key (free trial credits
  available).

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
# edit .env: MONGODB_URI, VOYAGE_API_KEY
npm run create-indexes      # creates regular + Atlas Search + Vector indexes
npm run seed                # creates demo workspace + ~6 articles + embeddings
npm run dev                 # starts API on http://localhost:8080
```

The seed script prints the demo `workspace` id when it finishes. Copy it.

#### Want thousands of articles? (load-test seed)

```bash
npm run seed-bulk -- --count=1000 --reset            # 1k synthetic articles
npm run seed-bulk -- --count=5000 --workspace=demo-large
npm run seed-bulk -- --count=10000 --no-embed        # skip Voyage (no vector data)
```

`seed-bulk.js` generates synthetic articles from a topic × technology ×
problem matrix, then:

1. Inserts articles with `insertMany` in batches (`--insert-batch`, default 250).
2. Chunks them with the same sentence-aware splitter.
3. Embeds chunks via Voyage in batches of up to 128 (`--embed-batch`, default 96),
   with retry + exponential backoff on 429s.
4. Runs `--concurrency` parallel Voyage calls (default 4) and inserts each
   batch as soon as it's embedded, so memory stays flat for very large runs.
5. Prints `done/total · rate · eta` while running.

Cost heads-up: voyage-3 is priced per token. 1,000 articles ≈ ~3,500 chunks
≈ ~875K tokens. Check the live Voyage pricing before triggering anything
≥10k. Use `--no-embed` to stress-test Atlas Search alone without spend.

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
# set NEXT_PUBLIC_WORKSPACE_ID to the id printed by the seed
npm run dev                 # http://localhost:3000
```

Open <http://localhost:3000>. Browse articles, then go to **Search** and try
the same query in keyword / semantic / hybrid modes.

---

## 🔍 MongoDB queries explained

### A. Keyword search — Atlas Search

```js
db.articles.aggregate([
  { $search: {
      index: "articles_search",
      compound: {
        should: [
          { text: { query, path: "title",   score: { boost: { value: 3 } }, fuzzy: { maxEdits: 1 } } },
          { text: { query, path: "content", fuzzy: { maxEdits: 1 } } },
          { text: { query, path: "tags",    score: { boost: { value: 2 } } } },
        ],
      },
      highlight: { path: ["title", "content"] },
  }},
  { $match: { workspaceId: ObjectId(...) } },
  { $project: {
      title: 1, summary: 1, tags: 1,
      score: { $meta: "searchScore" },
      highlights: { $meta: "searchHighlights" },
  }},
]);
```

Atlas Search is built on Apache Lucene. You get BM25 scoring, fuzzy
matching, autocomplete, faceting, and highlights — without leaving MongoDB.

### B. Semantic search — Atlas Vector Search

```js
db.chunks.aggregate([
  { $vectorSearch: {
      index: "chunks_vector",
      path: "embedding",
      queryVector: [...1024 floats from Voyage],
      numCandidates: 100,
      limit: 30,
      filter: { workspaceId: ObjectId(...) },   // pre-filter inside the index
  }},
  { $sort:  { score: { $meta: "vectorSearchScore" } } },
  { $group: { _id: "$articleId", best: { $first: "$$ROOT" } } },
  { $lookup: { from: "articles", localField: "_id", foreignField: "_id", as: "article" } },
  { $unwind: "$article" },
]);
```

Key idea: the embedding lives **on the chunk document**, and the chunk has
a back-reference (`articleId`) to its parent. `$vectorSearch` does the
nearest-neighbour search; `$lookup` rejoins to render the article card.

### C. Hybrid search — Reciprocal Rank Fusion

Different rankers produce scores on completely different scales. RRF only
looks at rank position, so the scale problem disappears:

```
rrf_score(doc) = Σ over rankers   1 / (k + rank_i(doc))     // k = 60
```

The implementation runs `$search` and `$vectorSearch` separately, collects
the article IDs in rank order, fuses them with the formula above, then
fetches the article metadata in one round trip. See
[`backend/src/routes/search.js`](backend/src/routes/search.js).

> MongoDB 8.1 added **`$rankFusion`** as a first-class aggregation stage
> that does this in a single query. The explicit implementation here makes
> the algorithm visible for the article.

### D. RAG context retrieval

```bash
POST /api/search/ask  { question, workspaceId, topK: 5 }
```

Pipeline:

1. Embed the question with Voyage (`input_type=query`).
2. Run `$vectorSearch` for the top 20 chunks.
3. `$lookup` the parent article to get `title` and `tags`.
4. Pass `(question, passages)` to Voyage's `rerank-2` model.
5. Return the top 5 passages with their source article ids.

These passages are the **context** you would feed to an LLM in a RAG flow.
The lab deliberately stops here so the dependency surface stays small.

---

## 🧬 The index definitions

### `articles_search` — Atlas Search

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "title":       { "type": "string", "analyzer": "lucene.english" },
      "content":     { "type": "string", "analyzer": "lucene.english" },
      "summary":     { "type": "string", "analyzer": "lucene.english" },
      "tags":        { "type": "string", "analyzer": "lucene.keyword" },
      "category":    { "type": "string", "analyzer": "lucene.keyword" },
      "workspaceId": { "type": "objectId" },
      "visibility":  { "type": "string", "analyzer": "lucene.keyword" },
      "status":      { "type": "string", "analyzer": "lucene.keyword" }
    }
  }
}
```

### `chunks_vector` — Atlas Vector Search

```json
{
  "fields": [
    { "type": "vector", "path": "embedding",
      "numDimensions": 1024, "similarity": "cosine" },
    { "type": "filter", "path": "workspaceId" },
    { "type": "filter", "path": "visibility" },
    { "type": "filter", "path": "tags" },
    { "type": "filter", "path": "category" }
  ]
}
```

`filter` fields let `$vectorSearch` prune candidates **inside the index**,
which is much faster than a downstream `$match`. Multi-tenant systems
should always pre-filter by tenant id this way.

---

## 📡 API reference

| Method | Path | Body / query | Notes |
|---|---|---|---|
| POST | `/api/users` | `{ email, name }` | Idempotent on `email` |
| POST | `/api/workspaces` | `{ name, slug, ownerId }` | |
| GET | `/api/workspaces` | — | |
| POST | `/api/articles` | `{ workspaceId, authorId, title, content, ... }` | Auto chunks + embeds |
| GET | `/api/articles?workspaceId=` | | Excludes `content` |
| GET | `/api/articles/:id` | | |
| PUT | `/api/articles/:id` | `{ title?, content?, tags?, ... }` | Re-indexes if title/content changed |
| DELETE | `/api/articles/:id` | | Also deletes chunks |
| POST | `/api/search/keyword` | `{ query, workspaceId, limit }` | Atlas Search |
| POST | `/api/search/semantic` | `{ query, workspaceId, limit, withRerank }` | Vector Search (+ optional rerank) |
| POST | `/api/search/hybrid` | `{ query, workspaceId, limit, k }` | RRF |
| POST | `/api/search/ask` | `{ question, workspaceId, topK }` | RAG context |
| GET | `/api/search/history` | `?userId=&workspaceId=` | |

### Curl examples

```bash
# create an article (will be chunked + embedded automatically)
curl -X POST http://localhost:8080/api/articles \
  -H 'Content-Type: application/json' \
  -d '{
    "workspaceId":"<WS_ID>",
    "authorId":"<USER_ID>",
    "title":"What is vector search?",
    "content":"Vector search retrieves documents whose embeddings are closest to a query embedding...",
    "tags":["vector-search","intro"],
    "category":"tutorial"
  }'

# hybrid search
curl -X POST http://localhost:8080/api/search/hybrid \
  -H 'Content-Type: application/json' \
  -d '{"query":"how to combine keyword and semantic search","workspaceId":"<WS_ID>"}'

# RAG-style retrieval
curl -X POST http://localhost:8080/api/search/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"why store embeddings in MongoDB?","workspaceId":"<WS_ID>","topK":5}'
```

---

## 🎓 Things worth noting in the code

1. **Voyage `input_type`**. Document chunks are embedded with
   `input_type=document`; query strings are embedded with
   `input_type=query`. The same model produces *different* vectors for
   each mode, and using the right one materially improves retrieval.
   See [`backend/src/voyage.js`](backend/src/voyage.js).

2. **Re-indexing on update**. `PUT /api/articles/:id` re-embeds only if
   `title` or `content` changed — touching `tags` alone doesn't burn
   Voyage credits. See `indexArticleChunks` in
   [`backend/src/routes/articles.js`](backend/src/routes/articles.js).

3. **Pre-filtering inside `$vectorSearch`**. Tenancy and visibility filters
   are passed in the stage itself, not as a later `$match`:
   ```js
   $vectorSearch: { …, filter: { workspaceId: ObjectId(...) } }
   ```
   This is the dramatic performance win that lets a single collection
   serve many tenants.

4. **Atlas Search highlights**. `{ $meta: "searchHighlights" }` returns
   tokenised snippets the frontend renders inline with `<mark>`. Look at
   [`frontend/app/search/page.js`](frontend/app/search/page.js).

5. **Sentence-aware chunking**. The chunker walks back to the nearest
   sentence break instead of cutting at a fixed character count, which
   keeps embeddings semantically clean. See
   [`backend/src/utils/chunker.js`](backend/src/utils/chunker.js).

---

## 🧪 Try these queries

The seed loads articles about Atlas Search, Vector Search, chunking, RRF,
and Voyage. Watch how the three modes diverge:

| Query | Keyword wins | Semantic wins | Hybrid wins |
|---|---|---|---|
| `"$vectorSearch"` | ✓ exact token | | |
| `"how do I combine results from two rankers"` | | ✓ RRF article | |
| `"chunk size"` | ✓ (term hits) | ✓ (concept) | ✓ (best) |
| `"why not pinecone"` | | ✓ ("Why store embeddings in MongoDB") | |

---

## 📚 References

- [Atlas Search docs](https://www.mongodb.com/docs/atlas/atlas-search/)
- [Atlas Vector Search docs](https://www.mongodb.com/docs/atlas/atlas-vector-search/)
- [`$rankFusion`](https://www.mongodb.com/docs/manual/reference/operator/aggregation/rankFusion/) (MongoDB 8.1+)
- [Voyage AI embeddings + rerank](https://docs.voyageai.com)
- Cormack, Clarke & Buettcher (2009), *Reciprocal Rank Fusion outperforms
  Condorcet and individual Rank Learning Methods*

---

## 📌 Scope notes

This lab is on purpose **not** production-ready:

- Authentication is a header / id-in-body convention; in production wire a
  real session or JWT layer.
- No rate limiting, no quota tracking on Voyage spend.
- No background queue for chunking — the request blocks until embeddings
  return. For larger documents, push that to a worker.
- No streaming LLM answer endpoint — the `/ask` endpoint returns retrieval
  context. Plug an LLM call in front of the response when you're ready.

But every MongoDB-related piece — the indexes, the aggregation pipelines,
the data model — is the way you'd actually do it in production. That's the
point.
