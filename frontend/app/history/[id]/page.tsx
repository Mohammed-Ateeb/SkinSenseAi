'use client';
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import AppSidebar from "@/components/AppSidebar";
import Markdown from "@/components/Markdown";

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
  low_confidence: boolean | null;
}

export default function HistoryDetailPage() {
  const params = useParams<{ id: string }>();
  const [analysis, setAnalysis] = useState<AnalysisRow | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { window.location.href = "/login"; return; }
      try {
        const res = await fetch(`${apiUrl}/history/${params.id}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
        if (!res.ok) { setState("notfound"); return; }
        setAnalysis(await res.json());
        setState("ready");
      } catch { setState("notfound"); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const confidence = analysis?.confidence_score ? Math.round(analysis.confidence_score * 100) : null;
  const differentials: ConditionScore[] = analysis?.differential_diagnoses ?? [];
  const products: Product[] = analysis?.recommended_products ?? [];

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "linear-gradient(135deg, #EDD9C0 0%, #E8C9A0 40%, #F0D5C0 100%)" }}>
      <AppSidebar />

      <main className="flex-1 overflow-y-auto relative">
        <div className="fixed inset-0 pointer-events-none" aria-hidden>
          <div className="animate-float-blob absolute" style={{
            width: "600px", height: "600px", borderRadius: "50%", top: "-100px", right: "-100px",
            background: "radial-gradient(circle, rgba(212,168,83,0.55) 0%, rgba(201,150,62,0.25) 50%, transparent 70%)", filter: "blur(70px)",
          }} />
        </div>

        <div className="relative z-10 max-w-lg mx-auto px-6 py-12 animate-fade-up">
          {state === "loading" ? (
            <div className="glass-card p-16 text-center">
              <div className="w-10 h-10 rounded-full mx-auto border-2 animate-spin"
                style={{ borderColor: "rgba(201,150,62,0.2)", borderTopColor: "var(--gold)" }} />
            </div>
          ) : state === "notfound" || !analysis ? (
            <div className="glass-card p-16 text-center">
              <h3 className="font-display text-[1.6rem] mb-3" style={{ color: "var(--text)" }}>NOT FOUND</h3>
              <p className="text-sm mb-6" style={{ color: "var(--text-dim)", fontWeight: 300 }}>
                This analysis couldn&apos;t be loaded. It may have been removed.
              </p>
              <Link href="/history" className="btn-gold inline-flex px-6 py-3 text-sm">Back to history</Link>
            </div>
          ) : (
          <>
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

          {analysis.llm_explanation && (
            <div className="glass-card p-6 mb-4">
              <div className="text-xs font-medium uppercase tracking-wider mb-4" style={{ color: "var(--text-mute)" }}>Your Skin Report</div>
              <Markdown text={analysis.llm_explanation} className="text-sm leading-relaxed" style={{ color: "var(--text-dim)", fontWeight: 300 }} />
            </div>
          )}

          {products.length > 0 && (
            <div className="glass-card p-5 mb-8">
              <div className="text-xs font-medium uppercase tracking-wider mb-4" style={{ color: "var(--text-mute)" }}>Recommended Products</div>
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
            <Link href="/analyze" className="btn-gold flex-1 py-3 text-sm text-center font-semibold">New Analysis</Link>
            <Link href="/chat" className="btn-glass flex-1 py-3 text-sm text-center font-medium" style={{ color: "var(--text-dim)" }}>Ask AI Chat</Link>
          </div>

          <p className="text-xs text-center mt-6 pb-4" style={{ color: "var(--text-mute)" }}>
            Not medical advice. Consult a licensed dermatologist for any skin concerns.
          </p>
          </>
          )}
        </div>
      </main>
    </div>
  );
}
