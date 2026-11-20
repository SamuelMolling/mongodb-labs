"""
Training-time distribution per feature: bin edges + share of rows per bin.

The drift check in the control plane bins live data with $bucket using
these exact edges, so the semantics here MUST match $bucket:

  - bins are [lower, upper)
  - a value below the first edge or at/above the last edge goes to the
    default bucket ("out_of_range")

control-plane/src/drift.js has the same bin_index; both smoke tests pin it.
"""
import math

import numpy as np


def edges_for(values: np.ndarray, n_bins: int = 10) -> list[float]:
    """Quantile edges (deciles by default), deduplicated, last edge just past max.

    Deduplication matters for low-cardinality features: plan_tier has three
    values, so ten quantiles collapse to a handful of distinct edges, and
    $bucket requires boundaries to be strictly ascending.
    """
    qs = np.quantile(values, np.linspace(0, 1, n_bins + 1))
    edges = sorted(set(float(q) for q in qs))  # the last one is always max(values)
    # The max itself must fall INSIDE a bin ([lower, upper)), so one more edge
    # goes just above it. Appending (not replacing the max) keeps discrete
    # features separable: plan_tier stays [0,1) [1,2) [2,2+), instead of
    # merging tiers 1 and 2 into one bin.
    edges.append(math.nextafter(float(values.max()), math.inf))
    return edges


def bin_index(edges: list[float], x) -> int:
    """Same contract as $bucket: [lower, upper); outside -> len(edges) - 1."""
    if x is None or isinstance(x, bool) or not isinstance(x, (int, float)):
        return len(edges) - 1
    if x < edges[0] or x >= edges[-1]:
        return len(edges) - 1
    lo, hi = 0, len(edges) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if x >= edges[mid]:
            lo = mid
        else:
            hi = mid
    return lo


def build(X: np.ndarray, feature_names: list[str], n_bins: int = 10) -> dict:
    """{feature: {edges, ratios, outOfRange}} for the version document."""
    out = {}
    for j, name in enumerate(feature_names):
        col = X[:, j]
        edges = edges_for(col, n_bins)
        counts = np.zeros(len(edges), dtype=np.int64)  # last slot = out_of_range
        for v in col:
            counts[bin_index(edges, float(v))] += 1
        total = counts.sum()
        out[name] = {
            "edges": edges,
            "ratios": [float(c / total) for c in counts[:-1]],
            "outOfRange": float(counts[-1] / total),
        }
    return out
