"use client";

// Interactive glass metric tile. Hover lifts + glows (matches the app's
// micro-interaction language); an optional radial gauge visualises 0–100 scores.
import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface Props {
  label: string;
  /** Big value shown in the card (already formatted). */
  value: ReactNode;
  /** 0–100 for the gauge ring; omit for non-scored metrics (e.g. counts, tone). */
  score?: number;
  /** Small caption under the value (e.g. delta vs. last snapshot). */
  caption?: string;
  /** Trend direction for the caption colour. */
  trend?: "up" | "down" | "flat";
  /** Accent hex — defaults to glass-purple. */
  accent?: string;
  icon?: ReactNode;
}

export default function MetricCard({
  label,
  value,
  score,
  caption,
  trend = "flat",
  accent = "#a78bfa",
  icon,
}: Props) {
  const trendColor =
    trend === "up" ? "text-emerald-300" : trend === "down" ? "text-rose-300" : "text-white/50";

  return (
    <motion.div
      whileHover={{ y: -4, scale: 1.015 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className="glass-panel group relative overflow-hidden p-5"
      style={{ boxShadow: `0 8px 32px rgba(0,0,0,0.25)` }}
    >
      {/* soft accent glow on hover */}
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-40"
        style={{ background: accent }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-white/50">{label}</p>
          <div className="mt-1 text-3xl font-semibold text-white">{value}</div>
          {caption && <p className={`mt-1 text-xs ${trendColor}`}>{caption}</p>}
        </div>

        {typeof score === "number" ? (
          <Gauge value={score} accent={accent} />
        ) : (
          icon && <div className="text-white/70">{icon}</div>
        )}
      </div>
    </motion.div>
  );
}

function Gauge({ value, accent }: { value: number; accent: string }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, value));
  const offset = c * (1 - pct / 100);
  return (
    <svg width={56} height={56} viewBox="0 0 56 56" className="shrink-0 -rotate-90">
      <circle cx={28} cy={28} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={5} />
      <motion.circle
        cx={28}
        cy={28}
        r={r}
        fill="none"
        stroke={accent}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      />
    </svg>
  );
}
