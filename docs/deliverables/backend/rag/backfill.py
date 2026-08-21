"""One-shot backfill: compute and store embeddings for existing rows.

Run once after applying migration 002 (and again whenever you add
products or knowledge without embeddings):

    python -m rag.backfill

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment
(service-role key needed to UPDATE rows past RLS).
"""

from __future__ import annotations

import os
from typing import List

from supabase import create_client

from .embeddings import embed_documents


def _client():
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def _product_text(row: dict) -> str:
    parts: List[str] = [row.get("name") or ""]
    for key in ("target_conditions", "active_ingredients"):
        vals = row.get(key) or []
        if vals:
            parts.append(", ".join(vals))
    return ". ".join(p for p in parts if p)


def backfill_products(supabase) -> int:
    rows = (
        supabase.table("products").select("*").is_("embedding", "null").execute().data
        or []
    )
    if not rows:
        return 0
    vectors = embed_documents([_product_text(r) for r in rows])
    for row, vec in zip(rows, vectors):
        supabase.table("products").update({"embedding": vec}).eq("id", row["id"]).execute()
    return len(rows)


def backfill_knowledge(supabase) -> int:
    rows = (
        supabase.table("skincare_knowledge")
        .select("*")
        .is_("embedding", "null")
        .execute()
        .data
        or []
    )
    if not rows:
        return 0
    vectors = embed_documents([r.get("content") or "" for r in rows])
    for row, vec in zip(rows, vectors):
        supabase.table("skincare_knowledge").update({"embedding": vec}).eq(
            "id", row["id"]
        ).execute()
    return len(rows)


if __name__ == "__main__":
    sb = _client()
    n_products = backfill_products(sb)
    n_knowledge = backfill_knowledge(sb)
    print(f"Embedded {n_products} product(s) and {n_knowledge} knowledge chunk(s).")
