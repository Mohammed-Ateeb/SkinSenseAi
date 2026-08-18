-- =====================================================================
-- SkinSense AI — Migration 002: pgvector RAG pipeline
-- =====================================================================
-- Adds semantic retrieval over the existing `public.products` catalogue
-- (created in the base schema: id, name, target_conditions[],
--  active_ingredients[], excludes_ingredients[], is_active, priority_score)
-- plus a new `public.skincare_knowledge` table of clinical chunks.
--
-- Embedding model: FastEmbed `BAAI/bge-small-en-v1.5` -> 384 dims.
-- If you switch models, update EVERY `vector(384)` below to match.
--
-- Run this in the Supabase SQL editor AFTER the base schema (001).
-- Idempotent where practical (IF NOT EXISTS / OR REPLACE).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Extension
-- ---------------------------------------------------------------------
create extension if not exists vector;

-- ---------------------------------------------------------------------
-- 2. Embedding columns
-- ---------------------------------------------------------------------
-- Products: embed a composite of name + ingredients + target conditions.
alter table public.products
  add column if not exists embedding vector(384);

-- Clinical skincare knowledge (condition explanations, ingredient facts,
-- routine guidance). NOT user-owned — public reference catalogue.
create table if not exists public.skincare_knowledge (
  id          uuid primary key default gen_random_uuid(),
  content     text not null,
  source      text,                 -- citation / provenance
  condition   text,                 -- optional condition tag e.g. 'hormonal_acne'
  embedding   vector(384),
  created_at  timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 3. HNSW indexes (cosine distance) for approximate nearest neighbour
-- ---------------------------------------------------------------------
-- HNSW gives fast recall on the small-to-medium catalogues this app uses.
-- vector_cosine_ops pairs with the `<=>` cosine-distance operator below.
create index if not exists products_embedding_hnsw
  on public.products
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists skincare_knowledge_embedding_hnsw
  on public.skincare_knowledge
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ---------------------------------------------------------------------
-- 4. RLS for the new knowledge table
-- ---------------------------------------------------------------------
alter table public.skincare_knowledge enable row level security;

drop policy if exists "Anyone can view skincare knowledge" on public.skincare_knowledge;
create policy "Anyone can view skincare knowledge"
  on public.skincare_knowledge
  for select using (true);

-- ---------------------------------------------------------------------
-- 5. match_products() — ranked product retrieval
-- ---------------------------------------------------------------------
-- Returns approved (is_active) products ordered by cosine similarity to
-- the query embedding, above `match_threshold`, capped at `match_count`.
-- This is the WHITELIST source: only rows returned here may enter the
-- LLM prompt, so is_active filtering happens inside the function.
--
-- similarity = 1 - cosine_distance, so higher = closer.
create or replace function public.match_products(
  query_embedding vector(384),
  match_threshold float default 0.3,
  match_count     int   default 5
)
returns table (
  id                  uuid,
  name                text,
  target_conditions   text[],
  active_ingredients  text[],
  excludes_ingredients text[],
  priority_score      int,
  similarity          float
)
language sql
stable
as $$
  select
    p.id,
    p.name,
    p.target_conditions,
    p.active_ingredients,
    p.excludes_ingredients,
    p.priority_score,
    1 - (p.embedding <=> query_embedding) as similarity
  from public.products p
  where p.is_active = true
    and p.embedding is not null
    and 1 - (p.embedding <=> query_embedding) >= match_threshold
  order by
    p.embedding <=> query_embedding asc,  -- closest first
    p.priority_score desc                 -- tie-break on merchandising priority
  limit match_count;
$$;

-- ---------------------------------------------------------------------
-- 6. match_knowledge() — ranked clinical-context retrieval
-- ---------------------------------------------------------------------
create or replace function public.match_knowledge(
  query_embedding vector(384),
  match_threshold float default 0.3,
  match_count     int   default 5
)
returns table (
  id          uuid,
  content     text,
  source      text,
  condition   text,
  similarity  float
)
language sql
stable
as $$
  select
    k.id,
    k.content,
    k.source,
    k.condition,
    1 - (k.embedding <=> query_embedding) as similarity
  from public.skincare_knowledge k
  where k.embedding is not null
    and 1 - (k.embedding <=> query_embedding) >= match_threshold
  order by k.embedding <=> query_embedding asc
  limit match_count;
$$;

-- ---------------------------------------------------------------------
-- 7. Grants — allow the Supabase API roles to call the RPCs
-- ---------------------------------------------------------------------
grant execute on function public.match_products(vector, float, int) to anon, authenticated, service_role;
grant execute on function public.match_knowledge(vector, float, int) to anon, authenticated, service_role;

-- =====================================================================
-- Backfill note:
-- After deploy, populate embeddings once from the FastEmbed retriever
-- (see backend/rag/README.md -> "Backfilling embeddings").
-- Rows with a NULL embedding are silently skipped by both functions,
-- so retrieval keeps working while a backfill is in progress.
-- =====================================================================
