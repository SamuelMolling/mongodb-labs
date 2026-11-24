"""
Propagation: a change stream on `deployments`, instead of polling.

Three rules keep it correct:

  OPEN FIRST, READ SECOND. The stream is opened before the initial read, so a
  promotion committed in between arrives through the read, the stream, or
  both. The revision check in ModelStore.apply makes "both" harmless.

  RESUME TOKENS HAVE A HORIZON. A node resumes from its last token only while
  that point is still in the oplog. Past the window the server answers with
  an error instead of events (ChangeStreamHistoryLost). Retrying the same
  token cannot work: drop it, open a fresh stream, run the full sync.

  RESYNC PERIODICALLY ANYWAY. Every RESYNC_SEC the node re-reads its
  deployments. It costs one find per minute and covers the cases a stream
  cannot: an apply that failed (bad artifact, registry blip) is retried
  because the stored revision is still newer than the loaded one.
"""
import logging
import threading
import time

from pymongo.errors import OperationFailure, PyMongoError

from common.db import COLLECTIONS

log = logging.getLogger("serving.watcher")

# Server error codes after which a resume token is useless.
#   286 ChangeStreamHistoryLost  the token's point fell off the oplog
#   280 ChangeStreamFatalError   the stream cannot continue from this token
HISTORY_LOST = {286, 280}


class DeploymentWatcher(threading.Thread):
    def __init__(self, db, store, deployment_ids, resync_sec=60):
        super().__init__(daemon=True, name="deployment-watcher")
        self.coll = db[COLLECTIONS["deployments"]]
        self.store = store
        self.deployment_ids = list(deployment_ids)
        self.resync_sec = resync_sec
        self.resume_token = None
        self.events = 0
        self.resyncs = 0
        self.last_event_at = None
        self._halt = threading.Event()
        for d in self.deployment_ids:
            store.track(d)

    def stop(self):
        self._halt.set()

    def resync(self):
        found = set()
        for dep in self.coll.find({"_id": {"$in": self.deployment_ids}}):
            found.add(dep["_id"])
            self.store.apply(dep)
        for missing in set(self.deployment_ids) - found:
            log.warning("[%s] deployment does not exist (yet)", missing)
        self.resyncs += 1

    def _handle(self, change):
        op = change["operationType"]
        dep_id = change["documentKey"]["_id"]
        if op == "delete":
            self.store.remove(dep_id)
        elif change.get("fullDocument"):
            result = self.store.apply(change["fullDocument"])
            log.info("[%s] %s event -> %s (revision %s)", dep_id, op, result,
                     change["fullDocument"].get("revision"))
        self.events += 1
        self.last_event_at = time.time()

    def run(self):
        pipeline = [
            {"$match": {
                "documentKey._id": {"$in": self.deployment_ids},
                "operationType": {"$in": ["insert", "update", "replace", "delete"]},
            }}
        ]
        backoff = 1
        while not self._halt.is_set():
            try:
                with self.coll.watch(
                    pipeline,
                    full_document="updateLookup",
                    resume_after=self.resume_token,
                    max_await_time_ms=1000,
                ) as stream:
                    # The stream is open: NOW read the current state.
                    self.resync()
                    backoff = 1
                    next_resync = time.time() + self.resync_sec
                    log.info("watching %s (resume token: %s)", self.deployment_ids,
                             "yes" if self.resume_token else "none")
                    while stream.alive and not self._halt.is_set():
                        change = stream.try_next()
                        if change is not None:
                            self._handle(change)
                        # The token advances even when no event matched our
                        # filter (post-batch resume token), so a long-idle
                        # node does not resume from a point near the horizon.
                        if stream.resume_token is not None:
                            self.resume_token = stream.resume_token
                        if time.time() >= next_resync:
                            self.resync()
                            next_resync = time.time() + self.resync_sec
            except OperationFailure as e:
                if e.code in HISTORY_LOST:
                    log.warning("resume token is past the oplog window (%s): dropping it, full resync", e.code)
                    self.resume_token = None
                else:
                    log.error("change stream failed (%s): %s", e.code, e)
            except PyMongoError as e:
                log.error("change stream error: %s", e)
            if not self._halt.is_set():
                time.sleep(backoff)
                backoff = min(backoff * 2, 30)
