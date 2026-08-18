"use client";

// Lightweight, dependency-free SVG line chart for twin history.
// Chosen over recharts because the existing stack only ships framer-motion +
// @supabase/supabase-js — no charting lib is confirmed installed. Swap in
// recharts later if the project adopts it; the props stay the same.
import { useId, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { TwinSnapshot } from "../types";

type Metric = "barrierIntegrity" | "hydrationIndex" | "activeFlareUps";

const SERIES: { key: Metric; label: string; stroke: string }[] = [
  { key: "barrierIntegrity", label: "Barrier", stroke: "#a78bfa" }, // glass-purple
  { key: "hydrationIndex", label: "Hydration", stroke: "#60a5fa" }, // glass-blue
  { key: "activeFlareUps", label: "Flare-ups", stroke: "#f472b6" },
];

interface Props {
  snapshots: TwinSnapshot[];
  /** Fixed viewBox height in px. */
  height?: number;
}

export default function ProgressionChart({ snapshots, height = 220 }: Props) {
  const gradId = useId();
  const [hidden, setHidden] = useState<Set<Metric>>(new Set());

  const W = 640;
  const H = height;
  const pad = { top: 16, right: 16, bottom: 28, left: 32 };

  const points = useMemo(() => buildSeries(snapshots), [snapshots]);

  if (snapshots.length < 2) {
    return (
      <div className="glass-panel flex h-40 items-center justify-center p-6 text-sm text-white/60">
        Not enough history yet — snapshots appear here as you log analyses.
      </div>
    );
  }

  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const n = snapshots.length;
  const xAt = (i: number) => pad.left + (i / (n - 1)) * innerW;
  const yAt = (v: number) => pad.top + (1 - v / 100) * innerH; // metrics normalised to 0–100

  return (
    <div className="glass-panel p-4 sm:p-6">
      <div className="mb-3 flex flex-wrap gap-3">
        {SERIES.map((s) => {
          const off = hidden.has(s.key);
          return (
            <button
              key={s.key}
              onClick={() => toggle(setHidden, s.key)}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-opacity ${
                off ? "opacity-40" : "opacity-100"
              }`}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: s.stroke }}
              />
              <span className="text-white/80">{s.label}</span>
            </button>
          );
        })}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Skin metric progression over time"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* horizontal gridlines at 0/25/50/75/100 */}
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={yAt(v)}
              y2={yAt(v)}
              stroke="rgba(255,255,255,0.10)"
              strokeWidth={1}
            />
            <text
              x={pad.left - 6}
              y={yAt(v) + 3}
              textAnchor="end"
              className="fill-white/40"
              fontSize={9}
            >
              {v}
            </text>
          </g>
        ))}

        {SERIES.filter((s) => !hidden.has(s.key)).map((s) => {
          const d = linePath(points[s.key], xAt, yAt);
          return (
            <g key={s.key}>
              {s.key === "barrierIntegrity" && (
                <path d={`${d} L ${xAt(n - 1)} ${yAt(0)} L ${xAt(0)} ${yAt(0)} Z`} fill={`url(#${gradId})`} />
              )}
              <motion.path
                d={d}
                fill="none"
                stroke={s.stroke}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.9, ease: "easeInOut" }}
              />
              {points[s.key].map((v, i) => (
                <circle key={i} cx={xAt(i)} cy={yAt(v)} r={2.5} fill={s.stroke} />
              ))}
            </g>
          );
        })}

        {/* x-axis date labels (first / mid / last to avoid crowding) */}
        {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
          <text
            key={i}
            x={xAt(i)}
            y={H - 8}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            className="fill-white/40"
            fontSize={9}
          >
            {fmtDate(snapshots[i].date)}
          </text>
        ))}
      </svg>
    </div>
  );
}

// --- helpers ---------------------------------------------------------------

function buildSeries(snaps: TwinSnapshot[]): Record<Metric, number[]> {
  // activeFlareUps is a small count; scale to the 0–100 axis for co-display.
  const maxFlare = Math.max(1, ...snaps.map((s) => s.activeFlareUps));
  return {
    barrierIntegrity: snaps.map((s) => s.barrierIntegrity),
    hydrationIndex: snaps.map((s) => s.hydrationIndex),
    activeFlareUps: snaps.map((s) => (s.activeFlareUps / maxFlare) * 100),
  };
}

function linePath(
  values: number[],
  xAt: (i: number) => number,
  yAt: (v: number) => number
): string {
  return values.map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(v)}`).join(" ");
}

function toggle(set: (u: (s: Set<Metric>) => Set<Metric>) => void, key: Metric) {
  set((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
