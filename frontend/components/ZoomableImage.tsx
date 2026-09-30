'use client';
import { useEffect, useState } from "react";

/**
 * Click an image to open it full-screen, then scroll to zoom.
 *
 * Skin detail is the whole point of these images — a thumbnail of a rash, or of
 * a Grad-CAM overlay, is not much use if you cannot look closely at it. Escape
 * or a click on the backdrop closes.
 */
export default function ZoomableImage({
  src,
  alt,
  className = "",
  style,
  hint = "Click to zoom",
}: {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);

  // Escape to close, and never leave the page scroll-locked behind us.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => { if (!open) setScale(1); }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${alt} — ${hint}`}
        className="relative block w-full group"
        style={{ background: "none", padding: 0, cursor: "zoom-in", lineHeight: 0 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={className} style={style} />
        <span
          className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: "rgba(20,14,8,0.62)", color: "#fff", backdropFilter: "blur(4px)" }}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
            <circle cx="5" cy="5" r="3.4" stroke="currentColor" strokeWidth="1.3" />
            <path d="M7.6 7.6L10.5 10.5M5 3.6v2.8M3.6 5h2.8" stroke="currentColor"
              strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          {hint}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
          onWheel={e => setScale(s => Math.min(5, Math.max(1, s - e.deltaY * 0.0015)))}
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(18,12,6,0.88)", backdropFilter: "blur(6px)", cursor: "zoom-out" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: "94vw",
              maxHeight: "88vh",
              objectFit: "contain",
              transform: `scale(${scale})`,
              transition: "transform 80ms linear",
              cursor: scale > 1 ? "grab" : "zoom-in",
              borderRadius: "10px",
            }}
          />

          <div className="absolute top-4 right-4 flex items-center gap-2">
            {scale > 1 && (
              <button type="button"
                onClick={e => { e.stopPropagation(); setScale(1); }}
                className="px-3 py-1.5 rounded-lg text-xs"
                style={{ background: "rgba(255,255,255,0.15)", color: "#fff", cursor: "pointer" }}>
                Reset
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)}
              aria-label="Close"
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.15)", color: "#fff", cursor: "pointer" }}>
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <path d="M3.5 3.5l8 8M11.5 3.5l-8 8" stroke="currentColor"
                  strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 text-xs px-3 py-1.5 rounded-lg"
            style={{ background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.85)" }}>
            Scroll to zoom · {Math.round(scale * 100)}% · Esc to close
          </div>
        </div>
      )}
    </>
  );
}
