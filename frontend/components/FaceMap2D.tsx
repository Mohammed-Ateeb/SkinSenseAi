'use client';

import { useState } from "react";
import type { ZoneConditions } from "@/lib/meshUtils";

/**
 * 2D digital-twin face map. Unlike the 3D mesh (which needs webcam landmarks),
 * this renders purely from `zoneConditions`, so it works for photo/upload scans
 * too. Each facial zone is tinted by detected-condition confidence (severity).
 */

type ZoneKey = "forehead" | "nose" | "leftCheek" | "rightCheek" | "chin" | "perioral";

// SVG regions for a front-facing stylised face (viewBox 0 0 300 360)
const ZONE_PATHS: Record<ZoneKey, string> = {
  forehead:   "M70 70 Q150 40 230 70 Q225 115 150 118 Q75 115 70 70 Z",
  leftCheek:  "M72 140 Q100 135 118 160 Q120 205 95 220 Q68 205 66 170 Z",
  rightCheek: "M228 140 Q200 135 182 160 Q180 205 205 220 Q232 205 234 170 Z",
  nose:       "M138 130 Q150 125 162 130 L168 205 Q150 220 132 205 Z",
  perioral:   "M112 235 Q150 222 188 235 Q190 262 150 270 Q110 262 112 235 Z",
  chin:       "M108 282 Q150 278 192 282 Q188 322 150 332 Q112 322 108 282 Z",
};

const ZONE_LABELS: Record<ZoneKey, string> = {
  forehead: "Forehead", nose: "Nose", leftCheek: "Left cheek",
  rightCheek: "Right cheek", perioral: "Mouth area", chin: "Chin",
};

const ZONES: ZoneKey[] = ["forehead", "leftCheek", "rightCheek", "nose", "perioral", "chin"];

function toTitle(s: string) {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// Severity → warm coral fill opacity
function fillFor(confidence: number | undefined): string {
  if (!confidence || confidence <= 0) return "rgba(201,150,62,0.10)";
  const a = Math.min(0.75, 0.2 + confidence * 0.6);
  return `rgba(232,120,100,${a.toFixed(2)})`;
}

export default function FaceMap2D({ zoneConditions }: { zoneConditions: ZoneConditions | null }) {
  const [hover, setHover] = useState<ZoneKey | null>(null);
  const active = hover;
  const zc = (zoneConditions ?? {}) as Record<string, { condition: string; confidence: number } | undefined>;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-5 p-6">
      <div className="relative">
        <svg width="300" height="360" viewBox="0 0 300 360" style={{ maxWidth: "100%", filter: "drop-shadow(0 8px 24px rgba(42,31,20,0.12))" }}>
          {/* Face silhouette */}
          <path d="M150 32 Q245 40 250 150 Q252 230 210 300 Q180 345 150 348 Q120 345 90 300 Q48 230 50 150 Q55 40 150 32 Z"
            fill="rgba(255,255,255,0.55)" stroke="rgba(201,150,62,0.4)" strokeWidth="1.5" />
          {/* Zones */}
          {ZONES.map(z => {
            const cond = zc[z];
            const isHover = hover === z;
            return (
              <path key={z} d={ZONE_PATHS[z]}
                fill={fillFor(cond?.confidence)}
                stroke={isHover ? "rgba(201,150,62,0.9)" : "rgba(201,150,62,0.35)"}
                strokeWidth={isHover ? 2 : 1}
                style={{ cursor: "pointer", transition: "fill 0.3s, stroke 0.2s" }}
                onMouseEnter={() => setHover(z)}
                onMouseLeave={() => setHover(null)} />
            );
          })}
          {/* Eyes (decorative) */}
          <circle cx="112" cy="150" r="5" fill="rgba(42,31,20,0.4)" />
          <circle cx="188" cy="150" r="5" fill="rgba(42,31,20,0.4)" />
        </svg>
      </div>

      {/* Caption / hovered zone detail */}
      <div className="text-center min-h-[46px]">
        {active ? (
          <>
            <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>{ZONE_LABELS[active]}</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--text-mute)" }}>
              {zc[active]
                ? `${toTitle(zc[active]!.condition)} · ${Math.round(zc[active]!.confidence * 100)}%`
                : "No condition detected"}
            </div>
          </>
        ) : (
          <div className="text-xs" style={{ color: "var(--text-mute)" }}>
            Hover a region to see its detected condition. Warmer = higher severity.
          </div>
        )}
      </div>
    </div>
  );
}
