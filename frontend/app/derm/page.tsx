import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { isDermatologist } from "@/lib/role";
import AppShell from "@/components/AppShell";

interface Score { condition: string; confidence: number; }
interface DermRow {
  id: string;
  created_at: string;
  model_version: string | null;
  primary_condition: string | null;
  confidence_score: number | null;
  low_confidence: boolean | null;
  predictions: Score[] | null;
  differential_diagnoses: Score[] | null;
  guardrail_flags: unknown[] | null;
  fitzpatrick_skin_tone: number | null;
}

function title(s: string | null | undefined) {
  return (s ?? "—").replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
function pct(n: number | null | undefined) {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

export default async function DermPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Clinician view is dermatologist-only.
  if (!isDermatologist(user)) redirect("/dashboard");

  const { data } = await supabase
    .from("analysis_results")
    .select("id, created_at, model_version, primary_condition, confidence_score, low_confidence, predictions, differential_diagnoses, guardrail_flags, fitzpatrick_skin_tone")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = (data ?? []) as unknown as DermRow[];

  return (
    <AppShell>
      <div className="relative z-10 max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <div className="text-xs font-medium tracking-wider uppercase mb-1" style={{ color: "var(--text-mute)" }}>
            Clinician View · Decision support
          </div>
          <h1 className="font-display text-[2.4rem]" style={{ color: "var(--text)" }}>DERMATOLOGY CONSOLE</h1>
          <p className="text-sm mt-2 max-w-xl leading-relaxed" style={{ color: "var(--text-dim)", fontWeight: 300 }}>
            Full model output for professional review — raw class probabilities, differentials, calibration,
            and guardrail flags. This is decision support, not a diagnosis.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <h3 className="font-display text-[1.4rem] mb-2" style={{ color: "var(--text)" }}>NO ANALYSES YET</h3>
            <p className="text-sm mb-5" style={{ color: "var(--text-mute)" }}>
              Clinical records appear here after a scan is run.
            </p>
            <Link href="/analyze" className="btn-gold inline-flex px-6 py-3 text-sm">Run an analysis</Link>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map(r => {
              const preds = [...(r.predictions ?? [])].sort((a, b) => b.confidence - a.confidence);
              const flags = (r.guardrail_flags ?? []).length;
              return (
                <div key={r.id} className="glass-card p-6">
                  {/* Header row */}
                  <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
                    <div>
                      <div className="font-display text-[1.5rem] leading-none" style={{ color: "var(--text)" }}>
                        {title(r.primary_condition)}
                      </div>
                      <div className="text-xs mt-1.5" style={{ color: "var(--text-mute)" }}>
                        {new Date(r.created_at).toLocaleString()} · model {r.model_version ?? "—"}
                        {r.fitzpatrick_skin_tone ? ` · Fitzpatrick ${r.fitzpatrick_skin_tone}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.low_confidence && (
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
                          style={{ background: "rgba(232,146,124,0.15)", color: "#B85040" }}>LOW CONFIDENCE</span>
                      )}
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
                        style={{ background: flags ? "rgba(232,146,124,0.15)" : "rgba(127,216,190,0.15)", color: flags ? "#B85040" : "#5FBEA4" }}>
                        {flags} guardrail flag{flags === 1 ? "" : "s"}
                      </span>
                      <span className="font-display text-[1.8rem] leading-none tabular-nums ml-1" style={{ color: "var(--gold)" }}>
                        {pct(r.confidence_score)}
                      </span>
                    </div>
                  </div>

                  {/* Full class-probability distribution */}
                  <div className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: "var(--text-mute)" }}>
                    Class probability distribution
                  </div>
                  <div className="space-y-1.5 mb-2">
                    {preds.length === 0 && (
                      <div className="text-xs" style={{ color: "var(--text-mute)" }}>No probability vector stored for this record.</div>
                    )}
                    {preds.map((p, i) => (
                      <div key={p.condition} className="flex items-center gap-3">
                        <div className="w-40 text-xs capitalize flex-shrink-0" style={{ color: i === 0 ? "var(--text)" : "var(--text-dim)", fontWeight: i === 0 ? 600 : 400 }}>
                          {title(p.condition)}
                        </div>
                        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(42,31,20,0.06)" }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.round(p.confidence * 100)}%`, background: i === 0 ? "var(--gold)" : "rgba(201,150,62,0.35)" }} />
                        </div>
                        <div className="w-12 text-right text-xs tabular-nums flex-shrink-0" style={{ color: "var(--text-mute)" }}>
                          {pct(p.confidence)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs mt-8 leading-relaxed" style={{ color: "var(--text-mute)" }}>
          Intended for qualified professionals. Model outputs are probabilistic and may be miscalibrated;
          correlate with clinical examination and history. Not a substitute for in-person diagnosis.
        </p>
      </div>
    </AppShell>
  );
}
