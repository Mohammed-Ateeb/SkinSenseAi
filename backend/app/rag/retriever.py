"""Supabase pgvector retriever for the SkinSense AI RAG pipeline.

Runs BEFORE prompt injection: embeds the query, calls the `match_products`
and `match_knowledge` SQL functions (migration 002) via Supabase RPC, and
returns typed, ranked context. The returned `ProductContext` list is the
approved-product WHITELIST — only these product ids/names may enter the
LLM prompt, and the post-generation guardrail (T3) validates hallucinated
names against exactly this set.

Usage (inside FastAPI, replacing get_matching_products):

    from app.rag.retriever import RagRetriever

    retriever = RagRetriever(supabase)  # existing supabase client
    ctx = retriever.retrieve(condition="hormonal_acne")
    products = ctx.products            # -> whitelist for the prompt + guardrail
    knowledge = ctx.knowledge          # -> clinical grounding for the prompt
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List, Optional

from .embeddings import embed_query


@dataclass(frozen=True)
class ProductContext:
    """A single approved product returned by match_products()."""

    product_id: str
    name: str
    target_conditions: List[str]
    active_ingredients: List[str]
    excludes_ingredients: List[str]
    priority_score: int
    similarity: float

    @classmethod
    def from_row(cls, row: dict) -> "ProductContext":
        return cls(
            product_id=str(row["id"]),
            name=row["name"],
            target_conditions=row.get("target_conditions") or [],
            active_ingredients=row.get("active_ingredients") or [],
            excludes_ingredients=row.get("excludes_ingredients") or [],
            priority_score=int(row.get("priority_score") or 0),
            similarity=float(row.get("similarity") or 0.0),
        )


@dataclass(frozen=True)
class KnowledgeContext:
    """A single clinical knowledge chunk returned by match_knowledge()."""

    id: str
    content: str
    source: Optional[str]
    condition: Optional[str]
    similarity: float

    @classmethod
    def from_row(cls, row: dict) -> "KnowledgeContext":
        return cls(
            id=str(row["id"]),
            content=row["content"],
            source=row.get("source"),
            condition=row.get("condition"),
            similarity=float(row.get("similarity") or 0.0),
        )


@dataclass(frozen=True)
class RetrievedContext:
    """Everything retrieval produced for one analysis, pre-prompt-injection."""

    query: str
    products: List[ProductContext] = field(default_factory=list)
    knowledge: List[KnowledgeContext] = field(default_factory=list)

    @property
    def product_whitelist(self) -> List[str]:
        """Approved product names — the exact allow-list the guardrail enforces."""
        return [p.name for p in self.products]

    @property
    def product_ids(self) -> List[str]:
        return [p.product_id for p in self.products]


class RagRetriever:
    """Embeds queries and calls the pgvector match_* RPCs via Supabase.

    `supabase` is the already-configured `supabase.Client` the backend uses
    elsewhere (created with the service-role or anon key).
    """

    def __init__(
        self,
        supabase: Any,
        product_threshold: float = 0.3,
        product_count: int = 5,
        knowledge_threshold: float = 0.3,
        knowledge_count: int = 4,
    ) -> None:
        self._supabase = supabase
        self._product_threshold = product_threshold
        self._product_count = product_count
        self._knowledge_threshold = knowledge_threshold
        self._knowledge_count = knowledge_count

    def retrieve(
        self,
        condition: str,
        extra_query: str = "",
        *,
        with_knowledge: bool = True,
    ) -> RetrievedContext:
        """Retrieve ranked products (+ optional clinical knowledge) for a condition.

        `condition` is the CNN's primary_condition (e.g. "hormonal_acne").
        `extra_query` can append user context to sharpen the semantic match.
        """
        readable = condition.replace("_", " ").strip()
        query = f"skincare products and treatment for {readable}"
        if extra_query.strip():
            query = f"{query}. {extra_query.strip()}"

        embedding = embed_query(query)

        products = self._match_products(embedding)
        knowledge = self._match_knowledge(embedding) if with_knowledge else []

        return RetrievedContext(query=query, products=products, knowledge=knowledge)

    # -- internal RPC calls ------------------------------------------------

    def _match_products(self, embedding: List[float]) -> List[ProductContext]:
        resp = self._supabase.rpc(
            "match_products",
            {
                "query_embedding": embedding,
                "match_threshold": self._product_threshold,
                "match_count": self._product_count,
            },
        ).execute()
        return [ProductContext.from_row(r) for r in (resp.data or [])]

    def _match_knowledge(self, embedding: List[float]) -> List[KnowledgeContext]:
        resp = self._supabase.rpc(
            "match_knowledge",
            {
                "query_embedding": embedding,
                "match_threshold": self._knowledge_threshold,
                "match_count": self._knowledge_count,
            },
        ).execute()
        return [KnowledgeContext.from_row(r) for r in (resp.data or [])]
