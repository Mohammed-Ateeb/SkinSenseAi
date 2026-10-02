-- Grant the twin tables, and clean up after the twin persistence bug.
-- Run this in the Supabase SQL editor. Idempotent, so re-running is safe.
--
-- Background: the digital twin held 0 rows after 34 real analyses. Two bugs in
-- app/twin/twin.py (a None from maybe_single(), and a snapshot inserted before
-- the skin_twins row it references) made every first scan crash, and the
-- analyze router absorbs twin failures as non-fatal, so nothing surfaced.
--
-- Fixing those exposed a third, separate gap: the twin tables were never
-- granted to service_role beyond INSERT/SELECT. Writes succeeded, which is why
-- it went unnoticed, but DELETE failed with:
--     ERROR 42501: permission denied for table skin_twin_snapshots
--
-- This is the same class of problem as migration 008's skincare_knowledge fix:
-- RLS policies were created without the table-level privileges that make them
-- take effect. Granting is what actually activates the policy.

-- ---------------------------------------------------------------------
-- 1. Privileges
-- ---------------------------------------------------------------------
GRANT SELECT ON public.skin_twins           TO anon, authenticated;
GRANT SELECT ON public.skin_twin_snapshots  TO anon, authenticated;

-- The backend writes and prunes twin state with the service-role key.
GRANT ALL    ON public.skin_twins           TO service_role;
GRANT ALL    ON public.skin_twin_snapshots  TO service_role;

-- ---------------------------------------------------------------------
-- 2. One-off cleanup
-- ---------------------------------------------------------------------
-- Any rows currently in these tables came from verifying the fix, not from a
-- real scan -- before the fix NOTHING could be written, so there is no genuine
-- longitudinal history to lose. Clearing them means the first real scan builds
-- the twin from a clean baseline instead of inheriting synthetic metrics.
--
-- Snapshots first: skin_twin_snapshots.twin_id references skin_twins.id.
DELETE FROM public.skin_twin_snapshots;
DELETE FROM public.skin_twins;
