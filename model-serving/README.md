# 🚀 ML Model Deployment and Serving Platform

A platform for **deploying, versioning and serving ML models** on MongoDB:
a **registry** with immutable versions, **promotion as a transaction**,
**propagation through change streams**, **canary and shadow routing**, and
**evidence in a time series collection** that the platform uses to notice when
a model is wrong without ever returning an error.

Calling `model.predict()` is one line. The hard part is everything that
decides *which* model answers, *since when*, *for whom*, and *how anyone would
know it stopped being right*. That is a control plane, and it has four jobs:

| Job | Usually a separate system | Here |
|---|---|---|
| **Registry**: every model, version, artifact and the metrics that justified it | a registry service | `models`, `model_versions` + GridFS |
| **Promotion**: move a version between stages, fully or not at all | scripts + hope | one multi-document transaction + optimistic lock |
| **Propagation**: get the new state to every serving node, recover when one missed it | a config store + a message bus | a change stream on `deployments` + revision check |
| **Observation**: what each version predicted, how fast, and whether its inputs still look like training | a metrics database | `inference_log` time series + aggregations |

Every boundary between those systems is a place where state disagrees. This
lab puts all four on one cluster.

---

## 🎯 What this lab demonstrates

| Capability | MongoDB feature |
|---|---|
| Promotion is all-or-nothing | multi-document transaction (archive → promote → route → audit) |
| Concurrent promotions can't silently overwrite each other | `revision` filter in the update (optimistic lock) → 409 |
| At most one production version per model, even for hand-run scripts | **partial unique index** `{ modelId: 1 }` where `stage: "production"` |
| A version without a digest can't be registered | `$jsonSchema` validator |
| Live weights always sum to 100% | `$jsonSchema` + `$expr` validator on `deployments` |
| One audit record per revision, no forks | unique `{ deploymentId: 1, revision: -1 }` |
| Serving nodes learn about changes without polling | **change stream** with `fullDocument: "updateLookup"` |
| Node down past the oplog window recovers | resume token dropped on `ChangeStreamHistoryLost`, full resync |
| Weights in the cluster | **GridFS** bucket `artifacts` (or a local dir standing in for S3) |
| Fleet convergence ("is everyone on revision 12?") | heartbeat docs + **TTL index** on `lastSeen` |
| Prediction evidence | **time series collection**, `metaField: { deploymentId, versionId, mode }` |
| p50 / p95 / p99 latency per version | **`$percentile`** (7.0+, approximate) |
| Input drift per feature | **`$facet`** + **`$bucket`** with the training bins → PSI |
| Accuracy once labels arrive | **`$lookup`** from `inference_log` to `outcomes` |

---

## 🏗️ Architecture

```
                    ┌─────────────────────────────────────────────┐
   make train ───►  │ TRAINER (Python)                            │
                    │  sklearn → ONNX · sha256 · training baseline │
                    │  upload ─► GridFS "artifacts"               │
                    └───────────────┬─────────────────────────────┘
                                    │ manifest.json
                                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ CONTROL PLANE (Node, :4030)                                               │
│                                                                           │
│  register   version number from an $inc counter, stage "staging"          │
│                                                                           │
│  promote / canary / shadow / rollback  — ONE shape for all of them:       │
│    withTransaction {                                                      │
│      deployments.revision == expectedRevision ?   else 409                │
│      model_versions: production → archived, target → production           │
│      deployments:    routes = …, $inc revision                            │
│      deployment_history.insertOne({ revision, action, routes, actor })    │
│    }                                                                      │
│    then: partial unique index · $jsonSchema · $expr hold the state valid  │
│                                                                           │
│  observe    $percentile · $facet/$bucket → PSI · $lookup outcomes         │
│  monitor    every 60s → alerts   (time series can't be watched)           │
└────────────────────────────┬──────────────────────────────────────────────┘
                             │  commit
                             ▼
                   ┌───────────────────┐   change stream (push, not poll)
                   │   deployments     │──────────────────┬────────────────┐
                   └───────────────────┘                  ▼                ▼
                                             ┌──────────────────┐ ┌──────────────────┐
                                             │ NODE A (:8031)   │ │ NODE B (:8032)   │
                                             │ open stream FIRST│ │                  │
                                             │ then read state  │ │       same       │
                                             │ revision ≤ mine? │ │                  │
                                             │   → ignore       │ │                  │
                                             │ fetch · verify   │ │                  │
                                             │ sha256 · warm up │ │                  │
                                             │ → swap           │ │                  │
                                             └───┬──────────┬───┘ └───┬──────────┬───┘
                                    POST /predict│          │heartbeat│          │
                                                 ▼          ▼  5s     ▼          ▼
                                       ┌──────────────┐ ┌────────────────────────────┐
                                       │ inference_log│ │ serving_nodes (TTL)        │
                                       │ (time series)│ │ { revision, versions, … }  │
                                       └──────────────┘ └────────────────────────────┘
```

### Request path on a serving node

```
POST /predict/churn-classifier  { features, routingKey: "user-42" }
  1. state = store.get(deployment)          immutable object, no lock
  2. bucket = sha256("churn-classifier/prod:user-42")[:8] % 10000
     route  = cumulative live weights       same answer on every node, every process
  3. vectorize per inputSchema → ONNX → score ≥ version.threshold
  4. respond
  5. shadow route? copy the request into a bounded pool (drop + count when full)
  6. both predictions → inference_log with the SAME predictionId
     (batched insert_many, w:1; a full queue drops and counts, never blocks)
```

### Data model

```js
models              { _id: "churn-classifier", owner, task, description, lastVersion }
model_versions      { _id, modelId, version, stage: none|staging|production|archived,
                      artifact { uri, sha256, bytes, format }, inputSchema[], output { threshold },
                      metrics { auc, logloss, positiveRate, … }, trainingRef {},
                      baseline { <feature>: { edges[], ratios[], outOfRange } },
                      registeredAt, promotedAt?, archivedAt? }
deployments         { _id: "churn-classifier/prod", modelId, routes: [{ versionId, weight, mode }],
                      revision, updatedAt, updatedBy }
deployment_history  { deploymentId, revision, action, versionId, routes, previousRoutes, actor, note, at }
serving_nodes       { _id: nodeId, url, lastSeen, startedAt, deployments: [{ deploymentId, revision,
                      versions, status, lastError }], stats {} }
inference_log  (TS) { ts, meta { deploymentId, versionId, mode }, predictionId, routingKey,
                      features {}, imputed[], output { score, label }, latencyMs, revision }
outcomes            { _id: predictionId, label, observedAt }
alerts              { _id: "<dep>|<version>|<check>|<feature>", check, level, value, message,
                      status: open|resolved, firstSeen, lastSeen }
```

`baseline` looks like metadata. It is the reference the drift check compares
against, and without it the platform has no definition of "normal". The
trainer bins each feature with the **same semantics as `$bucket`** (`[lower,
upper)`, anything outside → `out_of_range`), and both smoke suites pin that.

### Indexes and validators

| Collection | Index / validator | Why |
|---|---|---|
| `model_versions` | `{ modelId: 1, version: 1 }` unique | version numbers can't repeat |
| `model_versions` | `{ modelId: 1 }` unique, **partial** `stage: "production"` | one production version, enforced by the database |
| `model_versions` | `$jsonSchema`: `sha256` matches `^[a-f0-9]{64}$`, `inputSchema`, `baseline` required | a version that can't be verified can't exist |
| `deployments` | `$jsonSchema` per route + `$expr` on the sum of live weights | 100% means 100% |
| `deployment_history` | `{ deploymentId: 1, revision: -1 }` unique | the audit trail can't fork |
| `serving_nodes` | `{ lastSeen: 1 }`, `expireAfterSeconds: 120` | dead nodes disappear on their own |
| `inference_log` | time series, `granularity: "seconds"`, `expireAfterSeconds: 7d` | evidence, compressed, with retention |
| `inference_log` | `{ "meta.deploymentId": 1, "meta.versionId": 1, ts: -1 }` | per-version windows |

### Time series collections have a contract

| Limit | Consequence in this design |
|---|---|
| No writes inside a transaction | promotion never touches `inference_log`: the log is evidence, not state |
| No change streams | alerting is a scheduled job writing to `alerts` (a regular collection, which *can* be watched) |
| Smaller max document size than regular collections | features and outputs only; large payloads would go to object storage with a reference |

`make e2e` proves the first two against your cluster.

---

## ⚙️ Setup

### Prerequisites

- Node.js 20+
- Python 3.10+
- MongoDB **7.0+ replica set**: transactions and change streams need one, and
  `$percentile` needs 7.0. Atlas M0 works. **Atlas Flex clusters don't support
  change streams**, so serving nodes can't run against Flex.

**On M0, two limits to know:** at most **5 open change streams** per cluster
(this lab opens one per serving node, so two by default — adding nodes with
`make serve-one` counts against it), and **100 operations per second**. The
serving nodes batch their log writes and the load generator defaults to 10
req/s to stay well under it.

This lab creates **no Atlas Search or Vector Search indexes**, so it doesn't
compete with `knowledge-base` or `support-chatbot` for the M0 search index quota.

### Quick start

```bash
cd model-serving
make install
# edit .env — MONGODB_URI
make setup        # collections + indexes + v1 (logreg) in production + v2 (gbt) in staging
make dev          # control plane :4030 · UI :3030 · serving nodes :8031 and :8032
make load         # in a second terminal
```

Open http://localhost:3030 and click `churn-classifier`.

| Command | Effect |
|---|---|
| `make install` | Node deps, Python venv in `python/.venv`, copy `.env.example` if missing |
| `make setup` | install + `db` + `bootstrap` |
| `make db` | (re)apply collections, validators, indexes; create the demo model |
| `make train VARIANT=gbt\|logreg\|broken` | train, upload the artifact, register a new version |
| `make status` | routes and revision |
| `make promote V=2` | promote v2 to 100% |
| `make canary V=2 PCT=10` | canary v2 at 10% (`PCT=0` stops it) |
| `make shadow V=3` / `V=off` | shadow v3 / remove the shadow |
| `make rollback` | promote the most recently archived version |
| `make dev` | everything, in one terminal |
| `make serve-one PORT=8033` | one more serving node (watch the fleet grow) |
| `make load RPS=10 DRIFT=0.6 NULL_FEATURE=tenure_days` | traffic with knobs |
| `make smoke` | **offline tests, Node + Python — no cluster** |
| `make e2e` | checks against your cluster in a throwaway `<db>_e2e` database |
| `make health` / `make stop` / `make clean` | |

The UI, the Makefile targets and the HTTP API all go through the same registry
functions in `control-plane/src/registry.js`.

---

## 🔬 Things to try

Run `make dev` in one terminal and `make load` in another, then open the
console. Each scenario makes one behaviour observable.

### 1. A canary that is sticky by user, not by request

Click **Canary 10%** on v2 (or `make canary V=2 PCT=10`).

Watch the fleet table: both nodes report the new revision on their next
heartbeat (every 5 s). The change itself reaches them in milliseconds, pushed
through the change stream when the transaction commits; the node logs show
`update event -> applied`. Then watch
**Requests per minute**: v2 gets ~10%.

In the playground, send the same `routingKey` to node `:8031` and then to
`:8032`. Same version both times. The bucket is `sha256(deployment:key) %
10000`, so it needs no assignment table and gives the same answer on every
node. Raise the canary to 25%: every user who was already on v2 stays there.

`python/serving/routing.py` explains why it isn't Python's `hash()`: that one
is randomized per process, and the canary would get 10% of *requests* instead
of 10% of *users*, with no error anywhere.

### 2. Two people promoting at once

Open the console in two browser tabs. In tab A, promote v2. In tab B, without
refreshing, click **Roll back**.

Tab B gets a **409**: it sent the revision it last saw, and that revision is
no longer current. Without the `revision` filter both would succeed and the
last writer would silently win. `make e2e` runs this race for real, with
`Promise.allSettled`, and checks that exactly one wins.

### 3. The model that is wrong without failing

```bash
make train VARIANT=broken      # registers v3
make shadow V=3
```

`broken` is logistic regression trained with `tenure_days` and `logins_7d`
**swapped** in the training pipeline. The bug is consistent between training
and evaluation, so the registry shows a healthy AUC (~0.80, the same as v1).

As a shadow it scores a copy of every request and never answers. Within a few
minutes **Live metrics** shows its flag rate at a fraction of a percent
against 20% at training, and the scheduled check opens an **output drift**
alert. It never returned an error and never added latency to the live path.

Once labels arrive, look at **Accuracy** closely: v3 has the *highest*
accuracy of all (~88% vs ~81%), because with a ~12% churn rate a model that
flags nobody is right 88% of the time. Its recall is near zero and its Brier
score is the worst. One more model that is wrong without failing, this time
in the metric. Promote it anyway, then roll back.

### 4. Input drift vs a broken input contract

```bash
make load DRIFT=0.6                        # a new cohort: younger accounts, more tickets
```

**Drift & input contract** shows PSI climbing on `tenure_days`,
`tickets_30d` and `logins_7d` while `seats` and `plan_tier` stay stable. Click a
feature to see the training and live distributions in the same bins `$bucket`
uses.

```bash
make load NULL_FEATURE=tenure_days         # upstream renamed a column
```

This is a different failure, and the console shows it differently: `bad input`
jumps to 100% for `tenure_days`, the **imputed** column fills up, and the
alert says **input contract**, not drift. The node kept serving (it imputes 0 by
default, as most stacks do). Set `STRICT_INPUTS=true` in `.env` and restart
the nodes to reject those requests with 422 instead.

Nulls are filtered out *before* `$bucket`, on purpose. A null is a broken
contract, not a shifted distribution, and treating it as drift sends someone
to retrain a model when the fix is a renamed column.

### 5. A node that can't load the new version

Stop node B (`lsof -ti tcp:8032 | xargs kill`), change the deployment, then
start it again with `make serve-one PORT=8032`. It opens the stream, reads the
current state, and catches up in one step, whatever it missed.

Now make a version's bytes disagree with its registry entry. In `mongosh`,
note v2's digest first so you can put it back:

```js
use model_serving
db.model_versions.findOne({ version: 2 }).artifact.sha256          // keep this
db.model_versions.updateOne({ version: 2 }, { $set: { "artifact.sha256": "0".repeat(64) } })
```

Then canary v2 (`make canary V=2 PCT=10`; restart the nodes first if they
already have v2 loaded, since a loaded version is cached in memory). Both
nodes refuse it: the fleet table shows **degraded** with the digest
mismatch, and they keep serving the previous revision at 100%. A wrong model
that loads cleanly is worse than a missing model that fails loudly. Put the
original digest back and within a minute the periodic resync applies the
revision: it was never marked as done, because it never was.

(The validator accepts the fake digest because it is well-formed. Whether a
digest is *true* is a property of the bytes, and only the node that holds
them can check it.)

### 6. Rollback is just a promotion

Promote v2, then click **Roll back**. History shows `rollback` as its own
action, but it runs the same transaction, with the target filter widened from
`staging` to `archived`. There is no separate rollback path to rot from
disuse.

---

## 📡 API reference

Control plane, `:4030`. Every mutation takes `expectedRevision`.

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/models` | | Models with deployment routes |
| POST | `/api/models` | `{ _id, owner?, task?, description? }` | Creates the model **and** its empty `prod` deployment |
| GET | `/api/models/:id` | | Model + versions (without baselines) |
| POST | `/api/models/:id/versions` | manifest | What `scripts/register.js` calls internally |
| GET | `/api/models/:id/versions/:vid` | | Full version, baseline included |
| GET | `/api/deployments/:model/:env` | | Routes labelled with version numbers |
| POST | `…/promote` | `{ versionId, expectedRevision }` | staging → production, 100% |
| POST | `…/canary` | `{ versionId, weight, expectedRevision }` | `weight` in basis points (1000 = 10%), max 9900; `0` stops |
| POST | `…/shadow` | `{ versionId \| null, expectedRevision }` | |
| POST | `…/rollback` | `{ expectedRevision }` | promotes the latest archived version |
| GET | `…/history` | | One record per revision |
| GET | `…/fleet` | | Nodes, their revision, `converged` |
| GET | `…/metrics?minutes=` | | Per version + mode: n, p50/p95/p99, flag rate vs training |
| GET | `…/timeline?minutes=` | | Per minute, per version |
| GET | `…/drift?minutes=&versionId=` | | Contract + PSI per feature, bins included |
| GET | `…/accuracy?minutes=` | | Joined with `outcomes` |
| GET | `…/alerts` | | Open alerts for the deployment |
| POST | `/api/outcomes` | `{ outcomes: [{ predictionId, label }] }` | Late ground truth |
| GET | `/health` | | |

A 409 carries the current deployment in `details.current`.

Serving node, `:8031` / `:8032`:

| Method | Path | Body |
|---|---|---|
| POST | `/predict/:model?env=prod` | `{ features: {…}, routingKey? }` |
| GET | `/health` | |
| GET | `/state` | loaded revision, routes, digests, warm-up times |
| GET | `/docs` | FastAPI's OpenAPI UI |

```bash
curl -s localhost:8031/predict/churn-classifier \
  -H 'content-type: application/json' \
  -d '{"routingKey":"user-42","features":{"tenure_days":45,"seats":6,"tickets_30d":4,"logins_7d":3,"plan_tier":1,"mrr":120}}' | jq
```

---

## 🧪 Tests

```bash
make smoke     # offline: no cluster, no network
make e2e       # against your cluster, in a throwaway database
```

**`make smoke`** runs 53 Node checks and 19 Python tests: route arithmetic,
deterministic assignment (with the **same pinned vectors in both languages**
and a test that runs two Python processes with different `PYTHONHASHSEED`),
PSI, `$bucket` bin semantics on both sides, pipeline and validator shapes,
HTTP validation that has to run before any database call, digest
verification (tampered artifact, corrupted cache), the revision rule in
`ModelStore.apply` (duplicate, out of order, failed load keeps the old state),
and the request path (shadow shares the `predictionId` and never answers).

**`make e2e`** is where the database has to agree: replica set and 7.0+,
transactions, the promotion race, the partial unique index rejecting a raw
`updateMany`, both validators rejecting raw writes, canary bounds, rollback,
history without gaps, `$percentile`, `$bucket` with out-of-range values, the
`$lookup` join, the two time series limits (each **should** fail), and change
stream latency. It creates `<MONGODB_DATABASE>_e2e` and drops it at the end.

---

## 🔐 Least privilege

The serving nodes never need to change what they serve. In production they
get their own database user. Set `SERVING_MONGODB_URI` and the nodes use it
instead of `MONGODB_URI`. In Atlas, create a custom role on the lab database
with:

| Collection | Actions |
|---|---|
| `deployments` | `find`, `changeStream` |
| `model_versions` | `find` |
| `artifacts.files`, `artifacts.chunks` | `find` |
| `inference_log` | `insert` |
| `serving_nodes` | `find`, `insert`, `update` (heartbeat upsert) |

A compromised serving node can lie about its own predictions, but it can't
promote a model.

---

## ⚠️ Not production-ready

Deliberately out of scope, so the control plane stays legible:

- **No authentication.** The actor in `deployment_history` comes from an
  `X-Actor` header. The audit trail has the right *shape*; in production the
  value comes from a verified session, and promotion needs an approval step.
- **One environment.** Deployments are `<model>/prod`. Staging environments,
  promotion between environments and per-environment policies would follow
  the same pattern.
- **No autoscaling and no real object storage.** `ARTIFACT_STORE=file` stands
  in for S3/GCS; a production node would pull from object storage with a
  scoped credential.
- **No automatic rollback.** Alerts are written, not acted on. Wiring an
  output-drift alert to `rollback()` is a few lines. Deciding when that is safe
  is not.
- **PSI thresholds are the rule of thumb** (0.1 / 0.25), not calibrated.
  Calibrate them against features whose drift you know mattered.
- **Synthetic data.** `common/synth.py` generates the churn dataset and the
  drift. The label function is fixed (covariate shift only).
- **CPU only, one model format.** ONNX through `onnxruntime`. A pickle would
  be simpler to produce and is a code-execution vector to load: the format the
  registry points at should be data, not a program.

---

## 📁 Project layout

```
model-serving/
├── Makefile
├── .env.example                    one .env for every component
├── control-plane/                  Node 20, Express, driver 6.x
│   ├── scripts/
│   │   ├── schema.js               validators + indexes as data
│   │   ├── apply-schema.js         idempotent apply (setup-db + e2e)
│   │   ├── setup-db.js             make db
│   │   ├── register.js             manifest → registerVersion()
│   │   ├── deploy.js               promote / canary / shadow / rollback by version number
│   │   ├── smoke.js                offline tests
│   │   └── e2e.js                  real-cluster tests, throwaway database
│   └── src/
│       ├── app.js                  createApp() — no database, so it's testable
│       ├── index.js                connect + listen + monitor
│       ├── config.js               every behavioural number
│       ├── db.js                   client, APP_NAME, collection names
│       ├── registry.js             versions + every deployment change (transactions)
│       ├── routing.js              route arithmetic + bucketFor (pure)
│       ├── drift.js                contract + $bucket pipeline + PSI (pure)
│       ├── observe.js              metrics, timeline, drift, accuracy, fleet
│       ├── monitor.js              scheduled check → alerts
│       └── routes/                 models, deployments, outcomes
├── python/                         Python 3.10+, one venv
│   ├── common/                     env, db, synth data, baseline bins, artifacts
│   ├── trainer/train.py            sklearn → ONNX → artifact + manifest
│   ├── serving/
│   │   ├── app.py                  FastAPI node: predict, shadow, state
│   │   ├── store.py                ModelStore.apply — the propagation contract
│   │   ├── watcher.py              change stream + resume + periodic resync
│   │   ├── runtime.py              ONNX session, vectorize, warm-up
│   │   ├── routing.py              bucket_for / pick_route (mirror of routing.js)
│   │   └── evidence.py             batched inference log + heartbeat
│   ├── loadgen.py                  traffic, drift, broken columns, late labels
│   └── tests/test_smoke.py
└── frontend/                       Next.js 14, App Router, JS
    ├── app/page.js                 models
    ├── app/models/[id]/page.js     the deployment console
    └── components/                 ModelConsole, RoutesBar, LineChart, BinsChart, Status
```
