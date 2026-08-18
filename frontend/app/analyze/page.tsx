'use client';
import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

interface FaceLandmark { x: number; y: number; z: number; }
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

// MediaPipe 468-landmark zone definitions
const FACE_ZONES: Record<string, number[]> = {
  forehead:   [10, 151, 107, 66, 105, 63, 70, 156, 124, 122, 119, 117, 123, 147, 213, 138, 127, 34, 21, 71, 68, 104, 109],
  nose:       [4, 5, 1, 2, 3, 195, 197, 6, 19, 20, 94, 125, 354],
  leftCheek:  [50, 205, 206, 207, 187, 147, 123, 116, 111, 101],
  rightCheek: [280, 425, 426, 427, 411, 376, 352, 345, 340, 330],
  chin:       [18, 200, 199, 175, 152, 148, 176, 149, 150, 136],
  perioral:   [0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61],
};

const ZONE_COLORS: Record<string, string> = {
  forehead:   "rgba(212,168,83,",
  nose:       "rgba(127,216,190,",
  leftCheek:  "rgba(232,146,124,",
  rightCheek: "rgba(232,146,124,",
  chin:       "rgba(150,180,255,",
  perioral:   "rgba(255,200,120,",
};

function drawZoneBoxes(ctx: CanvasRenderingContext2D, landmarks: FaceLandmark[], w: number, h: number) {
  ctx.save();
  for (const [zone, indices] of Object.entries(FACE_ZONES)) {
    const pts = indices.map(i => landmarks[i]).filter(Boolean);
    if (!pts.length) continue;
    const xs = pts.map(p => p.x * w);
    const ys = pts.map(p => p.y * h);
    const pad = Math.max(w, h) * 0.012;
    const x0 = Math.max(0, Math.min(...xs) - pad);
    const y0 = Math.max(0, Math.min(...ys) - pad);
    const bw = Math.min(w - x0, Math.max(...xs) - Math.min(...xs) + pad * 2);
    const bh = Math.min(h - y0, Math.max(...ys) - Math.min(...ys) + pad * 2);
    const col = ZONE_COLORS[zone];
    ctx.strokeStyle = col + "0.75)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(x0, y0, bw, bh);
    ctx.fillStyle = col + "0.07)";
    ctx.fillRect(x0, y0, bw, bh);
    ctx.setLineDash([]);
    ctx.fillStyle = col + "0.9)";
    ctx.font = `bold ${Math.round(w * 0.018)}px system-ui`;
    ctx.fillText(zone, x0 + 5, y0 + Math.round(w * 0.022));
  }
  ctx.restore();
}

export default function AnalyzePage() {
  const containerRef = useRef<HTMLDivElement>(null);

  // shared state
  const [mode, setMode] = useState<"webcam" | "upload">("webcam");
  const [fitzpatrick, setFitzpatrick] = useState<number | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [globalStep, setGlobalStep] = useState<"idle" | "uploading" | "analyzing" | "results">("idle");

  // upload mode
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // webcam mode
  const [webcamStatus, setWebcamStatus] = useState<"loading" | "ready" | "captured">("loading");
  const [faceDetected, setFaceDetected] = useState(false);
  const [capturedThumb, setCapturedThumb] = useState<string | null>(null);
  const [capturedLandmarks, setCapturedLandmarks] = useState<FaceLandmark[] | null>(null);

  // refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const captureRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faceLandmarkerRef = useRef<any>(null);
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef(-1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentLandmarksRef = useRef<any>(null);

  useGSAP(() => {
    gsap.from(".analyze-main", { y: 40, opacity: 0, duration: 0.8, ease: "power3.out", delay: 0.1 });
    gsap.from(".analyze-nav",  { y: -20, opacity: 0, duration: 0.6, ease: "power2.out" });
  }, { scope: containerRef });

  // Init MediaPipe + camera when entering webcam mode
  useEffect(() => {
    if (mode !== "webcam") return;
    let cancelled = false;

    async function initMediaPipe() {
      setWebcamStatus("loading");
      setFaceDetected(false);
      try {
        const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        const fl = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU",
          },
          outputFaceBlendshapes: false,
          runningMode: "VIDEO",
          numFaces: 1,
        });
        if (cancelled) { fl.close(); return; }
        faceLandmarkerRef.current = fl;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setWebcamStatus("ready");
        startDetectionLoop(fl);
      } catch {
        if (!cancelled) setError("Camera or face-detection unavailable. Try uploading a photo instead.");
      }
    }

    initMediaPipe();
    return () => {
      cancelled = true;
      stopWebcam();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function startDetectionLoop(fl: any) {
    const loop = () => {
      const video = videoRef.current;
      const canvas = overlayRef.current;
      if (video && canvas && fl && video.readyState >= 2 && video.currentTime !== lastTimeRef.current) {
        lastTimeRef.current = video.currentTime;
        const det = fl.detectForVideo(video, performance.now());
        const ctx = canvas.getContext("2d");
        if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (det.faceLandmarks?.length > 0) {
            currentLandmarksRef.current = det.faceLandmarks[0];
            setFaceDetected(true);
            drawZoneBoxes(ctx, det.faceLandmarks[0], canvas.width, canvas.height);
          } else {
            currentLandmarksRef.current = null;
            setFaceDetected(false);
          }
        }
      }
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }

  function stopWebcam() {
    cancelAnimationFrame(animRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    faceLandmarkerRef.current?.close?.();
    faceLandmarkerRef.current = null;
    lastTimeRef.current = -1;
  }

  // Webcam actions
  const captureFrame = () => {
    const video = videoRef.current;
    const canvas = captureRef.current;
    const lm = currentLandmarksRef.current;
    if (!video || !canvas || !lm) return;
    cancelAnimationFrame(animRef.current);
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    setCapturedThumb(canvas.toDataURL("image/jpeg", 0.7));
    setCapturedLandmarks(lm.map((p: FaceLandmark) => ({ x: p.x, y: p.y, z: p.z })));
    setWebcamStatus("captured");
    stopWebcam();
  };

  const retakeWebcam = () => {
    setCapturedThumb(null);
    setCapturedLandmarks(null);
    setError(null);
    setWebcamStatus("loading");
    setMode("upload");
    setTimeout(() => setMode("webcam"), 50);
  };

  const runWebcamAnalysis = async () => {
    if (!captureRef.current || !capturedLandmarks) return;
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
        body: JSON.stringify({ filename: "face_scan.jpg", content_type: "image/jpeg" }),
      });
      if (!uploadRes.ok) throw new Error("Upload URL request failed");
      const { image_id, upload_url } = await uploadRes.json();

      await fetch(upload_url, { method: "PUT", body: blob, headers: { "Content-Type": "image/jpeg" } });

      setGlobalStep("analyzing");
      const analyzeRes = await fetch(`${apiUrl}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image_id, fitzpatrick_skin_tone: fitzpatrick, landmarks: capturedLandmarks }),
      });
      if (!analyzeRes.ok) throw new Error("Analysis failed");
      setResult(await analyzeRes.json());
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
      if (!uploadRes.ok) throw new Error("Upload URL request failed");
      const { image_id, upload_url } = await uploadRes.json();

      await fetch(upload_url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });

      setGlobalStep("analyzing");
      const analyzeRes = await fetch(`${apiUrl}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image_id, fitzpatrick_skin_tone: fitzpatrick }),
      });
      if (!analyzeRes.ok) throw new Error("Analysis failed");
      setResult(await analyzeRes.json());
      setGlobalStep("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setGlobalStep("idle");
    }
  };

  const reset = () => {
    setGlobalStep("idle");
    setFile(null);
    setPreview(null);
    setFitzpatrick(null);
    setResult(null);
    setError(null);
    setCapturedThumb(null);
    setCapturedLandmarks(null);
    setWebcamStatus("loading");
    setFaceDetected(false);
  };

  const isProcessing = globalStep === "uploading" || globalStep === "analyzing";

  return (
    <div ref={containerRef} className="min-h-screen relative overflow-x-hidden"
      style={{ background: "linear-gradient(135deg, #EDD9C0 0%, #E8C9A0 40%, #F0D5C0 100%)" }}>

      {/* Hidden canvas for frame capture (never displayed) */}
      <canvas ref={captureRef} className="sr-only" aria-hidden />

      {/* Blobs */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden>
        <div className="animate-float-blob absolute" style={{
          width: "650px", height: "650px", borderRadius: "50%", top: "-120px", right: "-100px",
          background: "radial-gradient(circle, rgba(212,168,83,0.6) 0%, rgba(201,150,62,0.25) 50%, transparent 70%)",
          filter: "blur(75px)",
        }} />
        <div className="animate-float-blob-2 absolute" style={{
          width: "550px", height: "550px", borderRadius: "50%", bottom: "-60px", left: "-80px",
          background: "radial-gradient(circle, rgba(232,146,124,0.55) 0%, rgba(220,120,100,0.2) 50%, transparent 70%)",
          filter: "blur(65px)",
        }} />
      </div>

      {/* Nav */}
      <nav className="analyze-nav relative z-20 flex items-center justify-between px-6 md:px-10 h-14"
        style={{ background: "rgba(250,246,241,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.7)" }}>
        <Link href="/dashboard" className="font-display text-base" style={{ color: "var(--text)" }}>
          SKIN<span style={{ color: "var(--gold)" }}>SENSE</span>
        </Link>
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm" style={{ color: "var(--text-mute)" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Dashboard
        </Link>
      </nav>

      <div className="relative z-10 max-w-lg mx-auto px-6 py-12">
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
                Scan your face live for a 3D skin twin with zone mapping, or upload a photo of the affected area.
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
                        Scan Face
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
                      <div className="text-sm font-medium mb-1" style={{ color: "var(--text)" }}>Loading face detection…</div>
                      <div className="text-xs" style={{ color: "var(--text-mute)" }}>Allow camera access when prompted</div>
                    </div>
                  )}

                  {webcamStatus === "ready" && (
                    <div className="mb-6">
                      <div className="relative rounded-2xl overflow-hidden"
                        style={{ background: "#111", boxShadow: "0 8px 40px rgba(42,31,20,0.25)", border: "1px solid rgba(255,255,255,0.15)" }}>
                        <video ref={videoRef} playsInline muted autoPlay
                          className="w-full block"
                          style={{ transform: "scaleX(-1)", aspectRatio: "4/3", objectFit: "cover" }} />
                        <canvas ref={overlayRef}
                          className="absolute inset-0 w-full h-full"
                          style={{ transform: "scaleX(-1)" }} />
                        {/* Status pill */}
                        <div className="absolute top-3 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5"
                          style={{
                            background: faceDetected ? "rgba(127,216,190,0.18)" : "rgba(20,16,12,0.6)",
                            backdropFilter: "blur(8px)",
                            color: faceDetected ? "#5FBEA4" : "rgba(255,255,255,0.55)",
                            border: `1px solid ${faceDetected ? "rgba(127,216,190,0.35)" : "rgba(255,255,255,0.12)"}`,
                          }}>
                          <span className="w-1.5 h-1.5 rounded-full inline-block"
                            style={{ background: faceDetected ? "#7FD8BE" : "rgba(255,255,255,0.35)" }} />
                          {faceDetected ? "Face detected — 6 zones mapped" : "Position your face in the frame"}
                        </div>
                      </div>
                      <button onClick={captureFrame} disabled={!faceDetected}
                        className="btn-gold w-full py-4 text-sm font-semibold mt-4 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <circle cx="8" cy="8" r="3.5" fill="white"/>
                          <circle cx="8" cy="8" r="6.5" stroke="white" strokeWidth="1.4"/>
                        </svg>
                        Capture Face Scan
                      </button>
                    </div>
                  )}

                  {webcamStatus === "captured" && (
                    <div className="mb-6">
                      <div className="relative rounded-2xl overflow-hidden mb-4"
                        style={{ background: "#111", border: "1px solid rgba(255,255,255,0.15)" }}>
                        {capturedThumb && (
                          <img src={capturedThumb} alt="Captured face scan"
                            className="w-full block"
                            style={{ transform: "scaleX(-1)", aspectRatio: "4/3", objectFit: "cover" }} />
                        )}
                        <div className="absolute top-3 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5"
                          style={{ background: "rgba(127,216,190,0.18)", backdropFilter: "blur(8px)", color: "#5FBEA4", border: "1px solid rgba(127,216,190,0.35)" }}>
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="#7FD8BE" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          {capturedLandmarks?.length ?? 0} landmarks · 6 zones mapped
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <button onClick={retakeWebcam}
                          className="flex-1 py-3.5 text-sm font-medium rounded-2xl transition-all"
                          style={{ background: "rgba(255,255,255,0.4)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.5)", color: "var(--text-dim)" }}>
                          Retake
                        </button>
                        <button onClick={runWebcamAnalysis}
                          className="btn-gold flex-[2] py-3.5 text-sm font-semibold">
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
    </div>
  );
}
