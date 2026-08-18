import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

function toTitleCase(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface ConditionScore { condition: string; confidence: number; }
interface Product { name: string; active_ingredients: string[]; priority_score: number; }
interface AnalysisRow {
  id: string;
  primary_condition: string | null;
  confidence_score: number | null;
  differential_diagnoses: ConditionScore[] | null;
  llm_explanation: string | null;
  recommended_products: Product[] | null;
  created_at: string;
  fitzpatrick_skin_tone: number | null;
  low_confidence: boolean | null;
}

export default async function HistoryDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: analysis, error } = await supabase
    .from("analysis_results")
    .select("id, primary_condition, confidence_score, differential_diagnoses, llm_explanation, recommended_products, created_at, fitzpatrick_skin_tone, low_confidence")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single<AnalysisRow>();

  if (error || !analysis) notFound();

  const confidence = analysis.confidence_score ? Math.round(analysis.confidence_score * 100) : null;
  const differentials: ConditionScore[] = (analysis.differential_diagnoses as ConditionScore[] | null) ?? [];
  const products: Product[] = (analysis.recommended_products as Product[] | null) ?? [];

  return (
    <div className="min-h-screen relative" style={{ background: "var(--cream)" }}>

      {/* Blobs */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden>
        <div className="animate-float-blob absolute" style={{
          width: "400px", height: "400px", borderRadius: "50%", top: "-50px", right: "-50px",
          background: "radial-gradient(circle, rgba(212,168,83,0.2) 0%, transparent 70%)", filter: "blur(50px)",
        }} />
        <div className="animate-float-blob-2 absolute" style={{
          width: "300px", height: "300px", borderRadius: "50%", bottom: "10%", left: "-30px",
          background: "radial-gradient(circle, rgba(232,146,124,0.15) 0%, transparent 70%)", filter: "blur(40px)",
        }} />
      </div>

      {/* Nav */}
      <nav className="relative z-20 flex items-center justify-between px-6 md:px-10 h-14"
        style={{ background: "rgba(250,246,241,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.7)" }}>
        <Link href="/dashboard" className="font-display text-base" style={{ color: "var(--text)" }}>
          SKIN<span style={{ color: "var(--gold)" }}>SENSE</span>
        </Link>
        <Link href="/history" className="text-sm flex items-center gap-1.5" style={{ color: "var(--text-mute)" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          All analyses
        </Link>
      </nav>

      <div className="relative z-10 max-w-lg mx-auto px-6 py-12 animate-fade-up">
        <div className="mb-8">
          <div className="text-xs font-medium tracking-wider uppercase mb-1" style={{ color: "var(--text-mute)" }}>
            {formatDate(analysis.created_at)}
          </div>
          <h1 className="font-display text-[2.5rem]" style={{ color: "var(--text)" }}>
            {toTitleCase(analysis.primary_condition ?? "Unknown").toUpperCase()}
          </h1>
        </div>

        {analysis.low_confidence && (
          <div className="mb-6 px-4 py-3 rounded-xl text-sm"
            style={{ background: "rgba(232,146,124,0.12)", color: "#B85040", border: "1px solid rgba(232,146,124,0.2)" }}>
            Low confidence result — consult a dermatologist for accurate diagnosis.
          </div>
        )}

        {/* Primary */}
        <div className="glass-card p-6 mb-4" style={{ background: "rgba(201,150,62,0.04)" }}>
          <div className="text-xs font-medium tracking-wider uppercase mb-4" style={{ color: "var(--text-mute)" }}>Primary Detection</div>
          <div className="flex items-end justify-between gap-4">
            <div className="flex-1">
              <div className="font-display text-[2rem] leading-none mb-1" style={{ color: "var(--text)" }}>
                {toTitleCase(analysis.primary_condition ?? "Unknown").toUpperCase()}
              </div>
            </div>
            {confidence !== null && (
              <div className="font-display text-[3rem] leading-none tabular-nums flex-shrink-0" style={{ color: "var(--gold)" }}>
                {confidence}%
              </div>
            )}
          </div>
          {confidence !== null && (
            <div className="mt-5 progress-track">
              <div className="progress-fill" style={{ "--pct": `${confidence}%` } as React.CSSProperties} />
            </div>
          )}
        </div>

        {/* Differentials */}
        {differentials.length > 0 && (
          <div className="glass-card p-5 mb-4">
            <div className="text-xs font-medium uppercase tracking-wider mb-4" style={{ color: "var(--text-mute)" }}>Differential Diagnoses</div>
            {differentials.slice(0, 4).map(d => (
              <div key={d.condition} className="mb-3">
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="font-medium" style={{ color: "var(--text)" }}>{toTitleCase(d.condition)}</span>
                  <span className="tabular-nums" style={{ color: "var(--text-mute)" }}>{Math.round(d.confidence * 100)}%</span>
                </div>
                <div className="progress-track" style={{ height: "4px" }}>
                  <div className="progress-fill progress-fill-coral" style={{ "--pct": `${Math.round(d.confidence * 100)}%` } as React.CSSProperties} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* LLM explanation */}
        {analysis.llm_explanation && (
          <div className="glass-card p-6 mb-4">
            <div className="text-xs font-medium uppercase tracking-wider mb-4" style={{ color: "var(--text-mute)" }}>AI Analysis</div>
            <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-dim)", fontWeight: 300 }}>
              {analysis.llm_explanation}
            </div>
          </div>
        )}

        {/* Products */}
        {products.length > 0 && (
          <div className="glass-card p-5 mb-8">
            <div className="text-xs font-medium uppercase tracking-wider mb-4" style={{ color: "var(--text-mute)" }}>Recommended OTC Products</div>
            <div className="space-y-3">
              {products.slice(0, 4).map((p, i) => (
                <div key={i} className="flex items-start gap-3 py-3"
                  style={{ borderBottom: i < Math.min(products.length, 4) - 1 ? "1px solid rgba(42,31,20,0.07)" : "none" }}>
                  <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-bold mt-0.5"
                    style={{ background: "rgba(201,150,62,0.1)", color: "var(--gold)" }}>
                    {i + 1}
                  </div>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>{p.name}</div>
                    {p.active_ingredients?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {p.active_ingredients.slice(0, 3).map(ing => (
                          <span key={ing} className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(201,150,62,0.08)", color: "var(--gold)" }}>
                            {ing}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <Link href="/analyze" className="btn-gold flex-1 py-3 text-sm text-center font-semibold">
            New Analysis
          </Link>
          <Link href="/chat" className="btn-glass flex-1 py-3 text-sm text-center font-medium" style={{ color: "var(--text-dim)" }}>
            Ask AI Chat
          </Link>
        </div>

        <p className="text-xs text-center mt-6 pb-4" style={{ color: "var(--text-mute)" }}>
          Not medical advice. Consult a licensed dermatologist for any skin concerns.
        </p>
      </div>
    </div>
  );
}
