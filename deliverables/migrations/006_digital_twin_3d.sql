-- Phase 1 Digital Twin Evolution: add 3D face geometry and zone condition columns
-- Run this migration in Supabase SQL editor

-- skin_twins: persist latest face_geometry + zone_conditions across scans
ALTER TABLE skin_twins
  ADD COLUMN IF NOT EXISTS face_geometry    JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS zone_conditions  JSONB DEFAULT NULL;

-- skin_twin_snapshots: per-scan face_geometry + zone_conditions for trend tracking
ALTER TABLE skin_twin_snapshots
  ADD COLUMN IF NOT EXISTS face_geometry    JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS zone_conditions  JSONB DEFAULT NULL;

-- analysis_results: store zone-level analysis alongside the full-image result
ALTER TABLE analysis_results
  ADD COLUMN IF NOT EXISTS zone_results     JSONB DEFAULT NULL;

COMMENT ON COLUMN skin_twins.face_geometry IS
  'MediaPipe FaceMesh landmarks: {landmarks: [{x,y,z}x468], captured_at: ISO8601}';
COMMENT ON COLUMN skin_twins.zone_conditions IS
  'Per-zone skin analysis: {forehead|nose|leftCheek|rightCheek|chin|perioral: {condition, confidence, bbox}}';
COMMENT ON COLUMN analysis_results.zone_results IS
  'Zone crop analysis passed from browser: same shape as skin_twins.zone_conditions';
