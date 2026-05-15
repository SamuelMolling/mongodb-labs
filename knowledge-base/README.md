# 🧠 Knowledge Base Platform with AI Search

A full-stack knowledge management system built **MongoDB-first**: every piece
of state — articles, embeddings, chunks, search history, permissions — lives
in a single MongoDB Atlas cluster. There is no separate search engine and no
separate vector database.

This is a **lab project written for an article**: the code is intentionally
small so the MongoDB pieces are visible. It is not production-ready.

---

## 🎯 What this lab demonstrates

The UI is one search box. Behind it, four MongoDB-powered stages compose
into a single retrieval pipeline (`/api/search/smart`):

| Stage | MongoDB feature | Purpose |
|---|---|---|
| Keyword | **Atlas Search** (`$search`) | rank articles by BM25 + fuzzy term match |
| Semantic | **Atlas Vector Search** (`$vectorSearch`) | rank chunks by embedding similarity |
| Fusion | aggregation pipeline | **Reciprocal Rank Fusion** combines both rankings |
| Rerank | **Voyage rerank-2** via `ai.mongodb.com` | final precision pass on the top passages |

Plus the foundations a real knowledge base needs:

| Capability | MongoDB feature |
|---|---|
| Operational CRUD (articles, users, workspaces) | Regular collections + indexes |
| Pre-filtering vectors by tenant / tag | `filter` field in the vector index |
| Chunking by Markdown section with breadcrumbs | section-aware splitter |
| Search analytics | `search_history` collection |

The endpoints `/api/search/keyword`, `/semantic`, `/hybrid` and `/ask`
remain exposed so the article can demonstrate each stage independently
via curl — the UI does not call them.

> The point of the lab: you can build a full “AI search platform” without
> Elasticsearch, Pinecone, Weaviate, or any other extra component. MongoDB
> handles operational data and vectors with the same query language, and
> the user never has to know about any of it.

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
│   │       └── search.js            # smart (UI) + keyword / semantic / hybrid / ask
│   └── scripts/
│       ├── create-indexes.js        # builds Atlas Search + Vector indexes
│       ├── seed.js                  # demo workspace + sample articles
│       ├── seed-bulk.js             # generates N synthetic articles (1k–10k+)
│       └── generators.js            # topic × tech × problem article generator
└── frontend/
    ├── app/
    │   ├── page.js                  # landing + search box
    │   ├── articles/                # list, create, view, edit
    │   └── search/                  # single-box search UI (hybrid + rerank)
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

### Quick start with `make` (recommended)

A `Makefile` at the project root wraps every step. From `knowledge-base/`:

```bash
make help          # list all targets
make setup        # install deps + create indexes + small seed
# edit backend/.env  (MONGODB_URI, VOYAGE_API_KEY) before running setup
make dev          # runs backend + frontend in parallel; Ctrl+C stops both
```

Other useful targets:

| Command | Effect |
|---|---|
| `make install` | install backend + frontend deps; copy `.env.example` if missing |
| `make indexes` | (re)build Atlas Search and Vector Search indexes |
| `make seed` | small demo seed (6 articles) |
| `make seed-bulk COUNT=5000` | bulk seed N synthetic articles with Voyage embeddings |
| `make seed-bulk-noembed COUNT=10000` | bulk seed without Voyage (no API spend) |
| `make dev-backend` / `make dev-frontend` | run just one side |
| `make health` | curl the `/health` endpoint |
| `make stop` | kill anything occupying ports 4010 + 3010 |
| `make clean` | remove `node_modules` and `.next` |

### Manual setup (without make)

```bash
cd backend
npm install
cp .env.example .env
# edit .env: MONGODB_URI, VOYAGE_API_KEY
npm run create-indexes      # creates regular + Atlas Search + Vector indexes
npm run seed                # creates demo workspace + ~6 articles + embeddings
npm run dev                 # starts API on http://localhost:4010
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
| POST | `/api/search/smart` | `{ query, workspaceId, limit }` | **What the UI calls.** Hybrid + Voyage rerank |
| POST | `/api/search/keyword` | `{ query, workspaceId, limit }` | Atlas Search alone (educational) |
| POST | `/api/search/semantic` | `{ query, workspaceId, limit, withRerank }` | Vector Search alone (educational) |
| POST | `/api/search/hybrid` | `{ query, workspaceId, limit, k }` | RRF without rerank (educational) |
| POST | `/api/search/ask` | `{ question, workspaceId, topK }` | RAG context (educational) |
| GET | `/api/search/history` | `?userId=&workspaceId=` | |

### Curl examples

```bash
# create an article (will be chunked + embedded automatically)
curl -X POST http://localhost:4010/api/articles \
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
curl -X POST http://localhost:4010/api/search/hybrid \
  -H 'Content-Type: application/json' \
  -d '{"query":"how to combine keyword and semantic search","workspaceId":"<WS_ID>"}'

# RAG-style retrieval
curl -X POST http://localhost:4010/api/search/ask \
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

5. **Section-aware chunking with breadcrumbs**. The chunker splits on
   Markdown headings (`#`, `##`, `###`) so every chunk is one coherent
   section. Each chunk is prefixed with its path —
   `Article title > Section > Subsection` — so the embedding knows the
   context. Sections bigger than 1500 chars fall back to paragraph/sentence
   splitting, with the breadcrumb still on every sub-chunk. Code blocks
   are skipped so a `# bash comment` is not mistaken for a heading. See
   [`backend/src/utils/chunker.js`](backend/src/utils/chunker.js).

6. **`/smart` composes everything**. The single endpoint the UI calls:
   keyword on articles, vector on chunks, RRF to fuse, Voyage rerank-2 to
   finish. The user sees one search box; MongoDB does the rest. See
   [`backend/src/routes/search.js`](backend/src/routes/search.js).

---

## 🧪 Try these queries

### In the UI

Open the search box and type:

- `How do I chunk by markdown section?` — returns the section
  *“Designing a chunking strategy for RAG > Semantic chunking by section”*
  as the top passage. Notice the breadcrumb path in the result.
- `Why not just sum the scores from two rankers?` — returns the RRF
  article's *“Why not just sum the scores?”* section.
- `What input_type do I use for the user's query?` — returns
  *“Voyage AI embeddings overview > The input_type parameter”*.

### Comparing the underlying pipelines via curl (for the article)

Same query, four pipelines, to show what each contributes:

```bash
WS=<workspace-id>
Q='how do I chunk by markdown section'

# 1. Pure keyword — Atlas Search BM25 + fuzzy
curl -sX POST localhost:4010/api/search/keyword  -H 'content-type: application/json' \
     -d "{\"query\":\"$Q\",\"workspaceId\":\"$WS\"}"  | jq '.results[0:3]'

# 2. Pure semantic — Atlas Vector Search on chunks
curl -sX POST localhost:4010/api/search/semantic -H 'content-type: application/json' \
     -d "{\"query\":\"$Q\",\"workspaceId\":\"$WS\"}"  | jq '.results[0:3]'

# 3. Hybrid — RRF combines them at the article level
curl -sX POST localhost:4010/api/search/hybrid   -H 'content-type: application/json' \
     -d "{\"query\":\"$Q\",\"workspaceId\":\"$WS\"}"  | jq '.results[0:3]'

# 4. What the UI actually does — hybrid at chunk level + Voyage rerank
curl -sX POST localhost:4010/api/search/smart    -H 'content-type: application/json' \
     -d "{\"query\":\"$Q\",\"workspaceId\":\"$WS\"}"  | jq '.results[0:3]'
```

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
