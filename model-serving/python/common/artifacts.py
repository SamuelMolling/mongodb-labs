"""
Artifact storage behind one interface. The registry stores a URI, a size and
a SHA-256; it never stores the bytes.

  gridfs://artifacts/<fileId>   in the cluster (GridFS bucket "artifacts")
  file:///abs/path/model.onnx   a local directory standing in for S3/GCS

Write-once: file artifacts are content-addressed (<sha256>.onnx), so the
same bytes always get the same path and different bytes can never overwrite
an existing one. Version 42 has metrics attached to it, and those metrics
describe a specific set of bytes.
"""
import hashlib
import os
from pathlib import Path
from urllib.parse import urlparse

from bson import ObjectId
from gridfs import GridFSBucket

from .db import ARTIFACT_BUCKET
from .env import LAB_ROOT


class ArtifactIntegrityError(Exception):
    """The bytes we fetched are not the bytes the registry describes."""

    def __init__(self, version_id, expected, actual):
        super().__init__(
            f"artifact for version {version_id}: sha256 {actual[:12]}… "
            f"does not match registry {expected[:12]}…"
        )
        self.expected = expected
        self.actual = actual


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def artifact_dir() -> Path:
    p = Path(os.getenv("ARTIFACT_DIR", "./artifacts"))
    return p if p.is_absolute() else (LAB_ROOT / p).resolve()


def put(data: bytes, *, model_id: str, store: str, db=None, filename: str = "model.onnx") -> dict:
    """Uploads and returns the registry's artifact sub-document."""
    digest = sha256_bytes(data)
    if store == "gridfs":
        if db is None:
            raise ValueError("gridfs store needs a database handle")
        bucket = GridFSBucket(db, bucket_name=ARTIFACT_BUCKET)
        file_id = bucket.upload_from_stream(
            f"{model_id}/{digest}/{filename}",
            data,
            metadata={"modelId": model_id, "sha256": digest},
        )
        uri = f"gridfs://{ARTIFACT_BUCKET}/{file_id}"
    elif store == "file":
        target = artifact_dir() / model_id / f"{digest}.onnx"
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            tmp = target.with_suffix(".tmp")
            tmp.write_bytes(data)
            tmp.rename(target)  # atomic on POSIX: no reader ever sees half a file
        uri = target.as_uri()
    else:
        raise ValueError(f"unknown ARTIFACT_STORE {store!r} (gridfs | file)")
    return {"uri": uri, "sha256": digest, "bytes": len(data), "format": "onnx"}


def fetch(uri: str, *, db=None) -> bytes:
    """Downloads the bytes behind a URI. Does NOT verify: see load_verified."""
    u = urlparse(uri)
    if u.scheme == "gridfs":
        if db is None:
            raise ValueError("gridfs artifact needs a database handle")
        bucket = GridFSBucket(db, bucket_name=u.netloc or ARTIFACT_BUCKET)
        return bucket.open_download_stream(ObjectId(u.path.lstrip("/"))).read()
    if u.scheme == "file":
        return Path(u.path).read_bytes()
    raise ValueError(f"unsupported artifact scheme {u.scheme!r}")


def load_verified(version: dict, *, db=None, cache_dir: Path | None = None) -> bytes:
    """
    Fetches the artifact and refuses to return it unless the digest matches.

    A wrong model that loads cleanly is worse than a missing model that fails
    loudly: it would serve predictions, with no error, from bytes nobody
    evaluated (a half-written upload, a file overwritten in place, the wrong
    bucket).

    A local cache is keyed by digest. Cached bytes are re-verified on every
    load: a cache is just another place bytes can go wrong.
    """
    expected = version["artifact"]["sha256"]
    cached = cache_dir / f"{expected}.onnx" if cache_dir else None
    if cached and cached.exists():
        data = cached.read_bytes()
        if sha256_bytes(data) == expected:
            return data
        cached.unlink(missing_ok=True)

    data = fetch(version["artifact"]["uri"], db=db)
    actual = sha256_bytes(data)
    if actual != expected:
        raise ArtifactIntegrityError(version.get("_id"), expected, actual)
    if cached:
        cached.parent.mkdir(parents=True, exist_ok=True)
        tmp = cached.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.rename(cached)
    return data
