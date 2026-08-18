import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import AppSidebar from "@/components/AppSidebar";

function toTitleCase(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function HistoryPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: analyses } = await supabase
    .from("analysis_results")
    .select("id, primary_condition, confidence_score, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "linear-gradient(135deg, #EDD9C0 0%, #E8C9A0 40%, #F0D5C0 100%)" }}>
      <AppSidebar />

      <main className="flex-1 overflow-y-auto relative">
        {/* Blobs */}
        <div className="fixed inset-0 pointer-events-none" aria-hidden>
          <div className="animate-float-blob absolute" style={{
            width: "600px", height: "600px", borderRadius: "50%", top: "-100px", right: "-100px",
            background: "radial-gradient(circle, rgba(212,168,83,0.55) 0%, rgba(201,150,62,0.25) 50%, transparent 70%)", filter: "blur(70px)",
          }} />
          <div className="animate-float-blob-2 absolute" style={{
            width: "500px", height: "500px", borderRadius: "50%", bottom: "-60px", left: "-60px",
            background: "radial-gradient(circle, rgba(127,216,190,0.5) 0%, rgba(100,200,170,0.2) 50%, transparent 70%)", filter: "blur(65px)",
          }} />
        </div>

        <div className="relative z-10 max-w-2xl mx-auto px-6 py-12">
        <div className="mb-10">
          <div className="divider mb-4" />
          <h1 className="font-display text-[2.5rem]" style={{ color: "var(--text)" }}>ANALYSIS HISTORY</h1>
          <p className="text-sm mt-2" style={{ color: "var(--text-mute)" }}>
            {analyses?.length ?? 0} total {(analyses?.length ?? 0) === 1 ? "analysis" : "analyses"}
          </p>
          <p className="text-xs mt-3 leading-relaxed max-w-md" style={{ color: "var(--text-mute)" }}>
            Your photos are deleted right after analysis — never stored. We keep only your results: the
            detected condition, confidence, skin report, and product recommendations, so you can track progress over time.
          </p>
        </div>

        {!analyses || analyses.length === 0 ? (
          <div className="glass-card p-16 text-center">
            <div className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center"
              style={{ background: "rgba(201,150,62,0.1)" }}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M14 5v9l5 5" stroke="#C9963E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="14" cy="14" r="11" stroke="#C9963E" strokeWidth="1.5" />
              </svg>
            </div>
            <h3 className="font-display text-[1.6rem] mb-3" style={{ color: "var(--text)" }}>NO ANALYSES YET</h3>
            <p className="text-sm mb-6 max-w-xs mx-auto leading-relaxed" style={{ color: "var(--text-dim)", fontWeight: 300 }}>
              Your analysis history will appear here after your first skin scan.
            </p>
            <Link href="/analyze" className="btn-gold inline-flex items-center gap-2 px-6 py-3 text-sm">
              Start first analysis
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {analyses.map((a, i) => (
              <Link key={a.id} href={`/history/${a.id}`}
                className="flex items-center justify-between glass-card px-6 py-5 hover:scale-[1.01] transition-transform group"
                style={{ borderRadius: "18px" }}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                    style={{ background: "rgba(201,150,62,0.1)" }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="5.5" stroke="#C9963E" strokeWidth="1.2" />
                      <circle cx="8" cy="8" r="2" stroke="#C9963E" strokeWidth="1.2" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                      {toTitleCase(a.primary_condition ?? "Unknown")}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--text-mute)" }}>{formatDate(a.created_at)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {a.confidence_score !== null && (
                    <div className="text-right">
                      <div className="text-base font-semibold tabular-nums" style={{ color: "var(--gold)" }}>
                        {Math.round(a.confidence_score * 100)}%
                      </div>
                      <div className="text-xs" style={{ color: "var(--text-mute)" }}>confidence</div>
                    </div>
                  )}
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: "var(--text-mute)" }}
                    className="group-hover:translate-x-0.5 transition-transform flex-shrink-0">
                    <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        )}
        </div>
      </main>
    </div>
  );
}
