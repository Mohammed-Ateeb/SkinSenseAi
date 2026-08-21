// SkinSense AI — Digital Twin types.
//
// ✅ LOCKED SHAPE — matches Pam's (T4) twin. The twin appears as the `twin` key in
// the /analyze response (no separate endpoint); history rows live in the
// `skin_twin_snapshots` table (same columns + trigger metadata).
//
// NOTE: score fields (hydration_index, barrier_integrity, and each flare severity)
// are floats in [0, 1]. Multiply by 100 for display/gauges. active_flare_ups is a
// map of condition → severity, NOT a count — use flareUpCount()/activeFlareList().

export type FitzpatrickTone = 1 | 2 | 3 | 4 | 5 | 6;

/** condition name → severity in [0, 1]. */
export type FlareMap = Record<string, number>;

/** Change since the previous snapshot; drives the up/down arrows on cards. */
export interface TwinDeltas {
  hydration_index: number; // signed float, in [-1, 1] units
  barrier_integrity: number;
  flare_changes: Record<string, number>; // condition → signed severity change
}

/** Current twin state (the `twin` key of /analyze). */
export interface DigitalTwin {
  twin_id: string;
  user_id: string;
  fitzpatrick_skin_tone: FitzpatrickTone;
  hydration_index: number; // 0–1
  barrier_integrity: number; // 0–1
  active_flare_ups: FlareMap; // condition → 0–1 severity
  dominant_condition: string;
  scan_count: number;
  last_scan_at: string; // ISO
  last_updated_at: string; // ISO
  created_at: string; // ISO
  snapshot_id: string;
  deltas: TwinDeltas;
}

export type SnapshotTrigger = "scan" | "chat_feedback";

/** One `skin_twin_snapshots` row: full twin state + how/when it was recorded. */
export interface TwinSnapshot extends DigitalTwin {
  analysis_result_id?: string;
  trigger: SnapshotTrigger;
  chat_feedback_summary?: string;
}

// --- flare-map helpers ------------------------------------------------------

/** A condition counts as an "active flare-up" at/above this severity. */
export const ACTIVE_FLARE_THRESHOLD = 0.2;

/** Number of conditions currently flaring at/above the active threshold. */
export function flareUpCount(map: FlareMap): number {
  return Object.values(map ?? {}).filter((v) => v >= ACTIVE_FLARE_THRESHOLD).length;
}

/** Active conditions sorted by descending severity. */
export function activeFlareList(map: FlareMap): { condition: string; severity: number }[] {
  return Object.entries(map ?? {})
    .filter(([, v]) => v >= ACTIVE_FLARE_THRESHOLD)
    .map(([condition, severity]) => ({ condition, severity }))
    .sort((a, b) => b.severity - a.severity);
}
