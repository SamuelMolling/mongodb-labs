"""
Load generator: realistic traffic, controllable drift, late labels.

    python loadgen.py                         # 10 req/s, no drift
    python loadgen.py --drift 0.6             # a new cohort arrives
    python loadgen.py --null-feature tenure_days --null-rate 1.0
                                              # upstream renamed a column
    python loadgen.py --rps 5 --duration 60

Requests round-robin across the serving nodes. Every request carries a
routingKey from a fixed pool of users, so canary assignment is sticky.

Labels: the generator knows each request's true outcome. It reports a share
of them to the control plane after --label-delay seconds, imitating ground
truth that arrives late (in real life: 30 days late).

Stdlib only (plus numpy for the shared generator), so it runs anywhere the
venv runs.
"""
import argparse
import itertools
import json
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import Counter, deque

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import env  # noqa: E402,F401
from common import synth  # noqa: E402


def post(url, body, timeout=5):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def main():
    cp = os.getenv("CONTROL_PLANE_PORT", "4030")
    ap = argparse.ArgumentParser()
    ap.add_argument("--nodes", default="http://localhost:8031,http://localhost:8032")
    ap.add_argument("--control-plane", default=f"http://localhost:{cp}")
    ap.add_argument("--model", default="churn-classifier")
    ap.add_argument("--rps", type=float, default=10.0)
    ap.add_argument("--duration", type=float, default=0, help="seconds; 0 = until Ctrl+C")
    ap.add_argument("--drift", type=float, default=0.0, help="0 = training-like, 1 = new cohort")
    ap.add_argument("--users", type=int, default=2000)
    ap.add_argument("--null-feature", default=None, help="send this feature as null")
    ap.add_argument("--null-rate", type=float, default=1.0)
    ap.add_argument("--label-rate", type=float, default=0.5, help="share of requests that get a label")
    ap.add_argument("--label-delay", type=float, default=20.0, help="seconds before labels are reported")
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()

    nodes = [n.strip() for n in args.nodes.split(",") if n.strip()]
    rng = np.random.default_rng(args.seed)
    prng = random.Random(args.seed)
    users = [f"user-{i}" for i in range(args.users)]
    rr = itertools.cycle(nodes)

    pending = deque()  # (due_at, predictionId, label)
    lock = threading.Lock()
    by_version = Counter()
    errors = Counter()
    sent = 0
    stop = threading.Event()

    def labeler():
        while not stop.is_set():
            now = time.time()
            batch = []
            with lock:
                while pending and pending[0][0] <= now and len(batch) < 1000:
                    _, pid, y = pending.popleft()
                    batch.append({"predictionId": pid, "label": y})
            if batch:
                try:
                    post(f"{args.control_plane}/api/outcomes", {"outcomes": batch})
                except Exception as e:  # noqa: BLE001
                    errors[f"labels: {type(e).__name__}"] += 1
            time.sleep(1)

    threading.Thread(target=labeler, daemon=True).start()

    print(f"→ {args.rps} req/s to {', '.join(nodes)}  drift={args.drift}"
          + (f"  {args.null_feature}=null ({args.null_rate:.0%})" if args.null_feature else "")
          + "   Ctrl+C to stop")

    interval = 1.0 / args.rps
    started = time.time()
    next_at = started
    last_report = started
    try:
        while not args.duration or time.time() - started < args.duration:
            X, y = synth.sample(1, rng, drift=args.drift)
            features = synth.to_features(X[0])
            if args.null_feature and prng.random() < args.null_rate:
                features[args.null_feature] = None
            node = next(rr)
            try:
                r = post(f"{node}/predict/{args.model}", {"features": features, "routingKey": prng.choice(users)})
                by_version[f"v{r['version']}"] += 1
                if prng.random() < args.label_rate:
                    with lock:
                        pending.append((time.time() + args.label_delay, r["predictionId"], int(y[0])))
            except urllib.error.HTTPError as e:
                errors[f"HTTP {e.code}"] += 1
            except Exception as e:  # noqa: BLE001
                errors[type(e).__name__] += 1
            sent += 1

            if time.time() - last_report >= 5:
                last_report = time.time()
                mix = "  ".join(f"{k}:{v}" for k, v in sorted(by_version.items()))
                err = ("  errors " + ", ".join(f"{k}:{v}" for k, v in errors.items())) if errors else ""
                print(f"  sent {sent}   {mix}{err}")

            next_at += interval
            time.sleep(max(0.0, next_at - time.time()))
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        print(f"\nstopped after {sent} requests ({len(pending)} label(s) not yet due were not sent)")


if __name__ == "__main__":
    main()
