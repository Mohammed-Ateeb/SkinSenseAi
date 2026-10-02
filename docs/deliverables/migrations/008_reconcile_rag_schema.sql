-- Reconcile the live schema so migrations 004 and 005 can run.
-- Run this in the Supabase SQL editor AFTER 002, and BEFORE 004 / 005.
--
-- Two separate problems, both found by running 004 against the real database:
--
--   1. products is missing columns. The live table predates migration 001 and
--      has no category / description / brand / created_at, so 004's INSERT
--      fails with:
--          ERROR 42703: column "category" of relation "products" does not exist
--      (It also has an extra image_url column, which is harmless and kept.)
--
--   2. skincare_knowledge is unreadable. Migration 002 creates the table,
--      enables RLS and adds an "anyone can view" POLICY — but never issues the
--      table-level GRANTs. In Postgres a policy only applies once privileges
--      exist, so every read fails with "permission denied for table
--      skincare_knowledge", even using the service-role key. Granting is what
--      actually makes that policy take effect.
--
-- Everything here is idempotent, so re-running it is safe.

-- ---------------------------------------------------------------------
-- 1. Bring public.products in line with migration 001
-- ---------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category    TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS brand       TEXT,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN public.products.category IS
  'Product form: cleanser, serum, moisturizer, treatment, wash, sunscreen, toner.';
COMMENT ON COLUMN public.products.description IS
  'Prose description shown with the recommendation. Not embedded — the RAG vector is built from name + target_conditions + active_ingredients.';

-- ---------------------------------------------------------------------
-- 2. Make skincare_knowledge actually readable
-- ---------------------------------------------------------------------
GRANT SELECT ON public.skincare_knowledge TO anon, authenticated;
GRANT ALL    ON public.skincare_knowledge TO service_role;

-- products is read the same way by the API roles; granted here too so a
-- freshly provisioned project behaves like this one.
GRANT SELECT ON public.products TO anon, authenticated;
GRANT ALL    ON public.products TO service_role;

-- ---------------------------------------------------------------------
-- After this: run 004_seed_products.sql, then 005_seed_knowledge.sql,
-- then from the backend directory:
--     python -m app.rag.backfill
-- ---------------------------------------------------------------------
