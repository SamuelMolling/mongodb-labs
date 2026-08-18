# 🎧 AI-Powered Customer Support Agent

A context-aware support agent built on MongoDB Atlas: **conversation
condensation**, **tiered memory**, **two retrieval corpora**, **entitlement
enforced inside the vector index**, and an **escalation policy that writes a
handoff packet** instead of setting a flag.

Companion lab to [`knowledge-base`](../knowledge-base). That lab answers
`query → passage`. This one answers `conversation → resolution`, and three
assumptions break in the gap between them:

| The assumption | Why it breaks in a conversation |
|---|---|
| The query is self-contained | By turn three the customer types "and how much is that?" — six words, no product, nothing worth embedding |
| The corpus is documentation | Half the answers live in resolved tickets and in the customer's own account data, not in the docs |
| The output is an answer | Sometimes the correct output is a human, and answering confidently is the failure |

The retrieval layer is the same machinery as `knowledge-base`. Everything
interesting happens around it.

---

## 🎯 What this lab demonstrates

| Capability | MongoDB feature |
|---|---|
| Entitlement enforced before scoring | `filter` fields inside `$vectorSearch` |
| Two corpora fused into one ranking | `$search` + two `$vectorSearch` + weighted RRF |
| Ticket evidence decayed by age | recency half-life applied to the fused score |
| Transcript that scales with turn count | `messages` collection, `{ conversationId: 1, seq: -1 }` |
| Anonymous sessions expire, customers don't | partial TTL — `expireAfterSeconds: 0` on a field only anonymous docs carry |
| Account lookups as tools | typed queries with `customerId` from the session |
| Docs backlog derived from failures | one aggregation over `messages.meta.confidence` |
| Precision pass over the shortlist | Voyage `rerank-2` via `ai.mongodb.com` |
| Streamed answer | OpenAI chat completions, NDJSON to the browser |

---

## 🏗️ Architecture

```
 Customer turn
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 1. CONDENSE + CLASSIFY            one LLM call, JSON mode           │
│    "and how much is that?"                                          │
│         → standaloneQuestion  "How much does SAML SSO cost?"        │
│         → intent, sentiment, needsRetrieval, needsTools[]           │
│    Contract stated in the NEGATIVE: rewrite, don't answer, don't    │
│    invent constraints the customer never said.                      │
└─────────────────────────────────────────────────────────────────────┘
      │                                    │
      │ needsRetrieval:false ──────────────┼──────────────► skip to 5
      ▼                                    ▼
┌──────────────────────────┐   ┌──────────────────────────────────────┐
│ 2. TOOLS                 │   │ 3. RETRIEVAL — 3 rankers, 2 corpora  │
│  lookupOrder             │   │                                      │
│  listRecentOrders        │   │  $search    kb_articles   BM25  ×0.7 │
│  lookupSubscription      │   │  $vector    kb_chunks     cos   ×1.0 │
│                          │   │  $vector    tickets       cos   ×0.5 │
│  customerId from the     │   │                    × recency decay   │
│  SESSION, never from     │   │             │                        │
│  model arguments         │   │             ▼                        │
└──────────────────────────┘   │      RRF fusion (k=60)               │
      │                        │             │                        │
      │                        │             ▼                        │
      │                        │   Voyage rerank-2  20 → 5            │
      │                        │   (against the ORIGINAL turn)        │
      │                        └──────────────────────────────────────┘
      │                                    │
      ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. ESCALATION POLICY — four independent signals, any one suffices   │
│    policy intent · explicit request · repeated low confidence ·     │
│    frustration + failed turn                                        │
│    Writes a HANDOFF PACKET, not a flag.                             │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. GENERATION — streamed NDJSON                                     │
│    events: state · passages · token · escalation · done · error     │
└─────────────────────────────────────────────────────────────────────┘

  Memory, read before step 1 and written after step 5:
  ┌──────────────┬────────────────────────────────────────────────────┐
  │ transcript   │ messages collection — never an embedded array      │
  │ summary      │ rolling, regenerated every 6 turns                 │
  │ facts        │ extracted identifiers the summarizer would blur    │
  └──────────────┴────────────────────────────────────────────────────┘
```

### Data model

```js
customers     { _id, email, name, plan, locale, seats, subscriptionStatus, renewsAt }
orders        { _id, customerId, orderRef, status, carrier, trackingCode, eta, total, placedAt }
kb_articles   { _id, title, slug, content, category, tags, audience, locale, status }
kb_chunks     { _id, articleId, chunkIndex, breadcrumb, text, embedding,
                audience, locale, category, tags, status }   ← denormalised from the parent
tickets       { _id, subject, problem, resolution, quality, locale, status, resolvedAt, embedding }
conversations { _id, customerId, status, summary, facts, turnCount, failedTurns,
                lastIntent, createdAt, updatedAt, expiresAt? }   ← expiresAt only when anonymous
messages      { _id, conversationId, seq, role, content, meta{}, createdAt }
escalations   { _id, conversationId, customerId, reason, intent, handoff{}, status, createdAt }
```

`kb_chunks` carries `audience`, `locale`, `category`, `tags` and `status`
copied down from its parent article. That denormalisation is not a
convenience — a `$lookup` cannot participate in a `$vectorSearch` pre-filter.
The filter is evaluated by the index, on the chunk document itself, so the
fields have to be there.

### Indexes

| Collection | Index | Why |
|---|---|---|
| `messages` | `{ conversationId: 1, seq: -1 }` | "last K turns" as an index scan |
| `messages` | `{ "meta.confidence": 1, "meta.intent": 1 }` | the knowledge-gaps aggregation |
| `conversations` | `{ customerId: 1, updatedAt: -1 }` | a customer's recent conversations |
| `conversations` | `{ expiresAt: 1 }`, `expireAfterSeconds: 0` | expires **only** anonymous sessions |
| `orders` | `{ customerId: 1, placedAt: -1 }` | order history for the tools |
| `customers` | `{ email: 1 }` unique | identity |
| `kb_articles` | Atlas Search, static mapping | BM25 ranker |
| `kb_chunks` | Vector Search, 1024 dims cosine + 5 filters | primary ranker + entitlement |
| `tickets` | Vector Search, 1024 dims cosine + 3 filters | ticket ranker + quality bar |

Every search mapping is **static**. `dynamic: true` indexes every field of
every document, including the ones no query touches — larger index, longer
builds, and fields quietly searchable that were never meant to be.

---

## ⚙️ Setup

### Prerequisites

- Node.js 20+
- A MongoDB Atlas cluster (M0 works) with Atlas Search and Vector Search
- An Atlas **Model API Key** (`al-…`) for Voyage via `ai.mongodb.com`
- An OpenAI API key

### Quick start

```bash
cd support-chatbot
make install
# edit backend/.env — MONGODB_URI, VOYAGE_API_KEY, OPENAI_API_KEY
make setup       # indexes + seed
make dev         # backend :4020, frontend :3020
```

Then open http://localhost:3020 and paste one of the customer ids the seed
printed into the picker in the top-right.

| Command | Effect |
|---|---|
| `make install` | install both sides; copy `.env.example` if missing |
| `make setup` | install + indexes + seed |
| `make indexes` | (re)build regular + Atlas Search + Vector Search indexes |
| `make seed` | reset and reseed the demo data |
| `make smoke` | **offline tests — no cluster, no API keys** |
| `make dev` | run both dev servers in parallel |
| `make dev-backend` / `make dev-frontend` | run just one side |
| `make health` | curl `/health` |
| `make stop` | kill anything on :4020 and :3020 |
| `make clean` | remove `node_modules` and `.next` |

Ports are 4020/3020 so this lab runs side by side with `knowledge-base`
(4010/3010).

---

## 🔬 Things to try

The seed is four articles, three tickets, two customers and two orders. Every
document is there to make one behaviour observable. Watch the **inspector
panel** on the right — it shows the condensed question, which rankers fired,
and the top rerank score with its confidence band.

### 1. Entitlement is a pre-filter, not a prompt instruction

> **"How do I export the audit log?"**

Ask it as **Dana (enterprise)**, then switch the picker to **Sam (free)** and
ask again.

The audit-log article is `audience: "enterprise"`. For Sam it is not filtered
out of the results — it is **never scored**. `$vectorSearch` evaluates the
`audience` filter inside the index, so the passage never enters the candidate
set, never reaches the reranker, and cannot appear in the prompt.

Watch the passage list change in the inspector. Sam's answer degrades to "I
don't have that information", which is the correct behaviour: the alternative
is an agent that knows something it is not allowed to say and is one clever
question away from saying it.

### 2. Condensation carries context the query lost

> **"How do I set up SAML SSO?"** then **"and how much is that?"**

The second turn is six words with no product in it. The inspector shows what
was actually embedded:

```
condensed: How much does SAML SSO cost?
```

The SAML article has a `## Pricing` section, so the rewrite is what makes it
retrievable. Without it the second turn matches nothing in particular.

Now notice what the rewrite **does not** say: no plan, no seat count, no
billing period. An unconstrained rewriter invents all three, each one prunes
the candidate set, and the resulting miss looks exactly like a retrieval bug.

### 3. A ticket can beat the documentation

> **"I get bounced back to the login page after signing in with Okta"**

Error `AUTH_302` is documented — in formal language, as an "assertion audience
mismatch". A resolved ticket describes the same failure the way a customer
experiences it: bounced back to the login screen, nothing on screen, a failed
POST in the console.

Ask it in symptom language and the ticket outranks the doc. Quote the error
code instead and the doc wins. That is why both corpora exist.

The ticket is still weaker evidence — weight 0.5 against 1.0, and its score
decays with a 180-day half-life. Only `status: "resolved"` tickets with
`quality >= 0.7` are in the index at all.

### 4. Tools read from the session, not from the model

> **"Where is my order ORD-1042?"** as Dana, then as Sam

The model picks the tool. The server picks the account. Sam asking about
`ORD-1042` gets "no order on this account", because `customerId` comes from
the session and is part of the query filter — not a check applied afterwards.

Empty is a legitimate answer here. Widening the query until something comes
back is how a scoped lookup becomes a global one.

### 5. Escalation is a packet, not a flag

> **"I want to cancel my subscription"**

Intent `cancellation` escalates immediately, whatever retrieval found.
Finding a perfect passage about the cancellation policy is not authority to
cancel anything — this is an authority boundary, not a knowledge gap.

Expand the handoff packet in the inspector: the summary, the extracted facts,
what was tried with rerank scores, which tools ran. A human opens a document,
not a fourteen-turn transcript.

### 6. The docs backlog, derived

```bash
curl -s localhost:4020/api/admin/knowledge-gaps | jq
```

Every turn stores its confidence band and condensed question. Grouping the
weak and none turns by intent turns the agent's failures into a ranked list
of things the documentation does not cover — in the customer's own words.

```bash
curl -s localhost:4020/api/admin/metrics | jq
```

Reports deflection rate and resolution rate side by side, on purpose.
Deflection is the number that looks good on a slide and rewards the wrong
behaviour: a customer who gives up in frustration counts as deflected.
Resolution has to be *collected* — "ok thanks" is what people type both when
it worked and when they gave up — which is what the feedback endpoint is for.

---

## 📡 API reference

| Method | Path | Body / query | Notes |
|---|---|---|---|
| POST | `/api/chat` | `{ message, conversationId?, customerId? }` | **What the UI calls.** One full turn, streamed as NDJSON |
| POST | `/api/chat/feedback` | `{ conversationId, resolved, comment? }` | Resolution rate — collected, not inferred |
| GET | `/api/conversations/:id` | | Conversation + full transcript + escalations |
| GET | `/api/conversations` | `?customerId=&limit=` | Recent conversations |
| GET | `/api/customers` | | Demo picker only — a real app takes this from the session |
| GET | `/api/customers/:id` | | |
| GET | `/api/admin/knowledge-gaps` | `?limit=` | Weak/none turns grouped by intent |
| GET | `/api/admin/metrics` | | Deflection vs resolution |
| GET | `/api/admin/escalations` | `?limit=` | The human queue |
| GET | `/health` | | `{ status: "ok" }` |

### NDJSON stream events

```jsonc
{"event":"state","stage":"condensing"}                  // pipeline progress
{"event":"state","stage":"condensed","intent":"how_to"} // + the classification
{"event":"passages","passages":[…],"stats":{…}}         // once, before tokens
{"event":"token","text":"…"}                            // N times
{"event":"escalation","reason":"…","packet":{…}}        // only when handing off
{"event":"done","confidence":"strong","model":"…"}      // once
{"event":"error","message":"…"}                         // mid-stream failure only
```

---

## 🧪 Tests

```bash
make smoke
```

Runs offline — no cluster, no API keys, no network. 36 checks covering the
chunker (fenced-code headings, breadcrumb dedup, unpunctuated blobs), the
entitlement ladder, the escalation policy (all four signals plus counter
reset), the condense contract's normalisation, RRF fusion and recency decay,
and HTTP wiring on an ephemeral port.

That list is not an accident: the chunker, the entitlement ladder and the
escalation policy are pure functions **on purpose**. A policy nobody can test
offline is a policy nobody changes with confidence, which is how support
agents end up with escalation rules everyone is afraid to touch.

---

## ⚠️ Not production-ready

Deliberately out of scope, so the pipeline stays legible:

- **No authentication.** `customerId` arrives in the request body. The tools
  treat it as the authoritative session identity, which is the right *shape* —
  but in production that value comes from a verified session, not from the
  client. Everything else about the tool boundary is real; this part is a stub.
- **No rate limiting, no abuse controls, no cost ceiling.** A loop hitting
  `/api/chat` will happily spend your OpenAI budget.
- **No prompt-injection defence.** Retrieved passages and ticket text go into
  the prompt as-is. A hostile document in the corpus is a live issue in any
  RAG system and needs its own treatment.
- **No PII handling.** Transcripts are stored in the clear. Real support data
  needs field-level encryption (see the `csfle` and `queryable-encryption`
  labs in this repo), redaction, and a retention policy per jurisdiction.
- **No human agent UI.** Escalations are written to a collection and listed
  over an endpoint. There is no inbox, no assignment, no SLA.
- **No evaluation harness.** There is no regression suite over a labelled
  question set, which is what you would actually need before touching any
  threshold in `tuning`.
- **Single-tenant.** No workspace or org boundary beyond `audience`.
- **The condense step is a single point of failure.** It degrades to the raw
  turn when the classifier fails, which is honest but lossy.
- **`$rankFusion`.** RRF is implemented by hand so the arithmetic is visible.
  On MongoDB 8.1+ prefer the native stage.

---

## 📁 Project layout

```
support-chatbot/
├── Makefile
├── backend/
│   ├── scripts/
│   │   ├── create-indexes.js   regular + Atlas Search + 2 vector indexes
│   │   ├── seed.js             2 customers, 2 orders, 4 articles, 3 tickets
│   │   └── smoke.js            offline test suite
│   └── src/
│       ├── app.js              createApp() — no database, so it's testable
│       ├── index.js            connect + listen
│       ├── config.js           every behavioural number, in one object
│       ├── db.js               client, APP_NAME, collection names
│       ├── condense.js         rewrite + classify, one JSON-mode call
│       ├── memory.js           transcript / summary / facts
│       ├── retrieve.js         3 rankers, RRF, rerank, entitlement filter
│       ├── tools.js            typed account lookups, session-scoped
│       ├── policy.js           escalation signals + handoff packet
│       ├── llm.js              streaming + JSON-mode OpenAI clients
│       ├── voyage.js           embeddings + rerank via ai.mongodb.com
│       ├── utils/chunker.js    section-aware chunking with breadcrumbs
│       └── routes/             chat · conversations · customers · admin
└── frontend/
    ├── app/                    layout, page, globals.css
    ├── components/             ChatConsole · InspectorPanel · CustomerPicker
    └── lib/api.js              NDJSON stream client
```

All tuning lives in `src/config.js` — thresholds, weights, half-life, TTL,
the entitlement ladder and the always-escalate intents.
