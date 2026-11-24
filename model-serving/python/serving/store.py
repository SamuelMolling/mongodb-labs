"""
What this node is serving, and the only code allowed to change it.

apply(deployment_doc) is the whole propagation contract:

  1. ignore anything not newer than what is loaded (revision check). This is
     what makes "the change arrived through the initial read AND through the
     stream" harmless, and what makes a full resync always safe.
  2. stage: fetch every version the new routes need, verify each digest,
     warm each one up -- beside the versions currently serving.
  3. swap: replace the reference the request path reads, in one assignment.
     In-flight requests finish on the old state object they already hold.
  4. if any step in 2 fails: keep serving what we had, record the error,
     report "degraded" in the heartbeat. A periodic resync retries, because
     the revision on disk is still newer than the one loaded.
"""
import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from bson import ObjectId

from common import artifacts
from common.db import COLLECTIONS
from .runtime import LoadedVersion

log = logging.getLogger("serving.store")


@dataclass(frozen=True)
class Route:
    version: LoadedVersion
    weight: int
    mode: str  # live | shadow


@dataclass(frozen=True)
class DeploymentState:
    deployment_id: str
    revision: int
    routes: tuple
    applied_at: float = field(default_factory=time.time)

    @property
    def live(self):
        return [r for r in self.routes if r.mode == "live"]

    @property
    def shadow(self):
        return next((r for r in self.routes if r.mode == "shadow"), None)


class ModelStore:
    def __init__(self, db, cache_dir: Path, loader=None):
        self.db = db
        self.cache_dir = cache_dir
        self._states: dict[str, DeploymentState] = {}
        self._versions: dict[str, LoadedVersion] = {}
        self._status: dict[str, dict] = {}
        self._apply_lock = threading.Lock()  # one apply at a time; reads never lock
        # Injectable for the offline tests: (version_doc) -> LoadedVersion
        self._loader = loader or self._load_from_registry

    # -- read path (request handlers) --------------------------------------

    def get(self, deployment_id: str) -> DeploymentState | None:
        # A plain dict read of an immutable object: no lock on the hot path.
        return self._states.get(deployment_id)

    def status(self) -> list[dict]:
        out = []
        for dep_id, st in self._status.items():
            state = self._states.get(dep_id)
            out.append({
                "deploymentId": dep_id,
                "revision": state.revision if state else None,
                "versions": [r.version.version_id for r in state.routes] if state else [],
                "status": st.get("status", "unknown"),
                "lastError": st.get("lastError"),
                "pendingRevision": st.get("pendingRevision"),
                "appliedAt": st.get("appliedAt"),
            })
        return out

    # -- write path (watcher) ----------------------------------------------

    def track(self, deployment_id: str):
        self._status.setdefault(deployment_id, {"status": "waiting"})

    def apply(self, dep: dict) -> str:
        dep_id = dep["_id"]
        with self._apply_lock:
            current = self._states.get(dep_id)
            if current and dep["revision"] <= current.revision:
                return "ignored"  # duplicate or out of order

            t0 = time.perf_counter()
            try:
                routes = tuple(
                    Route(version=self._version(str(r["versionId"])), weight=int(r["weight"]), mode=r["mode"])
                    for r in dep.get("routes", [])
                )
            except Exception as e:  # noqa: BLE001 -- any load failure keeps the old state
                self._status[dep_id] = {
                    **self._status.get(dep_id, {}),
                    "status": "degraded" if current else "failed",
                    "lastError": f"revision {dep['revision']}: {e}",
                    "pendingRevision": dep["revision"],
                }
                log.error("[%s] revision %s NOT applied, still serving %s: %s",
                          dep_id, dep["revision"], current.revision if current else None, e)
                return "failed"

            # The swap. One assignment; readers see old or new, never half.
            self._states[dep_id] = DeploymentState(dep_id, dep["revision"], routes)
            self._status[dep_id] = {"status": "serving", "lastError": None,
                                    "pendingRevision": None, "appliedAt": time.time()}
            self._evict_unused()
            log.info("[%s] revision %s applied in %.0f ms: %s", dep_id, dep["revision"],
                     (time.perf_counter() - t0) * 1000,
                     ", ".join(f"v{r.version.version}:{r.mode}:{r.weight}" for r in routes) or "(no routes)")
            return "applied"

    def remove(self, deployment_id: str):
        with self._apply_lock:
            self._states.pop(deployment_id, None)
            self._status[deployment_id] = {"status": "removed"}
            self._evict_unused()

    # -- internals -----------------------------------------------------------

    def _version(self, version_id: str) -> LoadedVersion:
        lv = self._versions.get(version_id)
        if lv is not None:
            return lv  # versions are immutable: a loaded one never goes stale
        doc = self.db[COLLECTIONS["versions"]].find_one({"_id": ObjectId(version_id)}, {"baseline": 0})
        if doc is None:
            raise LookupError(f"version {version_id} not found in registry")
        lv = self._loader(doc)
        self._versions[version_id] = lv
        return lv

    def _load_from_registry(self, doc: dict) -> LoadedVersion:
        data = artifacts.load_verified(doc, db=self.db, cache_dir=self.cache_dir)
        return LoadedVersion.from_bytes(doc, data)

    def _evict_unused(self):
        in_use = {r.version.version_id for s in self._states.values() for r in s.routes}
        for vid in list(self._versions):
            if vid not in in_use:
                del self._versions[vid]
