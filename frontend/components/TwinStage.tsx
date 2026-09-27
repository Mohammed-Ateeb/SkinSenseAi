'use client';

import { useState } from "react";
import TwinViewer, { type TwinSnapshot } from "./TwinViewer";
import FaceMap2D from "./FaceMap2D";
import type { ZoneConditions, Landmark } from "@/lib/meshUtils";

/**
 * Hosts both twin visualisations behind a 3D / 2D toggle. The 3D mesh needs
 * webcam landmarks; the 2D map works from zone conditions alone (photo scans).
 */
export default function TwinStage({
  landmarks,
  zoneConditions,
  snapshots,
}: {
  landmarks: Landmark[] | null;
  zoneConditions: ZoneConditions | null;
  snapshots: TwinSnapshot[];
}) {
  // Default to 2D when there's no 3D mesh yet (e.g. only photo/upload scans)
  const [view, setView] = useState<"3d" | "2d">(landmarks ? "3d" : "2d");

  return (
    <div className="relative w-full h-full">
      {/* Toggle */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex gap-1 p-1 rounded-xl"
        style={{ background: "rgba(255,255,255,0.6)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.7)" }}>
        {(["3d", "2d"] as const).map(v => {
          // 3D needs webcam landmarks; say so rather than showing an empty stage.
          const locked = v === "3d" && !landmarks;
          return (
            <button key={v} onClick={() => setView(v)}
              title={locked ? "Needs a webcam Scan Face capture — an uploaded photo can't build a 3D mesh" : undefined}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5"
              style={view === v
                ? { background: "var(--gold)", color: "#fff", boxShadow: "0 2px 10px rgba(201,150,62,0.3)" }
                : { color: locked ? "var(--text-mute)" : "var(--text-dim)", opacity: locked ? 0.65 : 1 }}>
              {v === "3d" ? "3D Mesh" : "2D Map"}
              {locked && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <rect x="1.6" y="4.3" width="6.8" height="4.6" rx="1" stroke="currentColor" strokeWidth="1.1" />
                  <path d="M3.3 4.3V3a1.7 1.7 0 0 1 3.4 0v1.3" stroke="currentColor" strokeWidth="1.1" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {view === "3d" ? (
        <TwinViewer landmarks={landmarks} zoneConditions={zoneConditions} snapshots={snapshots} />
      ) : (
        <FaceMap2D zoneConditions={zoneConditions} />
      )}

      {/* What the two views actually are — asked often enough to belong on screen. */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-3 text-center max-w-md">
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-mute)" }}>
          {view === "3d"
            ? "3D Mesh — your real face geometry from a webcam Scan Face capture (468 landmarks). Tracks how zones change shape between scans."
            : "2D Map — a face diagram with zones coloured by severity. Works from any analysis, including an uploaded photo."}
        </p>
      </div>
    </div>
  );
}
