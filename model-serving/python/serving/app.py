"""
A serving node: FastAPI + ONNX Runtime + a change stream.

    python -m serving --port 8031 --node-id node-a

Request path (POST /predict/{model_id}):

  1. read the current DeploymentState (no lock, immutable object)
  2. pick the live route deterministically from routingKey
  3. vectorize per the version's inputSchema, score, threshold
  4. respond; then hand the same request to the shadow version, if any,
     in a bounded background pool -- a slow shadow never slows the live path
  5. both predictions go to the inference log with the SAME predictionId,
     so one late-arriving label scores both versions
"""
import logging
import os
import threading
import time
import uuid
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from common.db import connect
from .evidence import Heartbeat, InferenceLogger
from .routing import pick_route
from .runtime import InputContractError
from .store import ModelStore
from .watcher import DeploymentWatcher

log = logging.getLogger("serving")


class Stats:
    def __init__(self):
        self._lock = threading.Lock()
        self.requests = 0
        self.errors = 0
        self.shadow_runs = 0
        self.shadow_dropped = 0
        self.rejected = 0

    def inc(self, name, n=1):
        with self._lock:
            setattr(self, name, getattr(self, name) + n)

    def snapshot(self):
        return {"requests": self.requests, "errors": self.errors, "shadowRuns": self.shadow_runs,
                "shadowDropped": self.shadow_dropped, "rejected": self.rejected}


class PredictRequest(BaseModel):
    features: dict
    # A stable key (user id, account id). Same key -> same version on every
    # node. Omit it and the request is assigned randomly: not sticky.
    routingKey: str | None = Field(default=None, max_length=200)


class Node:
    """Wires the pieces together. Created once per process."""

    def __init__(self, node_id: str, port: int):
        self.node_id = node_id
        self.url = f"http://localhost:{port}"
        self.strict = os.getenv("STRICT_INPUTS", "false").lower() == "true"
        self.deployments = [d.strip() for d in os.getenv("SERVING_DEPLOYMENTS", "churn-classifier/prod").split(",") if d.strip()]

        # Least privilege: serving nodes may use their own, restricted user.
        uri = os.getenv("SERVING_MONGODB_URI") or os.getenv("MONGODB_URI")
        self.client, self.db = connect(uri)

        cache = Path(__file__).resolve().parents[1] / ".cache" / "artifacts"
        self.stats = Stats()
        self.store = ModelStore(self.db, cache)
        self.logger = InferenceLogger(self.db)
        self.watcher = DeploymentWatcher(self.db, self.store, self.deployments,
                                         resync_sec=int(os.getenv("RESYNC_SEC", "60")))
        self.heartbeat = Heartbeat(self.db, node_id, self.url, self.store, self.watcher, self.logger, self.stats)

        # Shadow work: bounded. When the pool is saturated, shadow requests
        # are dropped and counted, never queued without limit.
        self.shadow_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="shadow")
        self.shadow_slots = threading.BoundedSemaphore(64)

    def start(self):
        self.logger.start()
        self.watcher.start()
        self.heartbeat.start()

    def stop(self):
        self.watcher.stop()
        self.heartbeat.stop()
        self.shadow_pool.shutdown(wait=False, cancel_futures=True)
        self.logger.stop()
        self.logger.join(timeout=5)
        try:
            self.heartbeat.beat()  # last word: what we were serving
        except Exception:  # noqa: BLE001
            pass
        self.client.close()

    # -- request path ----------------------------------------------------------

    def _log(self, deployment_id, route, pid, routing_key, features, score, label, latency_ms, imputed, revision):
        self.logger.record({
            "ts": datetime.now(timezone.utc),
            "meta": {"deploymentId": deployment_id, "versionId": route.version.version_id, "mode": route.mode},
            "predictionId": pid,
            "routingKey": routing_key,
            "revision": revision,
            # As RECEIVED, restricted to schema fields: a null stays null and a
            # missing field stays missing, so the input-contract check can see
            # what upstream actually sent, not what we imputed.
            "features": {s["name"]: features[s["name"]] for s in route.version.input_schema if s["name"] in features},
            "imputed": imputed,
            "output": {"score": score, "label": label},
            "latencyMs": latency_ms,
        })

    def _run(self, route, features):
        t0 = time.perf_counter()
        x, imputed = route.version.vectorize(features, self.strict)
        score = float(route.version.score(x)[0])
        label = int(score >= route.version.threshold)
        return score, label, imputed, (time.perf_counter() - t0) * 1000

    def _shadow(self, deployment_id, route, pid, routing_key, features, revision):
        try:
            score, label, imputed, ms = self._run(route, features)
            self._log(deployment_id, route, pid, routing_key, features, score, label, ms, imputed, revision)
            self.stats.inc("shadow_runs")
        except Exception as e:  # noqa: BLE001 -- a broken shadow must not affect anything
            log.warning("shadow v%s failed: %s", route.version.version, e)
        finally:
            self.shadow_slots.release()

    def predict(self, model_id: str, env: str, req: PredictRequest):
        deployment_id = f"{model_id}/{env}"
        state = self.store.get(deployment_id)
        if state is None or not state.live:
            raise HTTPException(503, f"{deployment_id} has nothing live on this node yet")

        routing_key = req.routingKey or f"anon-{uuid.uuid4()}"
        route = pick_route(deployment_id, state.live, routing_key)
        pid = str(uuid.uuid4())
        try:
            score, label, imputed, ms = self._run(route, req.features)
        except InputContractError as e:
            self.stats.inc("rejected")
            raise HTTPException(422, str(e)) from e
        except Exception as e:  # noqa: BLE001
            self.stats.inc("errors")
            raise HTTPException(500, f"inference failed: {e}") from e

        self.stats.inc("requests")
        self._log(deployment_id, route, pid, req.routingKey, req.features, score, label, ms, imputed, state.revision)

        shadow = state.shadow
        if shadow is not None:
            if self.shadow_slots.acquire(blocking=False):
                self.shadow_pool.submit(self._shadow, deployment_id, shadow, pid, req.routingKey,
                                        dict(req.features), state.revision)
            else:
                self.stats.inc("shadow_dropped")

        return {
            "predictionId": pid,
            "deploymentId": deployment_id,
            "revision": state.revision,
            "versionId": route.version.version_id,
            "version": route.version.version,
            "score": score,
            "label": label,
            "threshold": route.version.threshold,
            "imputed": imputed,
            "latencyMs": round(ms, 3),
            "node": self.node_id,
            "shadow": shadow.version.version if shadow else None,
        }


def create_app(node: Node) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app):
        node.start()
        yield
        node.stop()

    app = FastAPI(title=f"serving node {node.node_id}", docs_url="/docs", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health():
        ok = any(s["status"] == "serving" for s in node.store.status())
        return {"status": "ok" if ok else "starting", "node": node.node_id, "deployments": node.store.status()}

    @app.get("/state")
    def state():
        out = []
        for dep_id in node.deployments:
            st = node.store.get(dep_id)
            out.append({
                "deploymentId": dep_id,
                "revision": st.revision if st else None,
                "routes": [
                    {"version": r.version.version, "versionId": r.version.version_id, "mode": r.mode,
                     "weight": r.weight, "sha256": r.version.sha256, "threshold": r.version.threshold,
                     "warmupMs": round(r.version.warmup_ms, 3)}
                    for r in (st.routes if st else [])
                ],
            })
        return {"node": node.node_id, "strictInputs": node.strict, "deployments": out,
                "stats": node.stats.snapshot(), "changeEvents": node.watcher.events}

    @app.post("/predict/{model_id}")
    def predict(model_id: str, req: PredictRequest, env: str = "prod"):
        return node.predict(model_id, env, req)

    return app
