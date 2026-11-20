"""
Deterministic, stateless route assignment.

Mirror of control-plane/src/routing.js bucketFor/pickRoute. Both smoke tests
pin the same vectors: if the two implementations ever disagreed, a user would
flip between versions depending on which component computed the bucket.

Never use Python's built-in hash() here. It is randomized per process for
strings (PYTHONHASHSEED), so every pod would assign users differently.
Nothing fails and nothing logs a warning: the canary still receives 10% of
requests, just not 10% of USERS, and the experiment measures noise.
"""
import hashlib

TOTAL_WEIGHT = 10_000


def bucket_for(deployment_id: str, routing_key: str) -> int:
    digest = hashlib.sha256(f"{deployment_id}:{routing_key}".encode()).digest()
    return int.from_bytes(digest[:8], "big") % TOTAL_WEIGHT


def pick_route(deployment_id: str, routes: list, routing_key: str):
    """routes: objects/dicts with .mode/.weight (or ["mode"]/["weight"])."""
    bucket = bucket_for(deployment_id, routing_key)
    acc = 0
    for r in routes:
        mode = r["mode"] if isinstance(r, dict) else r.mode
        weight = r["weight"] if isinstance(r, dict) else r.weight
        if mode != "live":
            continue
        acc += weight
        if bucket < acc:
            return r
    return None
