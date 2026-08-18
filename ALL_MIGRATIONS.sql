-- =============================================================
-- SkinSense AI — ALL MIGRATIONS (001 → 005)
-- Paste this entire block into the Supabase SQL Editor and Run.
-- =============================================================

-- ── 001: Initial Schema ──────────────────────────────────────
-- =====================================================================
-- SkinSense AI â€” Migration 001: Initial Schema
-- =====================================================================
-- Sets up the core tables: users, uploaded_images, analysis_results,
-- products.  Row Level Security is enabled on all tables.
-- A trigger auto-creates a public.users profile on every new signup.
--
-- Run this FIRST in the Supabase SQL editor before any other migration.
-- Idempotent: safe to re-run (IF NOT EXISTS / OR REPLACE throughout).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------
-- 2. Core tables
-- ---------------------------------------------------------------------

-- Users table (mirrors auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id           UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT,
  consent_given BOOLEAN    DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Uploaded images
CREATE TABLE IF NOT EXISTS public.uploaded_images (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  storage_path TEXT        NOT NULL,
  uploaded_at  TIMESTAMPTZ DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

-- Analysis results
CREATE TABLE IF NOT EXISTS public.analysis_results (
  id                      UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  image_id                UUID        REFERENCES public.uploaded_images(id) ON DELETE SET NULL,
  user_id                 UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  model_version           TEXT        NOT NULL DEFAULT 'efficientnet-b0-v1',
  predictions             JSONB       NOT NULL DEFAULT '{}',
  primary_condition       TEXT,
  confidence_score        NUMERIC(5,4),
  llm_explanation         TEXT,
  recommended_product_ids UUID[],
  chat_history            JSONB       DEFAULT '[]',
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Products catalogue
CREATE TABLE IF NOT EXISTS public.products (
  id                   UUID     PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                 TEXT     NOT NULL,
  brand                TEXT,
  category             TEXT,
  target_conditions    TEXT[]   DEFAULT '{}',
  active_ingredients   TEXT[]   DEFAULT '{}',
  excludes_ingredients TEXT[]   DEFAULT '{}',
  is_active            BOOLEAN  DEFAULT TRUE,
  priority_score       INTEGER  DEFAULT 5,
  description          TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------
ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploaded_images  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products         ENABLE ROW LEVEL SECURITY;

-- users policies
CREATE POLICY "Users can view own profile"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Service role full access users"
  ON public.users FOR ALL TO service_role
  USING (true);

-- uploaded_images policies
CREATE POLICY "Users own their images"
  ON public.uploaded_images FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access images"
  ON public.uploaded_images FOR ALL TO service_role
  USING (true);

-- analysis_results policies
CREATE POLICY "Users own their analysis"
  ON public.analysis_results FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access analysis"
  ON public.analysis_results FOR ALL TO service_role
  USING (true);

-- products policies
CREATE POLICY "Products readable by authenticated"
  ON public.products FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role full access products"
  ON public.products FOR ALL TO service_role
  USING (true);

-- ---------------------------------------------------------------------
-- 4. Auto-create user profile on signup
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, consent_given)
  VALUES (NEW.id, NEW.email, FALSE)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate so re-runs are idempotent
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------
-- 5. Storage bucket â€” run via Supabase Dashboard or service_role client
-- ---------------------------------------------------------------------
-- The SQL editor anon/postgres roles cannot create storage buckets.
-- Run these from Supabase Dashboard â†’ Storage, or via the service_role
-- client in a one-off script:
--
-- INSERT INTO storage.buckets (id, name, public)
--   VALUES ('skin-images', 'skin-images', false)
--   ON CONFLICT (id) DO NOTHING;
--
-- CREATE POLICY "Users upload own images"
--   ON storage.objects FOR INSERT TO authenticated
--   WITH CHECK (
--     bucket_id = 'skin-images'
--     AND (storage.foldername(name))[1] = auth.uid()::text
--   );
--
-- CREATE POLICY "Users read own images"
--   ON storage.objects FOR SELECT TO authenticated
--   USING (
--     bucket_id = 'skin-images'
--     AND (storage.foldername(name))[1] = auth.uid()::text
--   );
--
-- CREATE POLICY "Service role full storage access"
--   ON storage.objects FOR ALL TO service_role
--   USING (bucket_id = 'skin-images');
-- =====================================================================


-- ── 002: pgvector RAG ────────────────────────────────────────
-- =====================================================================
-- SkinSense AI â€” Migration 002: pgvector RAG pipeline
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
-- routine guidance). NOT user-owned â€” public reference catalogue.
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
-- 5. match_products() â€” ranked product retrieval
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
-- 6. match_knowledge() â€” ranked clinical-context retrieval
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
-- 7. Grants â€” allow the Supabase API roles to call the RPCs
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


-- ── 003: Digital Twin ────────────────────────────────────────
-- Migration 003: Digital Skin Twin
-- Tables:  skin_twins (one current-state row per user)
--          skin_twin_snapshots (chronological history, append-only)
-- RLS:     owner-only, keyed to auth.uid() â€” matches existing JWKS auth pattern
-- Run after 001_initial_schema.sql and 002_*.sql

-- â”€â”€ skin_twins â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Stores the current aggregated twin state.  Upserted on every scan / chat
-- feedback event.  One row per user, enforced by the UNIQUE constraint.

create table public.skin_twins (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users(id) on delete cascade,

  -- Skin-tone fingerprint (Fitzpatrick 1â€“6); NULL until first measurement.
  fitzpatrick_skin_tone smallint    check (fitzpatrick_skin_tone between 1 and 6),

  -- Aggregated indices â€” exponential moving averages, clamped 0â€“1.
  hydration_index       numeric(5,4) not null default 0.7000
                                    check (hydration_index  between 0 and 1),
  barrier_integrity     numeric(5,4) not null default 0.8000
                                    check (barrier_integrity between 0 and 1),

  -- Active flare-ups: {condition_name: severity_float (0â€“1)}.
  -- Only conditions whose EMA confidence exceeds the detection threshold
  -- (0.25) are kept here.  Empty dict == no active flares.
  active_flare_ups      jsonb        not null default '{}',

  -- Highest-severity condition at last update.
  dominant_condition    text,

  -- Running count of scan events that shaped this twin.
  scan_count            int          not null default 0,
  last_scan_at          timestamptz,
  last_updated_at       timestamptz  not null default now(),
  created_at            timestamptz  not null default now(),

  unique (user_id)
);

comment on table public.skin_twins is
  'Current digital skin twin state â€” one row per user, updated by the twin engine after every scan or chat feedback loop.';

-- â”€â”€ skin_twin_snapshots â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Append-only chronological record of every twin state change.
-- Each row captures the full metric set at the time of the event plus
-- deltas vs. the previous snapshot for trend visualisation.

create table public.skin_twin_snapshots (
  id                    uuid        primary key default gen_random_uuid(),
  twin_id               uuid        not null references public.skin_twins(id) on delete cascade,
  user_id               uuid        not null references auth.users(id) on delete cascade,

  -- Source analysis result (null for chat-feedback-only events).
  analysis_result_id    uuid        references public.analysis_results(id) on delete set null,

  fitzpatrick_skin_tone smallint    check (fitzpatrick_skin_tone between 1 and 6),
  hydration_index       numeric(5,4) not null check (hydration_index  between 0 and 1),
  barrier_integrity     numeric(5,4) not null check (barrier_integrity between 0 and 1),
  active_flare_ups      jsonb        not null default '{}',
  dominant_condition    text,

  -- Signed deltas vs. the immediately preceding snapshot for this twin.
  -- Shape: {hydration_index: float, barrier_integrity: float,
  --          flare_changes: {condition: delta_float}}
  deltas                jsonb        not null default '{}',

  -- What triggered this snapshot.
  trigger               text         not null check (trigger in ('scan', 'chat_feedback')),
  chat_feedback_summary text,        -- raw user sentiment / symptom text if trigger='chat_feedback'

  created_at            timestamptz  not null default now()
);

comment on table public.skin_twin_snapshots is
  'Chronological twin history â€” one row per scan or chat-feedback event.  Never updated, only inserted.';

-- Indexes for efficient history queries (dashboard + history pages).
create index skin_twin_snapshots_user_time
  on public.skin_twin_snapshots (user_id, created_at desc);

create index skin_twin_snapshots_twin_time
  on public.skin_twin_snapshots (twin_id, created_at desc);

-- â”€â”€ Row Level Security â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

alter table public.skin_twins          enable row level security;
alter table public.skin_twin_snapshots enable row level security;

-- skin_twins: owner-only read + write
create policy "owner: select skin_twins" on public.skin_twins
  for select using (auth.uid() = user_id);

create policy "owner: insert skin_twins" on public.skin_twins
  for insert with check (auth.uid() = user_id);

create policy "owner: update skin_twins" on public.skin_twins
  for update using (auth.uid() = user_id);

-- skin_twin_snapshots: owner-only read + append (no update/delete â€” intentionally append-only)
create policy "owner: select skin_twin_snapshots" on public.skin_twin_snapshots
  for select using (auth.uid() = user_id);

create policy "owner: insert skin_twin_snapshots" on public.skin_twin_snapshots
  for insert with check (auth.uid() = user_id);

-- â”€â”€ Grants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Matches the pattern from migration 001 (service_role bypass for backend writes).

grant select, insert, update on public.skin_twins          to service_role;
grant select, insert          on public.skin_twin_snapshots to service_role;
grant usage on schema public  to service_role;


-- ── 004: Seed Products ───────────────────────────────────────
-- =====================================================================
-- SkinSense AI â€” Migration 004: Seed Products Catalogue
-- =====================================================================
-- Inserts 15 OTC skincare products covering all 6 target conditions:
--   acne, eczema, psoriasis, rosacea, seborrheic_keratoses, tinea
--
-- Uses generic product-category names (not proprietary brand names).
-- embedding is set to NULL â€” backfill via `python -m app.rag.backfill`
-- after running migration 002 (pgvector).
--
-- Idempotent: ON CONFLICT (name) DO NOTHING requires a unique index.
-- =====================================================================

-- Unique name constraint to make ON CONFLICT work cleanly.
-- The index is harmless if already present.
CREATE UNIQUE INDEX IF NOT EXISTS products_name_unique ON public.products (name);

INSERT INTO public.products
  (id, name, category, target_conditions, active_ingredients,
   excludes_ingredients, is_active, priority_score, description, embedding)
VALUES

-- 1. Niacinamide 10% + Zinc 1% Serum
(
  'a1b2c3d4-0001-4e5f-a6b7-c8d9e0f10001',
  'Niacinamide 10% + Zinc 1% Serum',
  'serum',
  ARRAY['acne','rosacea'],
  ARRAY['niacinamide 10%','zinc pca 1%'],
  ARRAY['fragrance','alcohol','parabens'],
  TRUE, 9,
  'Combines niacinamide with zinc PCA to regulate sebum production, reduce visible pores, and calm redness. '
  || 'Best used morning and evening on cleansed skin; suitable for oily, acne-prone, and rosacea-prone skin types.',
  NULL
),

-- 2. Salicylic Acid 2% Cleanser
(
  'a1b2c3d4-0002-4e5f-a6b7-c8d9e0f10002',
  'Salicylic Acid 2% Cleanser',
  'cleanser',
  ARRAY['acne','seborrheic_keratoses'],
  ARRAY['salicylic acid 2%'],
  ARRAY['sulfates','fragrance'],
  TRUE, 8,
  'A beta-hydroxy acid cleanser that exfoliates inside the pore, dislodging keratin plugs and reducing comedones. '
  || 'Use once daily, increasing to twice daily as tolerated; avoid around eyes.',
  NULL
),

-- 3. Colloidal Oatmeal Moisturizer
(
  'a1b2c3d4-0003-4e5f-a6b7-c8d9e0f10003',
  'Colloidal Oatmeal Moisturizer',
  'moisturizer',
  ARRAY['eczema','psoriasis','rosacea'],
  ARRAY['colloidal oatmeal 1%','glycerin','shea butter'],
  ARRAY['fragrance','dyes','alcohol','parabens'],
  TRUE, 9,
  'FDA-approved colloidal oatmeal forms a protective film that soothes itch, reduces inflammation, and restores '
  || 'skin-barrier function. Ideal for flare management in eczema, psoriasis, and sensitive rosacea-prone skin.',
  NULL
),

-- 4. Ceramide Barrier Repair Cream
(
  'a1b2c3d4-0004-4e5f-a6b7-c8d9e0f10004',
  'Ceramide Barrier Repair Cream',
  'moisturizer',
  ARRAY['eczema','psoriasis'],
  ARRAY['ceramide np','ceramide ap','ceramide eop','cholesterol','fatty acids'],
  ARRAY['fragrance','alcohol'],
  TRUE, 10,
  'Replenishes the physiologic ratio of ceramides, cholesterol, and fatty acids (3:1:1) to restore transepidermal '
  || 'water loss control. Clinically indicated as a daily maintenance moisturizer in atopic dermatitis and psoriasis.',
  NULL
),

-- 5. Coal Tar 1% Shampoo/Body Wash
(
  'a1b2c3d4-0005-4e5f-a6b7-c8d9e0f10005',
  'Coal Tar 1% Shampoo/Body Wash',
  'wash',
  ARRAY['psoriasis','seborrheic_keratoses'],
  ARRAY['coal tar 1%'],
  ARRAY['parabens'],
  TRUE, 7,
  'Coal tar normalises keratinocyte proliferation and has anti-inflammatory and anti-pruritic properties useful '
  || 'in scalp psoriasis and seborrhoeic dermatitis. Apply to affected areas, leave 5 minutes, then rinse thoroughly.',
  NULL
),

-- 6. Azelaic Acid 10% Gel
(
  'a1b2c3d4-0006-4e5f-a6b7-c8d9e0f10006',
  'Azelaic Acid 10% Gel',
  'treatment',
  ARRAY['acne','rosacea'],
  ARRAY['azelaic acid 10%'],
  ARRAY['fragrance','alcohol'],
  TRUE, 8,
  'Azelaic acid inhibits P. acnes proliferation, reduces post-inflammatory hyperpigmentation, and has direct '
  || 'anti-inflammatory action on erythema and papulopustular lesions in rosacea. Apply a thin layer twice daily.',
  NULL
),

-- 7. Hyaluronic Acid Hydrating Serum
(
  'a1b2c3d4-0007-4e5f-a6b7-c8d9e0f10007',
  'Hyaluronic Acid Hydrating Serum',
  'serum',
  ARRAY['eczema','rosacea'],
  ARRAY['sodium hyaluronate','hyaluronic acid','panthenol'],
  ARRAY['fragrance','alcohol','essential oils'],
  TRUE, 7,
  'Multi-weight hyaluronic acid binds up to 1000Ã— its weight in water, delivering immediate and sustained '
  || 'hydration without occluding pores. Suitable as a first-step treatment for dehydrated, sensitive, or '
  || 'rosacea-prone skin; apply to damp skin and seal with a moisturizer.',
  NULL
),

-- 8. Benzoyl Peroxide 2.5% Gel
(
  'a1b2c3d4-0008-4e5f-a6b7-c8d9e0f10008',
  'Benzoyl Peroxide 2.5% Gel',
  'treatment',
  ARRAY['acne'],
  ARRAY['benzoyl peroxide 2.5%'],
  ARRAY['fragrance'],
  TRUE, 9,
  'Benzoyl peroxide releases free-radical oxygen that kills P. acnes without inducing antibiotic resistance. '
  || 'The 2.5% concentration is as effective as 5â€“10% with significantly less irritation and dryness; '
  || 'apply once daily to affected areas and avoid contact with fabric.',
  NULL
),

-- 9. Zinc Pyrithione 1% Wash
(
  'a1b2c3d4-0009-4e5f-a6b7-c8d9e0f10009',
  'Zinc Pyrithione 1% Wash',
  'wash',
  ARRAY['seborrheic_keratoses','tinea'],
  ARRAY['zinc pyrithione 1%'],
  ARRAY['sulfates','fragrance'],
  TRUE, 8,
  'Zinc pyrithione disrupts the membrane of Malassezia furfur and dermatophytes, reducing fungal colonisation '
  || 'that drives seborrhoeic dermatitis and tinea versicolor. Use as a daily or alternate-day body wash; '
  || 'can also be used as a 5-minute leave-on scalp treatment.',
  NULL
),

-- 10. Clotrimazole 1% Antifungal Cream
(
  'a1b2c3d4-0010-4e5f-a6b7-c8d9e0f10010',
  'Clotrimazole 1% Antifungal Cream',
  'treatment',
  ARRAY['tinea'],
  ARRAY['clotrimazole 1%'],
  ARRAY['fragrance'],
  TRUE, 9,
  'An imidazole antifungal that inhibits ergosterol synthesis, disrupting the fungal cell membrane of '
  || 'dermatophytes responsible for tinea pedis, tinea corporis, and tinea cruris. Apply twice daily for '
  || '2â€“4 weeks; continue for 1 week after resolution to prevent relapse.',
  NULL
),

-- 11. Antifungal Body Wash (Ketoconazole-free / selenium-free alternative)
(
  'a1b2c3d4-0011-4e5f-a6b7-c8d9e0f10011',
  'Terbinafine-Free Antifungal Body Wash',
  'wash',
  ARRAY['tinea'],
  ARRAY['undecylenic acid','tea tree oil 5%'],
  ARRAY['sulfates','parabens','fragrance'],
  TRUE, 6,
  'Natural antifungal body wash combining undecylenic acid and tea tree oil to reduce surface dermatophyte '
  || 'load on the trunk and limbs. Useful as an adjunct to prescription antifungal therapy or for maintenance '
  || 'in recurrent tinea versicolor; lather and leave on for 2â€“3 minutes before rinsing.',
  NULL
),

-- 12. SPF 50 Mineral Sunscreen
(
  'a1b2c3d4-0012-4e5f-a6b7-c8d9e0f10012',
  'SPF 50 Mineral Sunscreen (Broad-Spectrum)',
  'sunscreen',
  ARRAY['rosacea'],
  ARRAY['zinc oxide 15%','titanium dioxide 7%'],
  ARRAY['chemical uv filters','fragrance','alcohol','oxybenzone','avobenzone'],
  TRUE, 10,
  'Physical blockers zinc oxide and titanium dioxide reflect UV and visible light without chemical reactions, '
  || 'making this the preferred sunscreen for rosacea and Fitzpatrick IVâ€“VI phototypes where heat triggers '
  || 'flushing and chemical filters may cause irritation. Apply 15 minutes before sun exposure and reapply '
  || 'every 2 hours.',
  NULL
),

-- 13. Mandelic Acid 5% Toner
(
  'a1b2c3d4-0013-4e5f-a6b7-c8d9e0f10013',
  'Mandelic Acid 5% Toner',
  'toner',
  ARRAY['acne','seborrheic_keratoses'],
  ARRAY['mandelic acid 5%','witch hazel'],
  ARRAY['fragrance','alcohol','sulfates'],
  TRUE, 6,
  'Mandelic acid is a large-molecule alpha-hydroxy acid that penetrates slowly, making it better tolerated '
  || 'than glycolic acid on sensitive or darker skin tones. It exfoliates the stratum corneum, unblocks pores, '
  || 'and mildly inhibits Malassezia, making it useful in acne and seborrhoeic conditions.',
  NULL
),

-- 14. Centella Asiatica Soothing Cream
(
  'a1b2c3d4-0014-4e5f-a6b7-c8d9e0f10014',
  'Centella Asiatica Soothing Cream',
  'moisturizer',
  ARRAY['eczema','rosacea'],
  ARRAY['centella asiatica extract','madecassoside','asiaticoside','glycerin'],
  ARRAY['fragrance','essential oils','alcohol','dyes'],
  TRUE, 8,
  'Madecassoside and asiaticoside from Centella asiatica suppress NF-ÎºB-driven inflammation and promote '
  || 'collagen synthesis, accelerating barrier recovery after flares. Particularly effective as a calming '
  || 'post-procedure or post-flare cream for rosacea and atopic eczema.',
  NULL
),

-- 15. Panthenol 5% Barrier Lotion
(
  'a1b2c3d4-0015-4e5f-a6b7-c8d9e0f10015',
  'Panthenol 5% Barrier Lotion',
  'moisturizer',
  ARRAY['eczema','psoriasis'],
  ARRAY['panthenol 5%','glycerin','allantoin'],
  ARRAY['fragrance','parabens','mineral oil'],
  TRUE, 7,
  'Panthenol (pro-vitamin B5) is converted to pantothenic acid in the skin, stimulating fibroblast proliferation '
  || 'and supporting epithelialisation. At 5%, it reliably reduces transepidermal water loss and is suitable for '
  || 'daily use in eczema and psoriasis as a lightweight, fast-absorbing maintenance moisturizer.',
  NULL
)

ON CONFLICT (name) DO NOTHING;

-- =====================================================================
-- Backfill embeddings after running migration 002:
--   python -m app.rag.backfill
-- =====================================================================


-- ── 005: Seed Knowledge ──────────────────────────────────────
-- =====================================================================
-- SkinSense AI â€” Migration 005: Seed Clinical Knowledge
-- =====================================================================
-- Inserts 12 clinical knowledge chunks into public.skincare_knowledge
-- (created in migration 002).  Covers all 6 target conditions plus
-- skin barrier science and Fitzpatrick phototypes.
--
-- embedding is set to NULL â€” backfill via `python -m app.rag.backfill`
--
-- Idempotent: ON CONFLICT on the unique index below.
-- =====================================================================

-- Unique content index so re-runs are safe
CREATE UNIQUE INDEX IF NOT EXISTS skincare_knowledge_content_unique
  ON public.skincare_knowledge (md5(content));

INSERT INTO public.skincare_knowledge
  (id, content, source, condition, embedding)
VALUES

-- 1. Acne: pathophysiology
(
  'b2c3d4e5-0001-4f6a-b7c8-d9e0f1a20001',
  'Acne vulgaris is a multifactorial inflammatory disorder of the pilosebaceous unit driven by four '
  || 'key mechanisms: follicular hyperkeratinisation (comedone formation), androgen-stimulated sebum '
  || 'overproduction, colonisation by Cutibacterium acnes (formerly P. acnes), and a subsequent '
  || 'innate immune inflammatory cascade releasing interleukins IL-1Î±, IL-8, and TNF-Î±. '
  || 'Comedones are the primary non-inflammatory lesion; rupture of the follicular wall triggers the '
  || 'inflammatory papule, pustule, nodule, and cyst spectrum. '
  || 'Genetic predisposition, diet (high glycaemic load, dairy), and psychological stress all amplify sebum output.',
  'Clinical Dermatology Guidelines',
  'acne',
  NULL
),

-- 2. Acne: OTC treatment ladder
(
  'b2c3d4e5-0002-4f6a-b7c8-d9e0f1a20002',
  'The OTC acne treatment ladder begins with benzoyl peroxide (BPO) 2.5â€“5%, which kills C. acnes '
  || 'via free-radical oxidation without inducing antibiotic resistance, making it first-line for '
  || 'mild-to-moderate inflammatory acne. Salicylic acid 0.5â€“2% is a comedolytic beta-hydroxy acid '
  || 'that dissolves the lipid plug and is preferred for non-inflammatory comedonal acne. '
  || 'Niacinamide 4â€“10% reduces sebum excretion rate and is anti-inflammatory via PGE2 suppression; '
  || 'azelaic acid 10â€“20% adds keratolytic, antibacterial, and post-inflammatory hyperpigmentation '
  || 'benefits. Persistent moderate-to-severe acne requires clinician referral for topical or oral retinoids.',
  'AAD Acne Clinical Guideline 2024',
  'acne',
  NULL
),

-- 3. Eczema: skin barrier dysfunction
(
  'b2c3d4e5-0003-4f6a-b7c8-d9e0f1a20003',
  'Atopic dermatitis (eczema) is fundamentally a defect in the epidermal barrier, most often caused '
  || 'by loss-of-function mutations in FLG (filaggrin), which reduce natural moisturising factor and '
  || 'disrupt the cornified envelope. This increases transepidermal water loss (TEWL) from a normal '
  || '5â€“10 g/mÂ²/h to upwards of 30â€“70 g/mÂ²/h during flares, leading to chronic xerosis. '
  || 'Barrier failure permits allergen penetration and microbial colonisation â€” notably Staphylococcus '
  || 'aureus in >90% of lesional skin â€” which drives the Th2/Th22-skewed inflammatory response '
  || 'characterised by markedly elevated serum IgE, IL-4, IL-13, and IL-31 (the primary itch mediator).',
  'Skin Barrier Research',
  'eczema',
  NULL
),

-- 4. Eczema: wet wrapping and trigger avoidance
(
  'b2c3d4e5-0004-4f6a-b7c8-d9e0f1a20004',
  'Wet-wrap therapy involves applying a topical emollient or diluted corticosteroid, covering the '
  || 'area with a damp tubular bandage, and then a dry outer layer; this creates an occlusive microenvironment '
  || 'that dramatically reduces TEWL and delivers the active ingredient 10-fold more effectively. '
  || 'Common environmental triggers to avoid include fragrance and perfume (most frequent contact sensitiser), '
  || 'sodium lauryl sulphate (SLS) which disrupts tight junctions at concentrations >0.1%, house dust mite, '
  || 'pet dander, and extremes of temperature. '
  || 'Daily gentle cleansing with a pH-balanced (5.5), soap-free, fragrance-free wash is recommended to '
  || 'preserve the acid mantle without compromising barrier lipid composition.',
  'AAD Atopic Dermatitis Guidelines',
  'eczema',
  NULL
),

-- 5. Psoriasis: pathophysiology
(
  'b2c3d4e5-0005-4f6a-b7c8-d9e0f1a20005',
  'Psoriasis is a T-cell-mediated chronic inflammatory skin disease in which plasmacytoid dendritic '
  || 'cells and keratinocytes amplify an IL-23/Th17 axis, producing massive IL-17A, IL-22, and TNF-Î± '
  || 'output that drives keratinocyte hyperproliferation â€” reducing epidermal turnover from the normal '
  || '28 days to 3â€“5 days. The result is the classic well-demarcated erythematous plaque with silvery '
  || 'micaceous scale. The Koebner (isomorphic) phenomenon â€” new plaques appearing at sites of physical '
  || 'trauma within 10â€“20 days â€” affects approximately 25% of patients and is a useful diagnostic clue.',
  'British Association of Dermatologists Psoriasis Guidelines',
  'psoriasis',
  NULL
),

-- 6. Psoriasis: topical management
(
  'b2c3d4e5-0006-4f6a-b7c8-d9e0f1a20006',
  'Coal tar (1â€“5%) is one of the oldest effective keratolytic and anti-inflammatory agents for psoriasis; '
  || 'it suppresses DNA synthesis in rapidly dividing keratinocytes and is particularly useful for scalp '
  || 'and nail psoriasis. Salicylic acid 2â€“6% acts as a keratolytic, softening and lifting adherent scale '
  || 'to improve penetration of other topicals. Daily generous emollient use (minimum 250 g/week) is not '
  || 'merely cosmetic â€” it reduces plaque thickness, decreases topical corticosteroid requirements by up to '
  || '30%, and blunts the itch-scratch cycle that worsens psoriatic plaques.',
  'Clinical Dermatology Guidelines',
  'psoriasis',
  NULL
),

-- 7. Rosacea: vascular triggers and SPF
(
  'b2c3d4e5-0007-4f6a-b7c8-d9e0f1a20007',
  'Rosacea is a chronic facial inflammatory condition whose hallmark is neurovascular dysregulation: '
  || 'transient receptor potential (TRP) ion channels on facial cutaneous nerves are hypersensitive to '
  || 'temperature, UV radiation, capsaicin, and ethanol, triggering exaggerated vasodilation (flushing). '
  || 'Common vascular triggers that patients should systematically identify and avoid include hot beverages, '
  || 'spicy food, alcohol (especially red wine and spirits), strenuous exercise, extreme temperatures, and '
  || 'emotional stress. '
  || 'Broad-spectrum mineral SPF 30â€“50 is non-negotiable: UV exposure is the most consistent rosacea '
  || 'trigger across all subtypes and also upregulates cathelicidin LL-37, the antimicrobial peptide '
  || 'central to rosacea pathogenesis.',
  'National Rosacea Society Expert Committee Guidelines',
  'rosacea',
  NULL
),

-- 8. Rosacea: niacinamide and azelaic acid
(
  'b2c3d4e5-0008-4f6a-b7c8-d9e0f1a20008',
  'Niacinamide at 4â€“10% concentration reduces rosacea erythema by suppressing prostaglandin E2-mediated '
  || 'vasodilation and decreasing TEWL, strengthening the impaired barrier common in ETR (erythematotelangiectatic '
  || 'rosacea) subtype. Azelaic acid 15â€“20% (prescription) and 10% (OTC) is first-line for papulopustular '
  || 'rosacea (PPR): it normalises keratinisation, reduces Demodex density, and directly inhibits the reactive '
  || 'oxygen species production in neutrophils that perpetuates the PPR inflammatory cycle. '
  || 'Both agents are well tolerated on Fitzpatrick IVâ€“VI skin tones without risk of post-inflammatory '
  || 'hyperpigmentation that limits other treatments.',
  'AAD Rosacea Clinical Guideline 2019',
  'rosacea',
  NULL
),

-- 9. Seborrheic Keratoses: differentiation and management
(
  'b2c3d4e5-0009-4f6a-b7c8-d9e0f1a20009',
  'Seborrhoeic keratoses (SK) are benign epidermal tumours arising from keratinocyte proliferation; '
  || 'they appear as well-demarcated, "stuck-on," waxy plaques that range from tan to dark brown and '
  || 'are characterised by keratin-filled pseudocysts (comedo-like openings) on dermoscopy â€” a key '
  || 'differentiator from melanoma. Unlike melanocytic lesions, SKs do not arise from melanocytes and '
  || 'carry no malignant potential; however, sudden eruption of multiple SKs (sign of Leser-TrÃ©lat) may '
  || 'indicate an underlying internal malignancy. '
  || 'Zinc pyrithione washes reduce the Malassezia colonisation that can secondarily inflame SKs on the scalp '
  || 'and trunk, alleviating associated itch and scaling without addressing the lesion itself.',
  'Clinical Dermatology Guidelines',
  'seborrheic_keratoses',
  NULL
),

-- 10. Tinea: dermatophyte infections and treatment
(
  'b2c3d4e5-0010-4f6a-b7c8-d9e0f1a20010',
  'Tinea (dermatophytosis) is caused by keratinophilic fungi â€” Trichophyton, Microsporum, and Epidermophyton '
  || 'species â€” that invade the non-living keratinised layers of skin, hair, and nails. '
  || 'Azole antifungals (clotrimazole, miconazole, ketoconazole) inhibit lanosterol 14Î±-demethylase, '
  || 'blocking ergosterol synthesis and disrupting membrane integrity; allylamines (terbinafine) inhibit '
  || 'squalene epoxidase, causing lethal squalene accumulation rather than just ergostatic effects â€” making '
  || 'them fungicidal rather than fungistatic and requiring a shorter treatment course. '
  || 'Hygiene measures â€” keeping affected areas dry, using separate towels, avoiding shared footwear, and '
  || 'washing bed linen at 60Â°C â€” are essential to prevent autoreinfection and household spread.',
  'Infectious Diseases Society Clinical Practice Guidelines',
  'tinea',
  NULL
),

-- 11. Skin Barrier Science
(
  'b2c3d4e5-0011-4f6a-b7c8-d9e0f1a20011',
  'The stratum corneum functions as the primary permeability barrier through its "brick and mortar" '
  || 'architecture: corneocytes (bricks) embedded in a lamellar lipid matrix (mortar) composed of ceramides '
  || '(~50%), free fatty acids (~15%), and cholesterol (~25%), optimally in a 3:1:1 molar ratio. '
  || 'Disruption of this ratio â€” by harsh cleansers, low-humidity environments, or genetic FLG mutations â€” '
  || 'raises TEWL and increases skin sensitivity. '
  || 'The acid mantle (skin surface pH 4.5â€“5.5) is maintained by secretion of lactic acid and free fatty '
  || 'acids; alkaline shift above pH 6 activates serine proteases that degrade corneodesmosomal proteins, '
  || 'accelerating desquamation and impairing antimicrobial defence.',
  'Skin Barrier Research',
  'general',
  NULL
),

-- 12. Fitzpatrick Scale and SPF recommendations
(
  'b2c3d4e5-0012-4f6a-b7c8-d9e0f1a20012',
  'The Fitzpatrick phototype scale classifies skin into six types based on constitutive melanin content '
  || 'and UV tanning/burning response: Type I (always burns, never tans; MC1R variants, red/blonde hair) '
  || 'through Type VI (deeply pigmented, never burns; highest epidermal melanin index). '
  || 'Melanin provides intrinsic SPF: Type I skin has an estimated natural SPF of ~1â€“3, Type VI ~8â€“13. '
  || 'Despite this, Types IVâ€“VI still accumulate UV-induced DNA damage and are not immune to photocarcinogenesis; '
  || 'furthermore, UV triggers post-inflammatory hyperpigmentation (PIH) more readily in higher phototypes. '
  || 'AAD recommendations: Types Iâ€“II should use SPF 50+ broad-spectrum daily; Types IIIâ€“VI require minimum '
  || 'SPF 30, with preference for mineral sunscreens to avoid irritation and to minimise the white cast '
  || 'associated with zinc oxide through newer cosmetically elegant formulations.',
  'AAD Photoprotection Recommendations',
  'general',
  NULL
)

ON CONFLICT DO NOTHING;

-- =====================================================================
-- Backfill embeddings after running migration 002:
--   python -m app.rag.backfill
-- =====================================================================

