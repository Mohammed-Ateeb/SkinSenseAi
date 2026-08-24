'use client';
import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import AppShell from "@/components/AppShell";
import Markdown from "@/components/Markdown";

// Guided reveal stages after analysis completes
type ResultStage = "diagnosis" | "products" | "chat";

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
  gradcam?: string | null;
}

const FITZPATRICK_COLORS = ["#F6D6B0", "#E8C490", "#C68642", "#8D5524", "#5A3310", "#2A1506"];
const FITZPATRICK_LABELS = ["Type I", "Type II", "Type III", "Type IV", "Type V", "Type VI"];

// Resolves true once the video actually produces frames; false if it stays
// black (no picture) within the timeout — this is what catches "black screen".
function waitForVideoFrames(v: HTMLVideoElement, timeoutMs = 4000): Promise<boolean> {
  return new Promise(resolve => {
    if (v.videoWidth > 0) return resolve(true);
    let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; clearInterval(iv); resolve(ok); } };
    const iv = setInterval(() => { if (v.videoWidth > 0) finish(true); }, 200);
    setTimeout(() => finish(v.videoWidth > 0), timeoutMs);
  });
}

export default function AnalyzePage() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  // shared state — default to Upload so the camera never auto-starts (a busy/
  // absent/blocked camera was the "black screen"); webcam is now opt-in.
  const [mode, setMode] = useState<"webcam" | "upload">("upload");
  const [fitzpatrick, setFitzpatrick] = useState<number | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [globalStep, setGlobalStep] = useState<"idle" | "uploading" | "analyzing" | "results">("idle");
  const [stage, setStage] = useState<ResultStage>("diagnosis");
  const goToChat = () => { if (result) router.push(`/chat?about=${encodeURIComponent(result.primary_condition)}`); };

  // upload mode
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // webcam mode
  const [webcamStatus, setWebcamStatus] = useState<"loading" | "ready" | "captured" | "error">("loading");
  const [camError, setCamError] = useState<string>("");
  const [capturedThumb, setCapturedThumb] = useState<string | null>(null);
  const [tooDark, setTooDark] = useState(false);          // live preview is dim
  const [captureTooDark, setCaptureTooDark] = useState(false);  // the taken shot is dim

  // refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useGSAP(() => {
    gsap.from(".analyze-main", { y: 40, opacity: 0, duration: 0.8, ease: "power3.out", delay: 0.1 });
  }, { scope: containerRef });

  // Open the webcam when entering camera mode (plain 2D capture — no MediaPipe/3D).
  useEffect(() => {
    if (mode !== "webcam") return;
    let cancelled = false;

    async function openCamera() {
      setWebcamStatus("loading");
      setCamError("");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
        });
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        setCamError(
          name === "NotAllowedError" ? "Camera access is blocked. Allow camera permission in your browser, or use Upload."
          : name === "NotReadableError" ? "Your camera is in use by another app (Zoom, Teams, Camera…). Close it and retry, or use Upload."
          : name === "NotFoundError" ? "No camera was found on this device. Please use Upload instead."
          : "Camera unavailable. Please use Upload instead."
        );
        setWebcamStatus("error");
        return;
      }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      // Reveal the <video> element first. It is NOT mounted during "loading"
      // (only the spinner is), so we can't attach the stream here — the attach
      // effect below wires srcObject once the element exists. Doing it here was
      // the black-screen bug: srcObject was set on a null ref and skipped.
      setWebcamStatus("ready");
    }

    openCamera();
    return () => {
      cancelled = true;
      stopWebcam();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Attach the live stream once the <video> element is actually in the DOM.
  useEffect(() => {
    if (webcamStatus !== "ready") return;
    const v = videoRef.current;
    const s = streamRef.current;
    if (!v || !s) return;
    v.srcObject = s;
    let cancelled = false;
    (async () => {
      try { await v.play(); } catch { /* frame check decides */ }
      const ok = await waitForVideoFrames(v);
      if (cancelled) return;
      if (!ok) {
        s.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        setCamError("The camera didn't produce a picture (it may be blocked, off, or in use). Retry, or use Upload.");
        setWebcamStatus("error");
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webcamStatus]);

  // Sample scene brightness while the camera is live; prompt for better light if dim.
  useEffect(() => {
    if (webcamStatus !== "ready") { setTooDark(false); return; }
    const c = document.createElement("canvas");
    c.width = 32; c.height = 24;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const iv = setInterval(() => {
      const v = videoRef.current;
      if (!v || !v.videoWidth || !ctx) return;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      setTooDark(sum / (data.length / 4) < 65); // luminance 0-255; ~65 = dim
    }, 1000);
    return () => clearInterval(iv);
  }, [webcamStatus]);

  function stopWebcam() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }

  // Capture the current video frame as a 2D still.
  const captureFrame = () => {
    const video = videoRef.current;
    const canvas = captureRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const cctx = canvas.getContext("2d")!;
    cctx.drawImage(video, 0, 0);
    // Measure brightness of the actual captured frame — gate analysis if too dark.
    const w = 32, h = 24, t = document.createElement("canvas");
    t.width = w; t.height = h;
    const tctx = t.getContext("2d", { willReadFrequently: true });
    if (tctx) {
      tctx.drawImage(canvas, 0, 0, w, h);
      const d = tctx.getImageData(0, 0, w, h).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      setCaptureTooDark(s / (d.length / 4) < 65);
    }
    setCapturedThumb(canvas.toDataURL("image/jpeg", 0.8));
    setWebcamStatus("captured");
    stopWebcam();
  };

  const retakeWebcam = () => {
    setCapturedThumb(null);
    setCaptureTooDark(false);
    setError(null);
    setWebcamStatus("loading");
    setMode("upload");
    setTimeout(() => setMode("webcam"), 50);
  };

  const runWebcamAnalysis = async () => {
    if (!captureRef.current) return;
    setError(null);
    setGlobalStep("uploading");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError("Not signed in."); setGlobalStep("idle"); return; }
      const token = session.access_token;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

      const blob = await new Promise<Blob>((res, rej) =>
        captureRef.current!.toBlob(b => b ? res(b) : rej(new Error("Canvas blob failed")), "image/jpeg", 0.9)
      );
      const uploadRes = await fetch(`${apiUrl}/upload/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename: "capture.jpg", content_type: "image/jpeg" }),
      });
      if (!uploadRes.ok) throw new Error("Couldn't prepare the upload. Please try again.");
      const { image_id, storage_path, token: uploadToken } = await uploadRes.json();

      const { error: uploadErr } = await supabase.storage
        .from("skin-images")
        .uploadToSignedUrl(storage_path, uploadToken, blob, { contentType: "image/jpeg" });
      if (uploadErr) throw new Error("Image upload failed. Please try again.");

      setGlobalStep("analyzing");
      const analyzeRes = await fetch(`${apiUrl}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image_id, fitzpatrick_skin_tone: fitzpatrick }),
      });
      if (!analyzeRes.ok) throw new Error("Analysis failed");
      setResult(await analyzeRes.json());
      setStage("diagnosis");
      setGlobalStep("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setGlobalStep("idle");
    }
  };

  // Upload actions
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
    if (f?.type.startsWith("image/")) handleFile(f);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runUploadAnalysis = async () => {
    if (!file) return;
    setError(null);
    setGlobalStep("uploading");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError("Not signed in."); setGlobalStep("idle"); return; }
      const token = session.access_token;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

      const uploadRes = await fetch(`${apiUrl}/upload/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename: file.name, content_type: file.type }),
      });
      if (!uploadRes.ok) throw new Error("Couldn't prepare the upload. Please try again.");
      const { image_id, storage_path, token: uploadToken } = await uploadRes.json();

      const { error: uploadErr } = await supabase.storage
        .from("skin-images")
        .uploadToSignedUrl(storage_path, uploadToken, file, { contentType: file.type });
      if (uploadErr) throw new Error("Image upload failed. Please try again.");

      setGlobalStep("analyzing");
      const analyzeRes = await fetch(`${apiUrl}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image_id, fitzpatrick_skin_tone: fitzpatrick }),
      });
      if (!analyzeRes.ok) throw new Error("Analysis failed");
      setResult(await analyzeRes.json());
      setStage("diagnosis");
      setGlobalStep("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setGlobalStep("idle");
    }
  };

  const reset = () => {
    setGlobalStep("idle");
    setStage("diagnosis");
    setFile(null);
    setPreview(null);
    setFitzpatrick(null);
    setResult(null);
    setError(null);
    setCapturedThumb(null);
    setCaptureTooDark(false);
    setWebcamStatus("loading");
    setCamError("");
  };

  const isProcessing = globalStep === "uploading" || globalStep === "analyzing";

  return (
    <AppShell>
      {/* Hidden canvas for frame capture (never displayed) */}
      <canvas ref={captureRef} className="sr-only" aria-hidden />

      <div ref={containerRef} className="relative z-10 max-w-lg mx-auto px-6 py-12">
        <div className="analyze-main">

          {/* ── Results ────────────────────────────────────────────────────── */}
          {globalStep === "results" && result ? (
            <>
              <div className="flex items-center justify-between mb-8">
                <h1 className="font-display text-[2.2rem]" style={{ color: "var(--text)" }}>RESULTS</h1>
                <button onClick={reset} className="text-sm hover:text-[#C9963E] transition-colors" style={{ color: "var(--text-mute)" }}>
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

              {/* AI Focus Map (Grad-CAM) removed: the classifier is trained on
                  cropped lesion images, so its attention on full-face selfies is
                  unreliable (it fixated on the eye). Re-enable once the model is
                  retrained with face-region cropping. */}

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
                  <div className="text-xs font-medium uppercase tracking-wider mb-4" style={{ color: "var(--text-mute)" }}>Your Skin Report</div>
                  <Markdown text={result.llm_explanation} className="text-sm leading-relaxed" style={{ color: "var(--text-dim)", fontWeight: 300 }} />
                </div>
              )}

              {stage === "diagnosis" && (
                <button onClick={() => setStage("products")}
                  className="btn-gold w-full py-4 text-sm font-semibold mt-2 mb-6 flex items-center justify-center gap-2">
                  See recommended products
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              )}

              {stage !== "diagnosis" && result.recommended_products.length > 0 && (
                <div className="glass-card p-5 mb-4 animate-fade-up">
                  <div className="text-xs font-medium uppercase tracking-wider mb-4" style={{ color: "var(--text-mute)" }}>Recommended Products</div>
                  <div className="space-y-3">
                    {result.recommended_products.slice(0, 4).map((p, i) => (
                      <div key={i} className="flex items-start gap-3 py-3"
                        style={{ borderBottom: i < Math.min(result.recommended_products.length, 4) - 1 ? "1px solid rgba(42,31,20,0.07)" : "none" }}>
                        <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-bold"
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

              {stage === "products" && (
                <button onClick={() => setStage("chat")}
                  className="btn-gold w-full py-4 text-sm font-semibold mt-2 mb-6 flex items-center justify-center gap-2">
                  Ask about your results
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              )}

              {stage === "chat" && (
                <div className="glass-card p-6 mb-6 text-center animate-fade-up">
                  <div className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "rgba(201,150,62,0.1)" }}>
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                      <path d="M19 13.5a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h12a2 2 0 012 2z" stroke="#C9963E" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div className="font-display text-xl mb-2" style={{ color: "var(--text)" }}>HAVE QUESTIONS?</div>
                  <p className="text-sm mb-5 leading-relaxed" style={{ color: "var(--text-dim)", fontWeight: 300 }}>
                    Chat with your Skin Assistant about your {result.primary_condition.replace(/_/g, " ")} results, routine, and next steps.
                  </p>
                  <button onClick={goToChat} className="btn-gold w-full py-3.5 text-sm font-semibold">
                    Start a conversation
                  </button>
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

          ) : isProcessing ? (
            /* ── Processing spinner ──────────────────────────────────────── */
            <div className="glass-card p-12 text-center">
              <div className="w-16 h-16 rounded-full mx-auto mb-6 border-2 animate-spin"
                style={{ borderColor: "rgba(201,150,62,0.2)", borderTopColor: "var(--gold)" }} />
              <div className="font-display text-xl mb-2" style={{ color: "var(--text)" }}>
                {globalStep === "uploading" ? "UPLOADING…" : "ANALYSING…"}
              </div>
              <div className="text-sm" style={{ color: "var(--text-dim)", fontWeight: 300 }}>
                {globalStep === "uploading" ? "Securing your image" : "Running AI analysis — under 60 seconds"}
              </div>
              <div className="mt-6 progress-track">
                <div className="progress-fill" style={{ "--pct": "60%", animationDuration: "3s" } as React.CSSProperties} />
              </div>
            </div>

          ) : (
            /* ── Input UI ────────────────────────────────────────────────── */
            <>
              <h1 className="font-display text-[2.8rem] mb-2" style={{ color: "var(--text)" }}>ANALYZE YOUR SKIN</h1>
              <p className="text-sm mb-8 leading-relaxed" style={{ color: "var(--text-dim)", fontWeight: 300 }}>
                Take a <strong>close-up</strong> that fills the frame with the affected area — not a full-face selfie — in good, even light for the most accurate result.
              </p>

              {error && (
                <div className="mb-5 px-4 py-3 rounded-xl text-sm"
                  style={{ background: "rgba(232,146,124,0.12)", color: "#B85040", border: "1px solid rgba(232,146,124,0.2)" }}>
                  {error}
                </div>
              )}

              {/* Mode switcher */}
              <div className="flex gap-2 mb-8 p-1.5 rounded-2xl"
                style={{ background: "rgba(255,255,255,0.35)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.5)" }}>
                {(["webcam", "upload"] as const).map(m => (
                  <button key={m} onClick={() => { setMode(m); setError(null); }}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2"
                    style={mode === m
                      ? { background: "var(--gold)", color: "#fff", boxShadow: "0 2px 12px rgba(201,150,62,0.35)" }
                      : { color: "var(--text-mute)" }}>
                    {m === "webcam" ? (
                      <>
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                          <circle cx="8" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
                          <rect x="1.5" y="5" width="13" height="9" rx="2" stroke="currentColor" strokeWidth="1.4"/>
                          <path d="M6 5V4a2 2 0 0 1 4 0v1" stroke="currentColor" strokeWidth="1.4"/>
                        </svg>
                        Use Camera
                      </>
                    ) : (
                      <>
                        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                          <path d="M7.5 2v8M4 6l3.5-4L11 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M2 12h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                        </svg>
                        Upload Photo
                      </>
                    )}
                  </button>
                ))}
              </div>

              {/* ── Webcam panel ─────────────────────────────────────────── */}
              {mode === "webcam" && (
                <>
                  {webcamStatus === "loading" && (
                    <div className="glass-card p-10 text-center mb-6" style={{ minHeight: "280px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                      <div className="w-10 h-10 rounded-full border-2 animate-spin mb-4"
                        style={{ borderColor: "rgba(201,150,62,0.2)", borderTopColor: "var(--gold)" }} />
                      <div className="text-sm font-medium mb-1" style={{ color: "var(--text)" }}>Starting camera…</div>
                      <div className="text-xs" style={{ color: "var(--text-mute)" }}>Allow camera access when prompted</div>
                    </div>
                  )}

                  {webcamStatus === "error" && (
                    <div className="glass-card p-8 text-center mb-6" style={{ minHeight: "280px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px" }}>
                      <div className="w-12 h-12 rounded-full flex items-center justify-center mb-1" style={{ background: "rgba(232,146,124,0.15)" }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                          <path d="M23 7l-7 5 7 5V7z" stroke="#B85040" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                          <rect x="1" y="5" width="15" height="14" rx="2" stroke="#B85040" strokeWidth="1.6"/>
                          <path d="M2 2l20 20" stroke="#B85040" strokeWidth="1.6" strokeLinecap="round"/>
                        </svg>
                      </div>
                      <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>Camera unavailable</div>
                      <div className="text-xs max-w-xs leading-relaxed" style={{ color: "var(--text-mute)" }}>{camError}</div>
                      <div className="flex gap-3 mt-3">
                        <button onClick={() => { setCamError(""); setWebcamStatus("loading"); setMode("upload"); setTimeout(() => setMode("webcam"), 50); }}
                          className="px-4 py-2.5 text-sm font-medium rounded-xl transition-all"
                          style={{ background: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.6)", color: "var(--text-dim)" }}>
                          Retry camera
                        </button>
                        <button onClick={() => { setCamError(""); setMode("upload"); }} className="btn-gold px-5 py-2.5 text-sm font-semibold">
                          Use Upload
                        </button>
                      </div>
                    </div>
                  )}

                  {webcamStatus === "ready" && (
                    <div className="mb-6">
                      <div className="relative rounded-2xl overflow-hidden"
                        style={{ background: "#111", boxShadow: "0 8px 40px rgba(42,31,20,0.25)", border: "1px solid rgba(255,255,255,0.15)" }}>
                        <video ref={videoRef} playsInline muted autoPlay
                          className="w-full block"
                          style={{ transform: "scaleX(-1)", aspectRatio: "4/3", objectFit: "cover" }} />
                        {/* Hint pill */}
                        <div className="absolute top-3 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5"
                          style={{ background: "rgba(20,16,12,0.6)", backdropFilter: "blur(8px)", color: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.12)" }}>
                          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: tooDark ? "#E8927C" : "#7FD8BE" }} />
                          Get close — fill the frame with the affected area
                        </div>
                        {/* Low-light prompt */}
                        {tooDark && (
                          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[92%] px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2 justify-center text-center animate-fade-up"
                            style={{ background: "rgba(184,80,64,0.9)", backdropFilter: "blur(8px)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }}>
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
                              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13" stroke="#fff" strokeWidth="1.3" strokeLinecap="round"/>
                              <circle cx="8" cy="8" r="2.5" stroke="#fff" strokeWidth="1.3"/>
                            </svg>
                            It&apos;s a bit dark — move to a brighter spot for a clearer, more accurate scan.
                          </div>
                        )}
                      </div>
                      <button onClick={captureFrame}
                        className="btn-gold w-full py-4 text-sm font-semibold mt-4 flex items-center justify-center gap-2 transition-opacity">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <circle cx="8" cy="8" r="3.5" fill="white"/>
                          <circle cx="8" cy="8" r="6.5" stroke="white" strokeWidth="1.4"/>
                        </svg>
                        Capture Photo
                      </button>
                    </div>
                  )}

                  {webcamStatus === "captured" && (
                    <div className="mb-6">
                      <div className="relative rounded-2xl overflow-hidden mb-4"
                        style={{ background: "#111", border: "1px solid rgba(255,255,255,0.15)" }}>
                        {capturedThumb && (
                          <img src={capturedThumb} alt="Captured photo"
                            className="w-full block"
                            style={{ transform: "scaleX(-1)", aspectRatio: "4/3", objectFit: "cover" }} />
                        )}
                        <div className="absolute top-3 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5"
                          style={{ background: "rgba(127,216,190,0.18)", backdropFilter: "blur(8px)", color: "#5FBEA4", border: "1px solid rgba(127,216,190,0.35)" }}>
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="#7FD8BE" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          Photo captured
                        </div>
                      </div>
                      {captureTooDark && (
                        <div className="mb-3 px-4 py-3 rounded-xl text-sm flex items-start gap-2"
                          style={{ background: "rgba(232,146,124,0.14)", color: "#B85040", border: "1px solid rgba(232,146,124,0.28)" }}>
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5">
                            <path d="M8 5v3.5M8 11h.01" stroke="#B85040" strokeWidth="1.6" strokeLinecap="round"/>
                            <circle cx="8" cy="8" r="6.5" stroke="#B85040" strokeWidth="1.4"/>
                          </svg>
                          <span>This photo is too dark, which makes the analysis inaccurate. Please sit under proper, even lighting and retake.</span>
                        </div>
                      )}
                      <div className="flex gap-3">
                        <button onClick={retakeWebcam}
                          className="flex-1 py-3.5 text-sm font-medium rounded-2xl transition-all"
                          style={captureTooDark
                            ? { background: "var(--gold)", color: "#fff" }
                            : { background: "rgba(255,255,255,0.4)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.5)", color: "var(--text-dim)" }}>
                          Retake{captureTooDark ? " in better light" : ""}
                        </button>
                        <button onClick={runWebcamAnalysis} disabled={captureTooDark}
                          className="btn-gold flex-[2] py-3.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
                          Analyze My Skin
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── Upload panel ─────────────────────────────────────────── */}
              {mode === "upload" && (
                <div className="mb-6">
                  <div
                    onDragOver={e => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                    onClick={() => document.getElementById("file-input")?.click()}
                    className="relative rounded-2xl border-2 cursor-pointer transition-all mb-5"
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
                            <path d="M10 3v10M6 7l4-4 4 4" stroke="#C9963E" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M3 15h14" stroke="#C9963E" strokeWidth="1.6" strokeLinecap="round"/>
                          </svg>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-medium" style={{ color: "var(--text)" }}>Drop photo here</div>
                          <div className="text-xs mt-1" style={{ color: "var(--text-mute)" }}>or click to browse — JPG, PNG, WEBP</div>
                        </div>
                      </>
                    )}
                  </div>
                  <button onClick={runUploadAnalysis} disabled={!file}
                    className="btn-gold w-full py-4 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
                    Analyze My Skin
                  </button>
                </div>
              )}

              {/* Fitzpatrick — shared by both modes */}
              <div className="mt-2">
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

              <p className="text-xs text-center mt-8" style={{ color: "var(--text-mute)" }}>
                Images are deleted immediately after analysis — never stored.
              </p>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
