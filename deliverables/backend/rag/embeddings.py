"""FastEmbed embedding wrapper for the SkinSense AI RAG pipeline.

Uses FastEmbed (ONNX, no torch) with `BAAI/bge-small-en-v1.5`, a 384-dim
model — this MUST match `vector(384)` in migration 002_pgvector_rag.sql.

The model is loaded lazily and cached as a process-wide singleton so the
~90MB ONNX weights are only initialised once per worker.
"""

from __future__ import annotations

import threading
from functools import lru_cache
from typing import Iterable, List

from fastembed import TextEmbedding

# Keep in lockstep with the SQL migration's vector(384) columns.
EMBED_MODEL_NAME = "BAAI/bge-small-en-v1.5"
EMBED_DIM = 384

_model_lock = threading.Lock()


@lru_cache(maxsize=1)
def _get_model() -> TextEmbedding:
    """Return the cached FastEmbed model, constructing it on first use."""
    with _model_lock:
        return TextEmbedding(model_name=EMBED_MODEL_NAME)


def embed_query(text: str) -> List[float]:
    """Embed a single query string into a 384-dim vector.

    Prefixed with bge's recommended retrieval instruction to improve
    query/document alignment. Returns a plain ``list[float]`` ready to be
    JSON-serialised into a Supabase RPC call.
    """
    if not text or not text.strip():
        raise ValueError("embed_query received empty text")
    query = f"Represent this sentence for searching relevant passages: {text.strip()}"
    vector = next(iter(_get_model().embed([query])))
    return [float(x) for x in vector]


def embed_documents(texts: Iterable[str]) -> List[List[float]]:
    """Embed a batch of documents (for backfilling product/knowledge rows)."""
    cleaned = [t.strip() for t in texts if t and t.strip()]
    if not cleaned:
        return []
    return [[float(x) for x in v] for v in _get_model().embed(cleaned)]
