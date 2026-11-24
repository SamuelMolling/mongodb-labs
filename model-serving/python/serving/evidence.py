"""
Inference log writer and heartbeat.

The log is evidence, not state: it must never slow down or fail a request.
Records go into a bounded in-memory queue and a background thread writes
them in batches with insert_many(ordered=False). If the queue is full, the
record is dropped and counted -- a dropped log line is a visible number in
the heartbeat; a request blocked on a log write is an outage.

Writes use w:1. Losing the last second of evidence in a primary failover is
an acceptable trade for not waiting on a majority acknowledgement per batch.
"""
import logging
import queue
import socket
import threading
import time
from datetime import datetime, timezone

from pymongo import WriteConcern
from pymongo.errors import BulkWriteError, PyMongoError

from common.db import COLLECTIONS

log = logging.getLogger("serving.evidence")


class InferenceLogger(threading.Thread):
    def __init__(self, db, max_queue=20_000, batch=500, flush_sec=1.0):
        super().__init__(daemon=True, name="inference-logger")
        self.coll = db[COLLECTIONS["inference_log"]].with_options(write_concern=WriteConcern(w=1))
        self.q: queue.Queue = queue.Queue(maxsize=max_queue)
        self.batch = batch
        self.flush_sec = flush_sec
        self.written = 0
        self.dropped = 0
        self.failed = 0
        self._halt = threading.Event()

    def record(self, doc: dict):
        try:
            self.q.put_nowait(doc)
        except queue.Full:
            self.dropped += 1

    def stop(self):
        self._halt.set()

    def _drain(self):
        docs = []
        deadline = time.time() + self.flush_sec
        while len(docs) < self.batch:
            timeout = deadline - time.time()
            if timeout <= 0:
                break
            try:
                docs.append(self.q.get(timeout=timeout))
            except queue.Empty:
                break
        return docs

    def run(self):
        while not (self._halt.is_set() and self.q.empty()):
            docs = self._drain()
            if not docs:
                continue
            try:
                self.coll.insert_many(docs, ordered=False)
                self.written += len(docs)
            except BulkWriteError as e:
                ok = e.details.get("nInserted", 0)
                self.written += ok
                self.failed += len(docs) - ok
            except PyMongoError as e:
                self.failed += len(docs)
                log.error("inference log batch of %d failed: %s", len(docs), e)


class Heartbeat(threading.Thread):
    """
    Every few seconds: which revision of each deployment this node serves.
    One aggregation over serving_nodes then answers "did the fleet converge?".
    The collection has a TTL on lastSeen, so dead nodes disappear on their own.
    """

    def __init__(self, db, node_id, url, store, watcher, logger, stats, every_sec=5):
        super().__init__(daemon=True, name="heartbeat")
        self.coll = db[COLLECTIONS["nodes"]]
        self.node_id, self.url = node_id, url
        self.store, self.watcher, self.logger, self.stats = store, watcher, logger, stats
        self.every_sec = every_sec
        self.started_at = datetime.now(timezone.utc)
        self._halt = threading.Event()

    def stop(self):
        self._halt.set()

    def beat(self):
        self.coll.update_one(
            {"_id": self.node_id},
            {
                "$set": {
                    "url": self.url,
                    "host": socket.gethostname(),
                    "lastSeen": datetime.now(timezone.utc),
                    "deployments": self.store.status(),
                    "stats": {
                        **self.stats.snapshot(),
                        "logWritten": self.logger.written,
                        "logDropped": self.logger.dropped,
                        "logFailed": self.logger.failed,
                        "logQueued": self.logger.q.qsize(),
                        "changeEvents": self.watcher.events,
                        "resyncs": self.watcher.resyncs,
                    },
                },
                "$setOnInsert": {"startedAt": self.started_at},
            },
            upsert=True,
        )

    def run(self):
        while not self._halt.is_set():
            try:
                self.beat()
            except PyMongoError as e:
                log.error("heartbeat failed: %s", e)
            self._halt.wait(self.every_sec)
