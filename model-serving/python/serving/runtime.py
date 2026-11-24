"""
A loaded version: ONNX session + the contract it was registered with.
"""
import time
from dataclasses import dataclass, field

import numpy as np
import onnxruntime as ort


class InputContractError(ValueError):
    """Raised in strict mode when a request breaks the version's inputSchema."""


def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v  # NaN != NaN


@dataclass
class LoadedVersion:
    version_id: str
    version: int
    input_schema: list
    threshold: float
    sha256: str
    session: ort.InferenceSession
    input_name: str
    loaded_at: float = field(default_factory=time.time)
    warmup_ms: float = 0.0

    @classmethod
    def from_bytes(cls, doc: dict, data: bytes) -> "LoadedVersion":
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 1  # many small requests: parallelism comes from the server
        sess = ort.InferenceSession(data, sess_options=opts, providers=["CPUExecutionProvider"])
        lv = cls(
            version_id=str(doc["_id"]),
            version=int(doc["version"]),
            input_schema=doc["inputSchema"],
            threshold=float((doc.get("output") or {}).get("threshold", 0.5)),
            sha256=doc["artifact"]["sha256"],
            session=sess,
            input_name=sess.get_inputs()[0].name,
        )
        lv.warm_up()
        return lv

    def warm_up(self, rows: int = 8):
        """
        Pay for lazy initialization BEFORE the swap, so the first real request
        on the new version is not the one that discovers the cost (or that
        the graph does not run at all).
        """
        t0 = time.perf_counter()
        x = np.zeros((rows, len(self.input_schema)), dtype=np.float32)
        scores = self.score(x)
        if scores.shape != (rows,) or not np.all(np.isfinite(scores)):
            raise RuntimeError(f"v{self.version} warm-up produced invalid output {scores!r}")
        self.warmup_ms = (time.perf_counter() - t0) * 1000

    def vectorize(self, features: dict, strict: bool):
        """
        Request JSON -> float32 row in inputSchema order.

        Missing/null/non-numeric features: imputed with 0 unless strict. Most
        stacks impute by default and carry on, which is exactly why the
        platform measures it (the input-contract check) instead of assuming
        upstream never breaks.
        """
        row = np.zeros((1, len(self.input_schema)), dtype=np.float32)
        imputed = []
        for j, spec in enumerate(self.input_schema):
            v = features.get(spec["name"])
            if _is_number(v):
                row[0, j] = float(v)
            else:
                if strict:
                    raise InputContractError(f"feature {spec['name']!r} is missing or not numeric")
                imputed.append(spec["name"])
        return row, imputed

    def score(self, x: np.ndarray) -> np.ndarray:
        # skl2onnx with zipmap=False: outputs = [label, probabilities[n, 2]]
        outputs = self.session.run(None, {self.input_name: x})
        return outputs[1][:, 1].astype(np.float64)
