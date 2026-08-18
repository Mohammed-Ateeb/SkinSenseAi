"""SkinSense AI — pgvector RAG retrieval package.

Public API:
    from app.rag.retriever import RagRetriever, RetrievedContext, ProductContext
    from app.rag.embeddings import embed_query, embed_documents, EMBED_DIM
"""

from .embeddings import EMBED_DIM, EMBED_MODEL_NAME, embed_documents, embed_query
from .retriever import (
    KnowledgeContext,
    ProductContext,
    RagRetriever,
    RetrievedContext,
)

__all__ = [
    "RagRetriever",
    "RetrievedContext",
    "ProductContext",
    "KnowledgeContext",
    "embed_query",
    "embed_documents",
    "EMBED_DIM",
    "EMBED_MODEL_NAME",
]
