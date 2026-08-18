'use client';
import { useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

interface ConditionScore { condition: string; confidence: number; }
interface AnalyzeResponse {
  analysis_id: string;
  primary_condition: string;
  confidence_score: number;
  differential_diagnoses: ConditionScore[];
  llm_explanation: string;
  recommended_products: Array<{ name: string; active_ingredients: string[]; priority_score: number }>;
  twin_state: Record<string, unknown>;
  guardrail_flags: unknown[];
  low_confidence: boolean;
}

const FITZPATRICK_COLORS = ["#F6D6B0", "#E8C490", "#C68642", "#8D5524", "#5A3310", "#2A1506"];
const FITZPATRICK_LABELS = ["Type I", "Type II", "Type III", "Type IV", "Type V", "Type VI"];

export default function AnalyzePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<"idle" | "uploading" | "analyzing" | "results">("idle");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fitzpatrick, setFitzpatrick] = useState<number | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useGSAP(() => {
    gsap.from(".analyze-main", { y: 40, opacity: 0, duration: 0.8, ease: "power3.out", delay: 0.1 });
    gsap.from(".analyze-nav", { y: -20, opacity: 0, duration: 0.6, ease: "power2.out" });
  }, { scope: containerRef });

  const handleFile = (f: File) => {
    if (!f.type.startsWith("image/")) { setError("Please select an image file (JPEG, PNG, WebP)."); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setError(null);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) handleFile(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAnalysis = async () => {
    if (!file) return;
    setError(null);
    setStep("uploading");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError("Not signed in."); setStep("idle"); return; }
      const token = session.access_token;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

      const uploadRes = await fetch(`${apiUrl}/upload/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ filename: file.name, content_type: file.type }),
      });
      if (!uploadRes.ok) throw new Error("Upload URL request failed");
      const { image_id, upload_url } = await uploadRes.json();

      const putRes = await fetch(upload_url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!putRes.ok) throw new Error("Failed to upload image");

      setStep("analyzing");
      const analyzeRes = await fetch(`${apiUrl}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ image_id, fitzpatrick_skin_tone: fitzpatrick }),
      });
      if (!analyzeRes.ok) throw new Error("Analysis failed");
      const data: AnalyzeResponse = await analyzeRes.json();
      setResult(data);
      setStep("results");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStep("idle");
    }
  };

  const reset = () => { setStep("idle"); setFile(null); setPreview(null); setFitzpatrick(null); setResult(null); setError(null); };

  return (
    <div ref={containerRef} className="min-h-screen relative overflow-x-hidden" style={{ background: "var(--cream)" }}>

      {/* Blobs */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden>
        <div className="animate-float-blob absolute" style={{
          width: "500px", height: "500px", borderRadius: "50%", top: "-80px", right: "-80px",
          background: "radial-gradient(circle, rgba(212,168,83,0.22) 0%, transparent 70%)", filter: "blur(55px)",
        }} />
        <div className="animate-float-blob-2 absolute" style={{
          width: "400px", height: "400px", borderRadius: "50%", bottom: "0", left: "-60px",
          background: "radial-gradient(circle, rgba(232,146,124,0.18) 0%, transparent 70%)", filter: "blur(45px)",
        }} />
      </div>

      {/* Nav */}
      <nav className="analyze-nav relative z-20 flex items-center justify-between px-6 md:px-10 h-14"
        style={{ background: "rgba(250,246,241,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.7)" }}>
        <Link href="/dashboard" className="font-display text-base" style={{ color: "var(--text)" }}>
          SKIN<span style={{ color: "var(--gold)" }}>SENSE</span>
        </Link>
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm transition-colors" style={{ color: "var(--text-mute)" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Dashboard
        </Link>
      </nav>

      <div className="relative z-10 max-w-lg mx-auto px-6 py-12">
        <div className="analyze-main">
          {step !== "results" ? (
            <>
              <h1 className="font-display text-[2.8rem] mb-2" style={{ color: "var(--text)" }}>ANALYZE YOUR SKIN</h1>
              <p className="text-sm mb-10 leading-relaxed" style={{ color: "var(--text-dim)", fontWeight: 300 }}>
                Upload a clear photo of the affected area. Your image is deleted immediately after analysis — never stored.
              </p>

              {error && (
                <div className="mb-6 px-4 py-3 rounded-xl text-sm"
                  style={{ background: "rgba(232,146,124,0.12)", color: "#B85040", border: "1px solid rgba(232,146,124,0.2)" }}>
                  {error}
                </div>
              )}

              {step === "idle" ? (
                <>
                  {/* Drop zone */}
                  <div
                    onDragOver={e => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                    onClick={() => document.getElementById("file-input")?.click()}
                    className="relative rounded-2xl border-2 cursor-pointer transition-all mb-8"
                    style={{
                      borderColor: dragging ? "var(--gold)" : "rgba(201,150,62,0.25)",
                      borderStyle: "dashed",
                      background: dragging ? "rgba(201,150,62,0.06)" : "rgba(255,255,255,0.5)",
                      backdropFilter: "blur(16px)",
                      minHeight: "220px",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexDirection: "column", gap: "12px",
                    }}>
                    <input id="file-input" type="file" accept="image/*" className="sr-only"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                    {preview ? (
                      <img src={preview} alt="Selected" className="max-h-48 rounded-xl object-contain" />
                    ) : (
                      <>
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                          style={{ background: "rgba(201,150,62,0.1)" }}>
                          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <path d="M10 3v10M6 7l4-4 4 4" stroke="#C9963E" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M3 15h14" stroke="#C9963E" strokeWidth="1.6" strokeLinecap="round" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-medium" style={{ color: "var(--text)" }}>Drop photo here</div>
                          <div className="text-xs mt-1" style={{ color: "var(--text-mute)" }}>or click to browse — JPG, PNG, WEBP</div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Fitzpatrick selector */}
                  <div className="mb-8">
                    <div className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: "var(--text-mute)" }}>
                      Skin tone <span className="normal-case">(optional — improves accuracy)</span>
                    </div>
                    <div className="flex gap-2">
                      {FITZPATRICK_COLORS.map((color, i) => (
                        <button key={i} onClick={() => setFitzpatrick(fitzpatrick === i + 1 ? null : i + 1)}
                          title={FITZPATRICK_LABELS[i]}
                          className="w-9 h-9 rounded-full transition-all hover:scale-110"
                          style={{ background: color, outline: fitzpatrick === i + 1 ? "2px solid var(--gold)" : "2px solid transparent", outlineOffset: "2px" }} />
                      ))}
                    </div>
                    {fitzpatrick && (
                      <div className="text-xs mt-2" style={{ color: "var(--text-mute)" }}>Selected: {FITZPATRICK_LABELS[fitzpatrick - 1]}</div>
                    )}
                  </div>

                  <button onClick={runAnalysis} disabled={!file} className="btn-gold w-full py-4 text-sm font-semibold">
                    Analyze My Skin
                  </button>
                </>
              ) : (
                <div className="glass-card p-12 text-center">
                  <div className="w-16 h-16 rounded-full mx-auto mb-6 border-2 animate-spin"
                    style={{ borderColor: "rgba(201,150,62,0.2)", borderTopColor: "var(--gold)" }} />
                  <div className="font-display text-xl mb-2" style={{ color: "var(--text)" }}>
                    {step === "uploading" ? "UPLOADING..." : "ANALYSING..."}
                  </div>
                  <div className="text-sm" style={{ color: "var(--text-dim)", fontWeight: 300 }}>
                    {step === "uploading" ? "Securing your image" : "Running AI analysis — under 60 seconds"}
                  </div>
                  <div className="mt-6 progress-track">
                    <div className="progress-fill" style={{ "--pct": "60%", animationDuration: "3s" } as React.CSSProperties} />
                  </div>
                </div>
              )}
            </>
          ) : result && (
            <>
              <div className="flex items-center justify-between mb-8">
                <h1 className="font-display text-[2.2rem]" style={{ color: "var(--text)" }}>RESULTS</h1>
                <button onClick={reset} className="text-sm transition-colors hover:text-[#C9963E]" style={{ color: "var(--text-mute)" }}>
                  ← Analyze another
                </button>
              </div>

              {result.low_confidence && (
                <div className="mb-6 px-4 py-3 rounded-xl text-sm"
                  style={{ background: "rgba(232,146,124,0.12)", color: "#B85040", border: "1px solid rgba(232,146,124,0.2)" }}>
                  Low confidence — please consult a dermatologist for accurate diagnosis.
                </div>
              )}

              <div className="glass-card p-6 mb-4" style={{ background: "rgba(201,150,62,0.04)" }}>
                <div className="text-xs font-medium tracking-wider uppercase mb-4" style={{ color: "var(--text-mute)" }}>Primary Detection</div>
                <div className="flex items-end justify-between gap-4">
                  <div className="flex-1">
                    <div className="font-display text-[2rem] leading-none mb-1" style={{ color: "var(--text)" }}>
                      {result.primary_condition.replace(/_/g, " ").toUpperCase()}
                    </div>
                    <div className="text-sm" style={{ color: "var(--text-mute)" }}>Primary condition detected</div>
                  </div>
                  <div className="font-display text-[3rem] leading-none tabular-nums flex-shrink-0" style={{ color: "var(--gold)" }}>
                    {Math.round(result.confidence_score * 100)}%
                  </div>
                </div>
                <div className="mt-5 progress-track">
                  <div className="progress-fill" style={{ "--pct": `${Math.round(result.confidence_score * 100)}%` } as React.CSSProperties} />
                </div>
              </div>

              {result.differential_diagnoses.length > 0 && (
                <div className="glass-card p-5 mb-4">
                  <div className="text-xs font-medium uppercase tracking-wider mb-4" style={{ color: "var(--text-mute)" }}>Differential Diagnoses</div>
                  {result.differential_diagnoses.slice(0, 3).map(d => (
                    <div key={d.condition} className="mb-3">
                      <div className="flex justify-between text-sm mb-1.5">
                        <span className="font-medium capitalize" style={{ color: "var(--text)" }}>{d.condition.replace(/_/g, " ")}</span>
                        <span className="tabular-nums" style={{ color: "var(--text-mute)" }}>{Math.round(d.confidence * 100)}%</span>
                      </div>
                      <div className="progress-track" style={{ height: "4px" }}>
                        <div className="progress-fill progress-fill-coral" style={{ "--pct": `${Math.round(d.confidence * 100)}%` } as React.CSSProperties} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {result.llm_explanation && (
                <div className="glass-card p-6 mb-4">
                  <div className="text-xs font-medium uppercase tracking-wider mb-4" style={{ color: "var(--text-mute)" }}>AI Analysis</div>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-dim)", fontWeight: 300 }}>
                    {result.llm_explanation}
                  </div>
                </div>
              )}

              {result.recommended_products.length > 0 && (
                <div className="glass-card p-5 mb-6">
                  <div className="text-xs font-medium uppercase tracking-wider mb-4" style={{ color: "var(--text-mute)" }}>Recommended OTC Products</div>
                  <div className="space-y-3">
                    {result.recommended_products.slice(0, 4).map((p, i) => (
                      <div key={i} className="flex items-start gap-3 py-3"
                        style={{ borderBottom: i < Math.min(result.recommended_products.length, 4) - 1 ? "1px solid rgba(42,31,20,0.07)" : "none" }}>
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

              <Link href={`/history/${result.analysis_id}`}
                className="flex items-center justify-center gap-2 w-full py-3 text-sm font-medium btn-glass mb-6 hover:scale-[1.01] transition-transform"
                style={{ color: "var(--text-dim)" }}>
                View in history
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>

              <p className="text-xs text-center pb-4" style={{ color: "var(--text-mute)" }}>
                Not medical advice. Consult a licensed dermatologist for any skin concerns.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
