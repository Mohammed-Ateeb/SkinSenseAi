import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import AppSidebar from "@/components/AppSidebar";
import TwinStage from "@/components/TwinStage";
import { type TwinSnapshot } from "@/components/TwinViewer";
import { type ZoneConditions, type Landmark, ZONE_LABEL_COLORS } from "@/lib/meshUtils";

function toTitleCase(s: string) {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface TwinRow {
  face_geometry: { landmarks: Landmark[]; captured_at?: string } | null;
  zone_conditions: ZoneConditions | null;
  barrier_integrity: number;
  hydration_index: number;
  dominant_condition: string | null;
  scan_count: number | null;
  active_flare_ups: Record<string, number> | null;
}

interface SnapshotRow {
  snapshot_id: string;
  face_geometry: { landmarks: Landmark[] } | null;
  barrier_integrity: number | null;
  created_at: string;
}

export default async function TwinPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let twin: TwinRow | null = null;
  try {
    const { data } = await supabase
      .from("skin_twins")
      .select("face_geometry, zone_conditions, barrier_integrity, hydration_index, dominant_condition, scan_count, active_flare_ups")
      .eq("user_id", user.id)
      .single<TwinRow>();
    twin = data;
  } catch { /* twin not found or columns not yet migrated */ }

  let snapshots: SnapshotRow[] = [];
  try {
    const { data } = await supabase
      .from("skin_twin_snapshots")
      .select("id, face_geometry, barrier_integrity, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(15);
    snapshots = ((data ?? []) as Array<Omit<SnapshotRow, 'snapshot_id'> & { id: string }>)
      .map(s => ({ ...s, snapshot_id: s.id }));
  } catch { /* snapshots unavailable */ }

  const landmarks = twin?.face_geometry?.landmarks ?? null;
  const zoneConditions = twin?.zone_conditions ?? null;
  const zones = Object.keys(ZONE_LABEL_COLORS);
  const activeFlares = twin?.active_flare_ups
    ? Object.values(twin.active_flare_ups).filter(v => v >= 0.25).length
    : 0;
  const trendSnaps = [...snapshots].reverse().slice(-12);

  const twinSnapshots: TwinSnapshot[] = snapshots.map(s => ({
    snapshot_id: s.snapshot_id,
    face_geometry: s.face_geometry,
    created_at: s.created_at,
    barrier_integrity: s.barrier_integrity,
  }));

  return (
    <div className="flex h-screen overflow-hidden"
      style={{ background: "linear-gradient(135deg, #EDD9C0 0%, #E8C9A0 40%, #F0D5C0 100%)" }}>
      <AppSidebar />

      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden style={{ zIndex: 0 }}>
        <div className="animate-float-blob absolute" style={{
          width: "600px", height: "600px", borderRadius: "50%", top: "-100px", right: "5%",
          background: "radial-gradient(circle, rgba(212,168,83,0.45) 0%, rgba(201,150,62,0.18) 50%, transparent 70%)", filter: "blur(80px)",
        }} />
        <div className="animate-float-blob-2 absolute" style={{
          width: "500px", height: "500px", borderRadius: "50%", bottom: "5%", left: "10%",
          background: "radial-gradient(circle, rgba(232,146,124,0.35) 0%, rgba(220,120,100,0.12) 50%, transparent 70%)", filter: "blur(70px)",
        }} />
      </div>

      <div className="flex flex-1 overflow-hidden relative" style={{ zIndex: 1 }}>

        {/* Left: 3D viewer */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <div className="flex-shrink-0 px-6 py-5 flex items-center justify-between"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.6)", background: "rgba(250,246,241,0.75)", backdropFilter: "blur(16px)" }}>
            <div>
              <div className="text-xs font-medium tracking-wider uppercase mb-0.5" style={{ color: "var(--text-mute)" }}>
                Digital Skin Twin
              </div>
              <h1 className="font-display text-[1.6rem]" style={{ color: "var(--text)" }}>SKIN TWIN</h1>
            </div>
            {twin?.face_geometry?.captured_at && (
              <div className="text-xs" style={{ color: "var(--text-mute)" }}>
                Last captured{' '}
                <span style={{ color: "var(--gold)", fontWeight: 600 }}>
                  {formatDateShort(twin.face_geometry.captured_at)}
                </span>
              </div>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0 }}>
            <TwinStage
              landmarks={landmarks}
              zoneConditions={zoneConditions}
              snapshots={twinSnapshots}
            />
          </div>
        </div>

        {/* Right: Stats panel */}
        <aside className="hidden lg:flex flex-col w-[300px] xl:w-[320px] flex-shrink-0 overflow-y-auto"
          style={{ background: "rgba(255,255,255,0.65)", backdropFilter: "blur(20px)", borderLeft: "1px solid rgba(255,255,255,0.85)" }}>

          <div className="px-6 py-5 flex-shrink-0" style={{ borderBottom: "1px solid rgba(42,31,20,0.06)" }}>
            <div className="text-xs font-medium tracking-wider uppercase" style={{ color: "var(--text-mute)" }}>Twin State</div>
          </div>

          <div className="px-6 py-5">
            {twin ? (
              <>
                <div className="grid grid-cols-2 gap-3 mb-6">
                  {[
                    { label: "Barrier", value: `${Math.round((twin.barrier_integrity ?? 0) * 100)}%`, color: "var(--gold)" },
                    { label: "Hydration", value: `${Math.round((twin.hydration_index ?? 0) * 100)}%`, color: "var(--sage)" },
                    { label: "Active Flares", value: String(activeFlares), color: activeFlares > 0 ? "var(--coral)" : "var(--sage)" },
                    { label: "Total Scans", value: String(twin.scan_count ?? 0), color: "var(--gold)" },
                  ].map(m => (
                    <div key={m.label} className="glass-card p-4">
                      <div className="text-xs" style={{ color: "var(--text-mute)" }}>{m.label}</div>
                      <div className="font-display text-[1.6rem] mt-0.5 tabular-nums" style={{ color: m.color, lineHeight: 1 }}>{m.value}</div>
                    </div>
                  ))}
                </div>

                {twin.dominant_condition && (
                  <div className="mb-6">
                    <div className="text-xs font-medium tracking-wider uppercase mb-2" style={{ color: "var(--text-mute)" }}>Dominant</div>
                    <div className="glass-card px-4 py-3 text-sm font-semibold capitalize" style={{ color: "var(--text)" }}>
                      {twin.dominant_condition.replace(/_/g, " ")}
                    </div>
                  </div>
                )}

                {zoneConditions && (
                  <div className="mb-6">
                    <div className="text-xs font-medium tracking-wider uppercase mb-3" style={{ color: "var(--text-mute)" }}>Zone Conditions</div>
                    <div className="space-y-2">
                      {zones.map(zone => {
                        const zc = zoneConditions[zone];
                        const dotColor = ZONE_LABEL_COLORS[zone] + '1)';
                        return (
                          <div key={zone} className="flex items-center justify-between glass-card px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span style={{ color: dotColor, fontSize: 10 }}>●</span>
                              <span className="text-xs font-medium capitalize" style={{ color: "var(--text)" }}>{zone}</span>
                            </div>
                            <div className="text-right">
                              <div className="text-xs font-semibold capitalize" style={{ color: zc ? "var(--text)" : "var(--text-mute)" }}>
                                {zc ? toTitleCase(zc.condition) : "—"}
                              </div>
                              {zc && (
                                <div className="text-xs" style={{ color: "var(--text-mute)" }}>
                                  {Math.round(zc.confidence * 100)}%
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {trendSnaps.length > 1 && (
                  <div className="mb-6">
                    <div className="text-xs font-medium tracking-wider uppercase mb-3" style={{ color: "var(--text-mute)" }}>
                      Barrier Trend — {trendSnaps.length} scans
                    </div>
                    <div className="flex items-end gap-1.5 h-14">
                      {trendSnaps.map((s, i) => {
                        const pct = Math.round((s.barrier_integrity ?? 0.5) * 100);
                        const isLast = i === trendSnaps.length - 1;
                        return (
                          <div key={s.snapshot_id || i}
                            title={`${formatDateShort(s.created_at)}: ${pct}%`}
                            className="flex-1 rounded-t transition-all"
                            style={{ height: `${pct}%`, background: isLast ? "var(--gold)" : "rgba(201,150,62,0.22)" }} />
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-xs mt-1" style={{ color: "var(--text-mute)" }}>
                      <span>{formatDateShort(trendSnaps[0].created_at)}</span>
                      <span>{formatDateShort(trendSnaps[trendSnaps.length - 1].created_at)}</span>
                    </div>
                  </div>
                )}

                <Link href="/analyze" className="btn-gold w-full py-3 text-sm text-center font-semibold block">
                  + New Scan
                </Link>
              </>
            ) : (
              <div className="text-center py-12">
                <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center"
                  style={{ background: "rgba(201,150,62,0.08)" }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="#C9963E" strokeWidth="1.4" />
                    <circle cx="12" cy="12" r="4" stroke="#C9963E" strokeWidth="1.4" />
                  </svg>
                </div>
                <p className="text-sm mb-4" style={{ color: "var(--text-mute)" }}>No twin data yet.</p>
                <Link href="/analyze" className="btn-gold px-6 py-3 text-sm font-semibold inline-block">
                  Run first scan
                </Link>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
