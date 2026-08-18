-- =====================================================================
-- SkinSense AI — Migration 001: Initial Schema
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
-- 5. Storage bucket — run via Supabase Dashboard or service_role client
-- ---------------------------------------------------------------------
-- The SQL editor anon/postgres roles cannot create storage buckets.
-- Run these from Supabase Dashboard → Storage, or via the service_role
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
