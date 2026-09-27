-- Axis B (symptom description + context) and the result columns the backend
-- already writes. Run this migration in the Supabase SQL editor.
--
-- Two things happen here:
--
--   1. NEW: questionnaire + context. The analyze flow now accepts a free-text
--      symptom description ("dry flaky patches that itch") plus a few optional
--      details, and stores both the raw answers and what the rule layer made of
--      them, so History and the Clinician console can show the reasoning.
--
--   2. BACKFILL: differential_diagnoses, recommended_products, low_confidence
--      and guardrail_flags were added to the live database by hand and never
--      captured in a migration. The backend writes all four on every analysis,
--      so a brand-new Supabase project provisioned from migrations 001-006
--      alone would fail on insert. Adding them here makes the migration set
--      self-sufficient again.
--
-- Every statement is idempotent (ADD COLUMN IF NOT EXISTS), so running this on
-- a database that already has some of these columns is a no-op for those.

ALTER TABLE public.analysis_results
  -- Axis B: what the person told us, and what we concluded from it
  ADD COLUMN IF NOT EXISTS questionnaire          JSONB   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS context                JSONB   DEFAULT NULL,
  -- Columns the backend has been writing without a migration to match
  ADD COLUMN IF NOT EXISTS differential_diagnoses JSONB   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS recommended_products   JSONB   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS low_confidence         BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS guardrail_flags        JSONB   DEFAULT '[]';

COMMENT ON COLUMN public.analysis_results.questionnaire IS
  'Raw intake answers: {symptom_text: free text in the user''s own words, body_site: TEXT, duration: TEXT, feels_like: TEXT[]}. All fields optional.';

COMMENT ON COLUMN public.analysis_results.context IS
  'Output of ml/context_rules.py for this analysis: {weights: {class: multiplier}, matched: [cue reasons that fired], supported: [classes lifted most], leaning: hormonal|seasonal|unclear, used_text: bool}. Explains WHY the image verdict was reweighted.';

COMMENT ON COLUMN public.analysis_results.differential_diagnoses IS
  'Ranked runners-up after the primary condition: [{condition, confidence}].';

COMMENT ON COLUMN public.analysis_results.recommended_products IS
  'Product suggestions served with the report: [{name, active_ingredients, ...}].';

COMMENT ON COLUMN public.analysis_results.low_confidence IS
  'TRUE when the top-1 probability fell below LOW_CONFIDENCE_THRESHOLD.';

COMMENT ON COLUMN public.analysis_results.guardrail_flags IS
  'Safety checks applied to the generated text: [{...}]. Empty array = clean.';
