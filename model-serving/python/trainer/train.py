"""
Trains a churn model, exports it to ONNX, uploads the artifact, and writes
a manifest for the registry.

    python -m trainer.train --variant logreg
    python -m trainer.train --variant gbt
    python -m trainer.train --variant broken

Then:  node control-plane/scripts/register.js trainer/out/<model>-<variant>.json
(`make train VARIANT=...` does both.)

Variants:

  logreg   StandardScaler + LogisticRegression. The first production model.
  gbt      GradientBoostingClassifier. Finds the tickets x young-account
           interaction a linear model cannot; better AUC offline.
  broken   LogisticRegression trained with two columns swapped (a feature-
           order bug in the training pipeline). The bug is CONSISTENT between
           training and evaluation, so its offline AUC looks fine. In
           production, where requests arrive in the right order, it is wrong
           -- and it never returns an error. This is the version the canary,
           the shadow and the drift checks exist to catch.

Why ONNX and not pickle/joblib: loading a pickle executes code. A serving
node that loads whatever bytes the registry points at should load a format
that is data, not a program -- and the digest check is easier to reason
about when the artifact cannot run anything on load.
"""
import argparse
import json
import os
import time
from pathlib import Path

import numpy as np
from skl2onnx import to_onnx
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from common import artifacts, baseline, synth
from common.db import connect

OUT = Path(__file__).resolve().parent / "out"
# Operating point: flag the riskiest ~20% of accounts for outreach. Chosen
# per version on its own holdout, so it is part of the version, not of the
# serving code.
FLAG_SHARE = 0.20


def build(variant: str):
    if variant in ("logreg", "broken"):
        return make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000))
    if variant == "gbt":
        return GradientBoostingClassifier(n_estimators=150, max_depth=3, learning_rate=0.1, random_state=7)
    raise SystemExit(f"unknown variant {variant!r} (logreg | gbt | broken)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="churn-classifier")
    ap.add_argument("--variant", default="logreg")
    ap.add_argument("--rows", type=int, default=40_000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--store", default=os.getenv("ARTIFACT_STORE", "gridfs"), choices=["gridfs", "file"])
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    X, y = synth.sample(args.rows, rng, drift=0.0)
    split = int(0.8 * len(X))
    X_train, X_test, y_train, y_test = X[:split], X[split:], y[:split], y[split:]

    if args.variant == "broken":
        # The bug: tenure_days and logins_7d swapped in the TRAINING pipeline.
        # Evaluated on equally-swapped holdout data, so the metrics agree with
        # the bug and look healthy.
        swap = lambda A: A[:, [3, 1, 2, 0, 4, 5]]  # noqa: E731
        X_train, X_test = swap(X_train), swap(X_test)

    t0 = time.time()
    model = build(args.variant).fit(X_train, y_train)
    train_s = time.time() - t0

    proba = model.predict_proba(X_test)[:, 1]
    threshold = float(np.quantile(proba, 1 - FLAG_SHARE))
    metrics = {
        "auc": float(roc_auc_score(y_test, proba)),
        "logloss": float(log_loss(y_test, proba)),
        # Share of holdout rows the model flags at its threshold. The
        # output-drift check compares live traffic against this number.
        "positiveRate": float((proba >= threshold).mean()),
        "precisionAtThreshold": float(y_test[proba >= threshold].mean()),
        "baseRate": float(y_test.mean()),
        "meanScore": float(proba.mean()),
        "trainRows": int(len(X_train)),
        "testRows": int(len(X_test)),
        "trainSeconds": round(train_s, 2),
    }

    # zipmap=False: probabilities as a plain [n, 2] float tensor, not a list
    # of dicts. Simpler for the runtime and for anyone reading the graph.
    onx = to_onnx(model, X_train[:1].astype(np.float32), options={"zipmap": False},
                  target_opset={"": 17, "ai.onnx.ml": 3})
    data = onx.SerializeToString()

    if args.store == "gridfs":
        client, db = connect()
        try:
            artifact = artifacts.put(data, model_id=args.model, store="gridfs", db=db)
        finally:
            client.close()
    else:
        artifact = artifacts.put(data, model_id=args.model, store="file")

    manifest = {
        "modelId": args.model,
        "framework": f"sklearn/{type(model).__name__}",
        "description": {
            "logreg": "StandardScaler + LogisticRegression",
            "gbt": "GradientBoostingClassifier, 150 trees, depth 3",
            "broken": "LogisticRegression -- trained with tenure_days/logins_7d swapped",
        }[args.variant],
        "artifact": artifact,
        "inputSchema": synth.INPUT_SCHEMA,
        "output": {"type": "binary", "threshold": threshold, "scoreName": "churn_probability"},
        "metrics": metrics,
        "trainingRef": {
            "generator": "common.synth",
            "seed": args.seed,
            "rows": args.rows,
            "variant": args.variant,
            "trainedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
        # Baseline from the TRAINING inputs as the model saw them -- except
        # for "broken", where it is computed on correctly ordered data, the
        # way a separate feature-stats job would. (That job not knowing about
        # the training bug is the realistic part.)
        "baseline": baseline.build(X[:split], synth.FEATURES),
    }

    OUT.mkdir(exist_ok=True)
    path = OUT / f"{args.model}-{args.variant}.json"
    path.write_text(json.dumps(manifest, indent=2))
    print(
        f"✓ trained {args.variant}: auc={metrics['auc']:.3f} logloss={metrics['logloss']:.3f} "
        f"positiveRate={metrics['positiveRate']:.3f}  artifact={artifact['uri']} "
        f"({artifact['bytes'] / 1024:.1f} KiB)\n  manifest: {path}"
    )


if __name__ == "__main__":
    main()
