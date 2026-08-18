import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { fetchTwinBundle } from "@/lib/fetchTwin";
import { deriveRoutineAdjustments } from "@/lib/deriveRoutine";
import SignOutButton from "./SignOutButton";

const NAV = [
  {
    href: "/dashboard", label: "Dashboard",
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><rect x="10" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><rect x="2" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><rect x="10" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" /></svg>,
  },
  {
    href: "/analyze", label: "Analyze",
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.4" /><circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.4" /><path d="M9 2.5V1M9 17v-1.5M2.5 9H1M17 9h-1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>,
  },
  {
    href: "/chat", label: "Chat",
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M16 11.5a1.5 1.5 0 01-1.5 1.5H5L2 16V4a1.5 1.5 0 011.5-1.5h11A1.5 1.5 0 0116 4z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  },
  {
    href: "/history", label: "History",
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 4v5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.4" /></svg>,
  },
];

const PRIORITY_COLORS: Record<string, string> = {
  high: "#E8927C",
  medium: "#C9963E",
  low: "#7FD8BE",
};

function MetricBar({ label, value, fillClass }: { label: string; value: number; fillClass?: string }) {
  const pct = Math.round(value * 100);
  return (
    <div className="mb-4">
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-xs font-medium" style={{ color: "var(--text-mute)" }}>{label}</span>
        <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--text)" }}>{pct}%</span>
      </div>
      <div className="progress-track">
        <div className={`progress-fill ${fillClass ?? ""}`} style={{ "--pct": `${pct}%` } as React.CSSProperties} />
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const emailName = user.email?.split("@")[0] ?? "there";
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  let twinBundle: Awaited<ReturnType<typeof fetchTwinBundle>> = null;
  try { twinBundle = await fetchTwinBundle(); } catch { /* no twin yet */ }

  const routineAdjustments = twinBundle?.current ? deriveRoutineAdjustments(twinBundle.current) : [];

  const { data: analyses } = await supabase
    .from("analysis_results")
    .select("id, primary_condition, confidence_score, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(5);

  const twin = twinBundle?.current ?? null;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--cream)" }}>

      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-60 flex-shrink-0"
        style={{ background: "rgba(255,255,255,0.7)", backdropFilter: "blur(20px)", borderRight: "1px solid rgba(255,255,255,0.85)" }}>
        <div className="px-6 py-6" style={{ borderBottom: "1px solid rgba(42,31,20,0.07)" }}>
          <Link href="/" className="font-display text-base" style={{ color: "var(--text)" }}>
            SKIN<span style={{ color: "var(--gold)" }}>SENSE</span>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-6 space-y-1">
          {NAV.map(item => {
            const isActive = item.href === "/dashboard";
            return (
              <Link key={item.href} href={item.href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
                style={isActive
                  ? { color: "var(--gold)", background: "rgba(201,150,62,0.1)" }
                  : { color: "var(--text-mute)" }}>
                <span style={isActive ? { color: "var(--gold)" } : {}}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 pb-4">
          <Link href="/analyze"
            className="btn-gold flex items-center justify-center gap-2 w-full py-3 text-sm font-semibold">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            New Analysis
          </Link>
        </div>

        <div className="px-4 py-4" style={{ borderTop: "1px solid rgba(42,31,20,0.07)" }}>
          <div className="text-xs truncate mb-2" style={{ color: "var(--text-mute)" }}>{user.email}</div>
          <SignOutButton />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="md:hidden flex items-center justify-between px-5 py-4"
          style={{ background: "rgba(255,255,255,0.75)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.8)" }}>
          <Link href="/" className="font-display text-base" style={{ color: "var(--text)" }}>
            SKIN<span style={{ color: "var(--gold)" }}>SENSE</span>
          </Link>
          <Link href="/analyze" className="btn-gold text-xs font-semibold px-4 py-2">+ Analyze</Link>
        </div>

        <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden style={{ zIndex: 0 }}>
          <div className="animate-float-blob absolute" style={{
            width: "400px", height: "400px", borderRadius: "50%", top: "-50px", right: "10%",
            background: "radial-gradient(circle, rgba(212,168,83,0.18) 0%, transparent 70%)", filter: "blur(50px)",
          }} />
          <div className="animate-float-blob-2 absolute" style={{
            width: "350px", height: "350px", borderRadius: "50%", bottom: "10%", left: "20%",
            background: "radial-gradient(circle, rgba(232,146,124,0.14) 0%, transparent 70%)", filter: "blur(45px)",
          }} />
        </div>

        <div className="relative p-6 md:p-10 max-w-3xl" style={{ zIndex: 1 }}>
          <div className="mb-10">
            <div className="text-xs font-medium tracking-wider mb-1 uppercase" style={{ color: "var(--text-mute)" }}>{today}</div>
            <h1 className="font-display text-[2.5rem]" style={{ color: "var(--text)" }}>
              HELLO, <span style={{ color: "var(--gold)" }}>{emailName.toUpperCase()}.</span>
            </h1>
          </div>

          {twin ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                {[
                  { label: "Barrier", value: `${Math.round(twin.barrier_integrity * 100)}%`, sub: "Integrity", color: "var(--gold)" },
                  { label: "Hydration", value: `${Math.round(twin.hydration_index * 100)}%`, sub: "Index", color: "var(--sage)" },
                  {
                    label: "Flares",
                    value: String(Object.values(twin.active_flare_ups as Record<string, number>).filter(v => v >= 0.25).length),
                    sub: "Active", color: "var(--coral)",
                  },
                  { label: "Scans", value: String(twin.scan_count ?? 0), sub: "Total", color: "var(--gold)" },
                ].map(card => (
                  <div key={card.label} className="glass-card p-5">
                    <div className="text-xs font-medium mb-1" style={{ color: "var(--text-mute)" }}>{card.label}</div>
                    <div className="font-display text-[2rem] mb-0.5 tabular-nums" style={{ color: card.color, lineHeight: 1 }}>{card.value}</div>
                    <div className="text-xs" style={{ color: "var(--text-mute)" }}>{card.sub}</div>
                  </div>
                ))}
              </div>

              {twinBundle!.snapshots.length > 1 && (
                <div className="glass-card p-6 mb-8">
                  <div className="text-xs font-medium tracking-wider mb-5 uppercase" style={{ color: "var(--text-mute)" }}>
                    Barrier Integrity — {twinBundle!.snapshots.length} scans
                  </div>
                  <div className="flex items-end gap-2 h-20">
                    {twinBundle!.snapshots.slice(-12).map((s, i, arr) => {
                      const pct = Math.round((s.barrier_integrity ?? 0.5) * 100);
                      const isLast = i === arr.length - 1;
                      return (
                        <div key={s.snapshot_id || i} title={`${pct}%`} className="flex-1 rounded-t-md transition-all"
                          style={{ height: `${pct}%`, background: isLast ? "var(--gold)" : "rgba(201,150,62,0.2)" }} />
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="glass-card p-6 mb-8 block lg:hidden">
                <div className="text-xs font-medium tracking-wider uppercase mb-5" style={{ color: "var(--text-mute)" }}>Twin State</div>
                <MetricBar label="Barrier Integrity" value={twin.barrier_integrity} />
                <MetricBar label="Hydration Index" value={twin.hydration_index} fillClass="progress-fill-sage" />
              </div>
            </>
          ) : (
            <div className="glass-card p-12 text-center mb-8">
              <div className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center"
                style={{ background: "rgba(201,150,62,0.1)" }}>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <circle cx="14" cy="14" r="11.5" stroke="#C9963E" strokeWidth="1.4" />
                  <circle cx="14" cy="14" r="5" stroke="#C9963E" strokeWidth="1.4" />
                  <path d="M14 3v2M14 23v2M3 14h2M23 14h2" stroke="#C9963E" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </div>
              <h3 className="font-display text-[1.6rem] mb-3" style={{ color: "var(--text)" }}>YOUR TWIN IS WAITING</h3>
              <p className="text-sm mb-6 max-w-xs mx-auto leading-relaxed" style={{ color: "var(--text-dim)", fontWeight: 300 }}>
                Run your first skin analysis to activate your Digital Skin Twin and start tracking your journey.
              </p>
              <Link href="/analyze" className="btn-gold inline-flex items-center gap-2 px-6 py-3 text-sm">
                Start first analysis
              </Link>
            </div>
          )}

          {analyses && analyses.length > 0 && (
            <div>
              <div className="text-xs font-medium tracking-wider mb-4 uppercase" style={{ color: "var(--text-mute)" }}>Recent Analyses</div>
              <div className="space-y-2">
                {analyses.map(a => {
                  const condition = (a.primary_condition ?? "Unknown").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
                  const confidence = a.confidence_score ? `${Math.round(a.confidence_score * 100)}%` : "—";
                  const date = new Date(a.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  return (
                    <Link key={a.id} href={`/history/${a.id}`}
                      className="flex items-center justify-between glass-card px-5 py-4 hover:scale-[1.01] transition-transform group"
                      style={{ borderRadius: "16px" }}>
                      <div>
                        <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>{condition}</div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--text-mute)" }}>{date}</div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-sm font-semibold" style={{ color: "var(--gold)" }}>{confidence}</div>
                          <div className="text-xs" style={{ color: "var(--text-mute)" }}>confidence</div>
                        </div>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: "var(--text-mute)" }} className="group-hover:translate-x-0.5 transition-transform">
                          <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </Link>
                  );
                })}
              </div>
              {analyses.length === 5 && (
                <Link href="/history" className="block mt-4 text-center text-xs transition-colors hover:text-[#C9963E]" style={{ color: "var(--text-mute)" }}>
                  View full history →
                </Link>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Right panel */}
      {twin && (
        <aside className="hidden lg:flex flex-col w-72 flex-shrink-0 overflow-y-auto"
          style={{ background: "rgba(255,255,255,0.6)", backdropFilter: "blur(20px)", borderLeft: "1px solid rgba(255,255,255,0.85)" }}>
          <div className="px-6 py-6" style={{ borderBottom: "1px solid rgba(42,31,20,0.07)" }}>
            <div className="text-xs font-medium tracking-wider uppercase" style={{ color: "var(--text-mute)" }}>Skin Twin State</div>
          </div>
          <div className="px-6 py-6">
            <MetricBar label="Barrier Integrity" value={twin.barrier_integrity} />
            <MetricBar label="Hydration Index" value={twin.hydration_index} fillClass="progress-fill-sage" />
            {twin.dominant_condition && (
              <div className="mb-6">
                <div className="text-xs font-medium mb-2" style={{ color: "var(--text-mute)" }}>Dominant Condition</div>
                <div className="text-sm font-semibold capitalize glass-card-sm px-4 py-2.5" style={{ color: "var(--text)" }}>
                  {twin.dominant_condition.replace(/_/g, " ")}
                </div>
              </div>
            )}
            {routineAdjustments.length > 0 && (
              <div>
                <div className="text-xs font-medium tracking-wider uppercase mb-4" style={{ color: "var(--text-mute)" }}>Routine Adjustments</div>
                <div className="space-y-3">
                  {routineAdjustments.slice(0, 3).map(adj => (
                    <div key={adj.id} className="glass-card p-4" style={{ borderRadius: "16px" }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>{adj.title}</div>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full capitalize flex-shrink-0 ml-2"
                          style={{ background: PRIORITY_COLORS[adj.priority] + "20", color: PRIORITY_COLORS[adj.priority] }}>
                          {adj.priority}
                        </span>
                      </div>
                      <div className="text-xs leading-relaxed mb-2" style={{ color: "var(--text-mute)", fontWeight: 300 }}>{adj.rationale}</div>
                      <div className="text-xs font-medium capitalize" style={{ color: "var(--gold)" }}>{adj.step}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
