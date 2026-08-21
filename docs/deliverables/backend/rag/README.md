# SkinSense AI — pgvector RAG retriever

Replaces the simplified direct-SQL product lookup (`get_matching_products`
using `.contains("target_conditions", ...)`) with a real semantic
retrieval pipeline over Supabase **pgvector**, run **before** prompt
injection.

```
Query (CNN primary_condition)
   │  embed_query()  ── FastEmbed BAAI/bge-small-en-v1.5 → vector(384)
   ▼
Supabase RPC  match_products() + match_knowledge()   (HNSW cosine ANN)
   ▼
RetrievedContext { products[], knowledge[] }
   │  products[]  → approved-product WHITELIST (prompt + T3 guardrail)
   │  knowledge[] → clinical grounding for the system prompt
   ▼
build_system_prompt(...) → Groq LLM
```

## Files

| File | Purpose |
|------|---------|
| `embeddings.py` | FastEmbed wrapper (lazy singleton), `embed_query` / `embed_documents`. 384-dim. |
| `retriever.py` | `RagRetriever` — embeds query, calls the SQL match functions via Supabase RPC, returns typed `RetrievedContext`. |
| `backfill.py` | One-shot `python -m rag.backfill` to embed existing product/knowledge rows. |
| `../../migrations/002_pgvector_rag.sql` | Extension, embedding columns, HNSW indexes, `match_products` / `match_knowledge`. |

## Install

```bash
pip install -r requirements.txt
```

FastEmbed is torch-free (ONNX runtime); weights (~90 MB) download once on
first `embed_query` call and cache locally.

## Deploy steps

1. Apply the migration in the Supabase SQL editor:
   run `migrations/002_pgvector_rag.sql` **after** the base schema.
2. Backfill embeddings for existing rows:
   ```bash
   export SUPABASE_URL=...            # your project URL
   export SUPABASE_SERVICE_ROLE_KEY=... # service-role key (bypasses RLS for UPDATE)
   python -m rag.backfill
   ```
3. Keep new rows embedded: call `embed_documents(...)` and set the
   `embedding` column when you INSERT products/knowledge (or re-run the
   backfill — it only touches rows where `embedding IS NULL`).

## Mapping into `multimodel-skincare/app/`

Drop this package at `app/rag/` (or wherever the FastAPI backend lives).
In the analyze router, replace the old lookup:

```python
# before
products = get_matching_products(payload.primary_condition)
system_prompt = build_system_prompt(payload.primary_condition, payload.confidence, products)

# after
from rag.retriever import RagRetriever

retriever = RagRetriever(supabase)  # reuse the existing supabase.Client
ctx = retriever.retrieve(condition=payload.primary_condition)

products = [                         # same shape build_system_prompt expects
    {"id": p.product_id, "name": p.name, "active_ingredients": p.active_ingredients}
    for p in ctx.products
]
system_prompt = build_system_prompt(
    payload.primary_condition, payload.confidence, products,
    knowledge=[k.content for k in ctx.knowledge],   # optional grounding
)
```

`ctx.product_whitelist` (list of approved names) and `ctx.product_ids` are
the exact allow-list the **T3 post-generation guardrail** validates
generated text against — nothing outside `match_products()`'s `is_active`
results can be recommended.

## Config knobs (`RagRetriever(...)`)

- `product_threshold` / `product_count` — min cosine similarity and max
  products (default `0.3` / `5`).
- `knowledge_threshold` / `knowledge_count` — same for clinical chunks.
- Pass `with_knowledge=False` to `retrieve()` to skip knowledge retrieval.

## Model / dimension contract

`EMBED_DIM = 384` (`BAAI/bge-small-en-v1.5`) **must** equal `vector(384)`
in the migration. Changing the model means updating both the SQL columns
and re-running the backfill.
