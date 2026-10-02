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

import logging
from dataclasses import dataclass, field
from typing import Any, List, Optional

from .embeddings import embed_query

logger = logging.getLogger(__name__)


# Which seeded knowledge topics are actually valid for each current class.
#
# The knowledge base (migration 005) was written for the OLD six conditions.
# Cosine similarity cannot tell dermatology prose apart -- it all scores alike
# -- so querying "melasma" happily returned rosacea text, and "seborrhea"
# returned seborrheic KERATOSES, a benign tumour. Eight of twelve classes
# retrieved the wrong condition, and the LLM would then ground its advice in
# it. A similarity threshold did not help: the wrong chunks scored as high as
# the right ones.
#
# So the condition column gates the result instead of the distance score.
# Classes with no matching topic get 'general' only (barrier science,
# Fitzpatrick phototypes), which holds for any skin condition. Retrieving
# nothing specific is the correct outcome there -- the LLM then falls back on
# its own knowledge, which is what it did before RAG existed.
#
# Remove an entry from this map once real knowledge for that class is seeded.
_ALLOWED_TOPICS: dict[str, set[str]] = {
    "hormonal_acne":              {"acne", "general"},
    "eczema_flare":               {"eczema", "general"},
    "xerosis":                    {"eczema", "general"},   # barrier/TEWL applies
    "fungal_infection":           {"tinea", "general"},
    # Nothing seeded maps to these. 'general' only, deliberately.
    "melasma":                    {"general"},
    "seborrhea":                  {"general"},             # NOT seborrheic_keratoses
    "hirsutism":                  {"general"},
    "acanthosis_nigricans":       {"general"},
    "hormonal_hyperpigmentation": {"general"},
    "sunburn":                    {"general"},
    "miliaria":                   {"general"},
    "chapped_lips":               {"general"},
}


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
        # Back down to 0.3 now that _ALLOWED_TOPICS gates on the condition
        # column. The threshold was never the right tool: all dermatology prose
        # scores alike, so a melasma query cleared 0.45 on psoriasis text just
        # as easily as the right chunk would. Raising it only starved the
        # classes that DO have matching knowledge. The gate decides relevance;
        # the threshold is back to just dropping genuine noise.
        knowledge_threshold: float = 0.30,
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

        # Retrieval is best-effort: if embeddings or the pgvector RPCs are
        # unavailable (e.g. the vector migration/backfill hasn't run), degrade
        # to empty context so chat/analysis still answer from general knowledge.
        try:
            embedding = embed_query(query)
        except Exception as e:  # noqa: BLE001
            logger.warning("Embedding failed; returning empty RAG context: %s", e)
            return RetrievedContext(query=query, products=[], knowledge=[])

        products = self._match_products(embedding)

        knowledge: List[KnowledgeContext] = []
        if with_knowledge:
            # Over-fetch, then gate on the condition column, then trim. The gate
            # is what decides relevance here -- similarity cannot, because all
            # dermatology prose scores alike. Fetching only knowledge_count
            # first would mean the nearest chunks are usually off-topic ones
            # that the gate then drops, leaving nothing even though valid
            # general chunks were sitting just below the cut.
            allowed = _ALLOWED_TOPICS.get(condition.strip().lower())
            fetched = self._match_knowledge(
                embedding,
                # An unknown class is not gated, so it needs no headroom.
                self._knowledge_count * 4 if allowed else self._knowledge_count,
            )
            if allowed:
                fetched = [k for k in fetched if (k.condition or "general") in allowed]
            knowledge = fetched[: self._knowledge_count]

        return RetrievedContext(query=query, products=products, knowledge=knowledge)

    # -- internal RPC calls ------------------------------------------------

    def _match_products(self, embedding: List[float]) -> List[ProductContext]:
        try:
            resp = self._supabase.rpc(
                "match_products",
                {
                    "query_embedding": embedding,
                    "match_threshold": self._product_threshold,
                    "match_count": self._product_count,
                },
            ).execute()
        except Exception as e:  # noqa: BLE001 — RPC/vector store may be absent
            logger.warning("match_products RPC unavailable; no products: %s", e)
            return []
        return [ProductContext.from_row(r) for r in (resp.data or [])]

    def _match_knowledge(
        self, embedding: List[float], count: Optional[int] = None
    ) -> List[KnowledgeContext]:
        try:
            resp = self._supabase.rpc(
                "match_knowledge",
                {
                    "query_embedding": embedding,
                    "match_threshold": self._knowledge_threshold,
                    "match_count": count or self._knowledge_count,
                },
            ).execute()
        except Exception as e:  # noqa: BLE001 — RPC/vector store may be absent
            logger.warning("match_knowledge RPC unavailable; no knowledge: %s", e)
            return []
        return [KnowledgeContext.from_row(r) for r in (resp.data or [])]
