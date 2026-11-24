"""
MongoDB client and collection names for the Python side.

Keep COLLECTIONS in sync with control-plane/src/db.js.
"""
import os

from pymongo import MongoClient

from . import env  # noqa: F401  (side effect: loads .env)

# Same value as the control plane, so one run of the lab shows up as one
# application in MongoDB DevRel's connection metadata. Overrides any appName
# in the URI.
APP_NAME = os.getenv("APP_NAME") or "devrel-article-changestreams-model-serving"

COLLECTIONS = {
    "models": "models",
    "versions": "model_versions",
    "deployments": "deployments",
    "history": "deployment_history",
    "nodes": "serving_nodes",
    "inference_log": "inference_log",
    "outcomes": "outcomes",
    "alerts": "alerts",
}

ARTIFACT_BUCKET = "artifacts"  # GridFS: artifacts.files + artifacts.chunks


def connect(uri: str | None = None, **kwargs):
    """Returns (client, db). `uri` defaults to MONGODB_URI."""
    uri = uri or os.getenv("MONGODB_URI")
    if not uri:
        raise RuntimeError("MONGODB_URI is not set. Check model-serving/.env.")
    client = MongoClient(
        uri,
        appname=APP_NAME,
        serverSelectionTimeoutMS=10_000,
        **kwargs,
    )
    client.admin.command("ping")
    return client, client[os.getenv("MONGODB_DATABASE", "model_serving")]
