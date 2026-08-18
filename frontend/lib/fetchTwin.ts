// Digital Twin data-fetch layer.
//
// The current twin ships as the `twin` key of the /analyze response, but a
// standalone dashboard needs the twin WITHOUT re-running a scan. Since every
// `skin_twin_snapshots` row carries the full twin state (same columns), the most
// recent snapshot IS the current twin — so we read the history table once and use
// its newest row as "current". Runs under the cookie session → RLS-scoped to the user.
import { createSupabaseServerClient } from "./supabaseServer";
import type { DigitalTwin, TwinSnapshot, FitzpatrickTone } from "@/types/twin";

const SNAPSHOT_COLUMNS =
  "twin_id, user_id, fitzpatrick_skin_tone, hydration_index, barrier_integrity, " +
  "active_flare_ups, dominant_condition, scan_count, last_scan_at, last_updated_at, " +
  "created_at, snapshot_id, deltas, analysis_result_id, trigger, chat_feedback_summary";

export interface TwinBundle {
  /** Newest snapshot, treated as the live twin. */
  current: DigitalTwin;
  /** Chronological (oldest → newest) history for the progression graphs. */
  snapshots: TwinSnapshot[];
}

/**
 * Fetch the signed-in user's twin history and current state.
 * Returns null when unauthenticated or no snapshots exist yet.
 * Server-only: relies on the cookie session.
 */
export async function fetchTwinBundle(): Promise<TwinBundle | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("skin_twin_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error || !data || data.length === 0) return null;

  const snapshots = (data as RawSnapshot[]).map(normaliseSnapshot);
  return { current: snapshots[snapshots.length - 1], snapshots };
}

// --- normalisation (isolates any minor DB drift) ---------------------------

type RawSnapshot = Record<string, unknown>;

function normaliseSnapshot(r: RawSnapshot): TwinSnapshot {
  return {
    twin_id: String(r.twin_id ?? ""),
    user_id: String(r.user_id ?? ""),
    fitzpatrick_skin_tone: clampTone(Number(r.fitzpatrick_skin_tone ?? 3)),
    hydration_index: num(r.hydration_index),
    barrier_integrity: num(r.barrier_integrity),
    active_flare_ups: (r.active_flare_ups as Record<string, number>) ?? {},
    dominant_condition: String(r.dominant_condition ?? ""),
    scan_count: Number(r.scan_count ?? 0),
    last_scan_at: String(r.last_scan_at ?? r.created_at ?? ""),
    last_updated_at: String(r.last_updated_at ?? r.created_at ?? ""),
    created_at: String(r.created_at ?? ""),
    snapshot_id: String(r.snapshot_id ?? ""),
    deltas:
      (r.deltas as TwinSnapshot["deltas"]) ?? {
        hydration_index: 0,
        barrier_integrity: 0,
        flare_changes: {},
      },
    analysis_result_id: r.analysis_result_id ? String(r.analysis_result_id) : undefined,
    trigger: (r.trigger as TwinSnapshot["trigger"]) ?? "scan",
    chat_feedback_summary: r.chat_feedback_summary
      ? String(r.chat_feedback_summary)
      : undefined,
  };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clampTone(n: number): FitzpatrickTone {
  return Math.min(6, Math.max(1, Math.round(n))) as FitzpatrickTone;
}

/** Adapter for when you already hold the `twin` key from an /analyze response. */
export function twinFromAnalyzeResponse(twin: DigitalTwin): DigitalTwin {
  return twin;
}
