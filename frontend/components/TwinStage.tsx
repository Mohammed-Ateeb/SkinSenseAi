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
        {(["3d", "2d"] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={view === v
              ? { background: "var(--gold)", color: "#fff", boxShadow: "0 2px 10px rgba(201,150,62,0.3)" }
              : { color: "var(--text-mute)" }}>
            {v === "3d" ? "3D Mesh" : "2D Map"}
          </button>
        ))}
      </div>

      {view === "3d" ? (
        <TwinViewer landmarks={landmarks} zoneConditions={zoneConditions} snapshots={snapshots} />
      ) : (
        <FaceMap2D zoneConditions={zoneConditions} />
      )}
    </div>
  );
}
