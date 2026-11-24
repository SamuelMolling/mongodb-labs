"""
Offline tests for the Python side -- no cluster, no network.

    python -m unittest discover -s tests -v      (or `make smoke`)

Covers the parts whose correctness does not need a database: routing
determinism (across processes and against the Node implementation), bin
semantics shared with $bucket, digest verification, the revision rule in
ModelStore.apply, input vectorization, and the request path's shadow and
logging behaviour.
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from common import artifacts, baseline, synth  # noqa: E402
from serving.routing import bucket_for, pick_route  # noqa: E402
from serving.runtime import InputContractError, LoadedVersion  # noqa: E402
from serving.store import ModelStore  # noqa: E402
from serving.watcher import HISTORY_LOST  # noqa: E402
from serving.evidence import InferenceLogger  # noqa: E402

# Same vectors as control-plane/scripts/smoke.js. Change one, change both.
VECTORS = {"user-1": 2421, "user-2": 6585, "user-42": 9520, "acct-9001": 9646, "": 7524}


def tiny_onnx():
    """A real ONNX model, trained in the test: 400 rows, logistic regression."""
    from skl2onnx import to_onnx
    from sklearn.linear_model import LogisticRegression

    X, y = synth.sample(400, np.random.default_rng(0))
    m = LogisticRegression(max_iter=500).fit(X, y)
    return to_onnx(m, X[:1].astype(np.float32), options={"zipmap": False},
                   target_opset={"": 17, "ai.onnx.ml": 3}).SerializeToString()


def version_doc(vid="a" * 24, version=1, data=b"", uri="file:///nowhere"):
    return {
        "_id": vid, "version": version, "inputSchema": synth.INPUT_SCHEMA,
        "output": {"threshold": 0.2},
        "artifact": {"uri": uri, "sha256": artifacts.sha256_bytes(data)},
    }


class Routing(unittest.TestCase):
    def test_pinned_vectors_match_node(self):
        for key, expected in VECTORS.items():
            self.assertEqual(bucket_for("churn-classifier/prod", key), expected, key)

    def test_independent_of_python_hash_seed(self):
        # The whole point of not using hash(): two processes, two seeds, one answer.
        code = "from serving.routing import bucket_for; print(bucket_for('churn-classifier/prod','user-1'))"
        outs = set()
        for seed in ("1", "2"):
            r = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True,
                               env={**os.environ, "PYTHONHASHSEED": seed})
            outs.add(r.stdout.strip())
        self.assertEqual(outs, {str(VECTORS["user-1"])})

    def test_weights_and_stickiness(self):
        routes = [{"versionId": "A", "weight": 9000, "mode": "live"},
                  {"versionId": "B", "weight": 1000, "mode": "live"},
                  {"versionId": "S", "weight": 0, "mode": "shadow"}]
        picks = [pick_route("d", routes, f"u{i}")["versionId"] for i in range(20000)]
        share = picks.count("B") / len(picks)
        self.assertTrue(0.09 < share < 0.11, share)
        self.assertNotIn("S", picks, "a shadow route must never answer")


class Baseline(unittest.TestCase):
    def test_bucket_semantics(self):
        edges = [0, 30, 90, 365, 100000]
        self.assertEqual(baseline.bin_index(edges, 30), 1)        # [lower, upper)
        self.assertEqual(baseline.bin_index(edges, 29.999), 0)
        self.assertEqual(baseline.bin_index(edges, 100000), 4)    # last edge -> out_of_range
        self.assertEqual(baseline.bin_index(edges, -1), 4)
        self.assertEqual(baseline.bin_index(edges, None), 4)

    def test_discrete_feature_keeps_its_values_apart(self):
        tiers = np.array([0, 0, 1, 1, 2, 2], dtype=float)
        e = baseline.edges_for(tiers)
        self.assertEqual(len({baseline.bin_index(e, t) for t in (0, 1, 2)}), 3, e)

    def test_baseline_ratios_sum_to_one_and_max_is_in_range(self):
        X, _ = synth.sample(5000, np.random.default_rng(3))
        b = baseline.build(X, synth.FEATURES)
        for name, spec in b.items():
            self.assertAlmostEqual(sum(spec["ratios"]) + spec["outOfRange"], 1.0, places=9)
            self.assertEqual(spec["outOfRange"], 0.0, name)
            self.assertEqual(spec["edges"], sorted(set(spec["edges"])), f"{name}: edges must be strictly ascending")


class Artifacts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["ARTIFACT_DIR"] = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_file_store_is_content_addressed(self):
        a = artifacts.put(b"bytes-1", model_id="m", store="file")
        b = artifacts.put(b"bytes-1", model_id="m", store="file")
        c = artifacts.put(b"bytes-2", model_id="m", store="file")
        self.assertEqual(a["uri"], b["uri"])
        self.assertNotEqual(a["uri"], c["uri"])
        self.assertEqual(artifacts.fetch(a["uri"]), b"bytes-1")

    def test_tampered_artifact_is_refused(self):
        art = artifacts.put(b"good-bytes", model_id="m", store="file")
        Path(art["uri"].removeprefix("file://")).write_bytes(b"evil-bytes")
        with self.assertRaises(artifacts.ArtifactIntegrityError):
            artifacts.load_verified({"_id": "v", "artifact": art})

    def test_corrupted_cache_is_refetched(self):
        art = artifacts.put(b"good-bytes", model_id="m", store="file")
        cache = Path(self.tmp.name) / "cache"
        artifacts.load_verified({"_id": "v", "artifact": art}, cache_dir=cache)
        (cache / f"{art['sha256']}.onnx").write_bytes(b"bit rot")
        self.assertEqual(artifacts.load_verified({"_id": "v", "artifact": art}, cache_dir=cache), b"good-bytes")


class Runtime(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = tiny_onnx()
        cls.lv = LoadedVersion.from_bytes(version_doc(data=cls.data), cls.data)

    def test_scores_are_probabilities(self):
        X, _ = synth.sample(50, np.random.default_rng(1))
        s = self.lv.score(X.astype(np.float32))
        self.assertEqual(s.shape, (50,))
        self.assertTrue(np.all((s >= 0) & (s <= 1)))

    def test_null_feature_is_imputed_and_reported(self):
        f = synth.to_features(synth.sample(1, np.random.default_rng(2))[0][0])
        f["tenure_days"] = None
        _, imputed = self.lv.vectorize(f, strict=False)
        self.assertEqual(imputed, ["tenure_days"])

    def test_strict_mode_rejects(self):
        with self.assertRaises(InputContractError):
            self.lv.vectorize({"seats": 3}, strict=True)

    def test_booleans_are_not_numbers(self):
        f = synth.to_features(synth.sample(1, np.random.default_rng(2))[0][0])
        f["seats"] = True
        self.assertIn("seats", self.lv.vectorize(f, strict=False)[1])


class FakeVersions:
    def __init__(self, docs):
        self.docs = {d["_id"]: d for d in docs}

    def find_one(self, q, _proj=None):
        return self.docs.get(str(q["_id"]))


class FakeDB(dict):
    pass


class Store(unittest.TestCase):
    A, B = "a" * 24, "b" * 24

    def setUp(self):
        data = tiny_onnx()
        self.loads = []
        self.fail = set()

        def loader(doc):
            if doc["_id"] in self.fail:
                raise RuntimeError("artifact unavailable")
            self.loads.append(doc["_id"])
            return LoadedVersion.from_bytes(doc, data)

        db = FakeDB(model_versions=FakeVersions([version_doc(self.A, 1, data), version_doc(self.B, 2, data)]))
        self.store = ModelStore(db, Path(tempfile.mkdtemp()), loader=loader)

    def dep(self, rev, *routes):
        return {"_id": "m/prod", "revision": rev,
                "routes": [{"versionId": v, "weight": w, "mode": m} for v, w, m in routes]}

    def test_revision_rule(self):
        self.assertEqual(self.store.apply(self.dep(1, (self.A, 10000, "live"))), "applied")
        self.assertEqual(self.store.apply(self.dep(1, (self.A, 10000, "live"))), "ignored")  # duplicate
        self.assertEqual(self.store.apply(self.dep(0)), "ignored")                          # out of order
        self.assertEqual(self.store.get("m/prod").revision, 1)

    def test_failed_load_keeps_serving_old_revision(self):
        self.store.apply(self.dep(1, (self.A, 10000, "live")))
        self.fail.add(self.B)
        r = self.store.apply(self.dep(2, (self.A, 9000, "live"), (self.B, 1000, "live")))
        self.assertEqual(r, "failed")
        self.assertEqual(self.store.get("m/prod").revision, 1, "must keep serving what it had")
        st = self.store.status()[0]
        self.assertEqual(st["status"], "degraded")
        self.assertEqual(st["pendingRevision"], 2)
        # The periodic resync retries: same revision, now loadable.
        self.fail.clear()
        self.assertEqual(self.store.apply(self.dep(2, (self.A, 9000, "live"), (self.B, 1000, "live"))), "applied")

    def test_versions_are_reused_and_evicted(self):
        self.store.apply(self.dep(1, (self.A, 10000, "live")))
        self.store.apply(self.dep(2, (self.A, 9000, "live"), (self.B, 1000, "live")))
        self.assertEqual(self.loads, [self.A, self.B], "A must not be loaded twice")
        self.store.apply(self.dep(3, (self.B, 10000, "live")))
        self.assertNotIn(self.A, self.store._versions, "A is unused and should be released")


class RequestPath(unittest.TestCase):
    """Node.predict without a database: logger and store are swapped for fakes."""

    def test_shadow_shares_prediction_id_and_never_answers(self):
        import threading
        from concurrent.futures import ThreadPoolExecutor

        from serving.app import Node, PredictRequest, Stats

        data = tiny_onnx()
        A, S = "a" * 24, "c" * 24
        db = FakeDB(model_versions=FakeVersions([version_doc(A, 1, data), version_doc(S, 3, data)]))
        store = ModelStore(db, Path(tempfile.mkdtemp()), loader=lambda d: LoadedVersion.from_bytes(d, data))
        store.apply({"_id": "m/prod", "revision": 4, "routes": [
            {"versionId": A, "weight": 10000, "mode": "live"},
            {"versionId": S, "weight": 0, "mode": "shadow"}]})

        logged = []
        node = object.__new__(Node)
        node.node_id, node.strict, node.store, node.stats = "test", False, store, Stats()
        node.logger = type("L", (), {"record": lambda self, d: logged.append(d)})()
        node.shadow_pool = ThreadPoolExecutor(max_workers=1)
        node.shadow_slots = threading.BoundedSemaphore(4)

        f = synth.to_features(synth.sample(1, np.random.default_rng(5))[0][0])
        r = node.predict("m", "prod", PredictRequest(features=f, routingKey="user-1"))
        node.shadow_pool.shutdown(wait=True)

        self.assertEqual(r["version"], 1, "the live version answers")
        self.assertEqual(r["revision"], 4)
        modes = sorted(d["meta"]["mode"] for d in logged)
        self.assertEqual(modes, ["live", "shadow"])
        self.assertEqual(len({d["predictionId"] for d in logged}), 1, "one label must score both")


class Evidence(unittest.TestCase):
    def test_full_queue_drops_and_counts_instead_of_blocking(self):
        class Coll:
            def with_options(self, **_):
                return self
        lg = InferenceLogger({"inference_log": Coll()}, max_queue=2)
        for _ in range(5):
            lg.record({"x": 1})
        self.assertEqual(lg.dropped, 3)

    def test_history_lost_codes(self):
        self.assertIn(286, HISTORY_LOST)


if __name__ == "__main__":
    unittest.main()
