"use client";

// SkinSense AI — Digital Twin dashboard.
//
// Presentational: receives a fully-resolved `DigitalTwin` (fetched server-side via
// lib/fetchTwin.ts using the cookie session) and renders the four metric cards,
// the historical progression graph, and the state-driven routine adjustments.
//
// Matches the app's glassmorphism language: .glass-panel, glass-purple/glass-blue
// tokens, framer-motion micro-interactions.
import { motion } from "framer-motion";
import type { DigitalTwin, FitzpatrickTone } from "../types";
import MetricCard from "./MetricCard";
import ProgressionChart from "./ProgressionChart";
import RoutineAdjustmentCard from "./RoutineAdjustmentCard";

const FITZPATRICK: Record<FitzpatrickTone, { roman: string; swatch: string }> = {
  1: { roman: "I", swatch: "#f7d7c4" },
  2: { roman: "II", swatch: "#e8b18f" },
  3: { roman: "III", swatch: "#d19566" },
  4: { roman: "IV", swatch: "#a86b3c" },
  5: { roman: "V", swatch: "#6f4326" },
  6: { roman: "VI", swatch: "#3d2417" },
};

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

export default function DigitalTwinDashboard({ twin }: { twin: DigitalTwin }) {
  const { metrics, snapshots, routineAdjustments } = twin;
  const prev = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const tone = FITZPATRICK[metrics.fitzpatrickTone];

  const barrierDelta = prev ? metrics.barrierIntegrity - prev.barrierIntegrity : null;
  const hydrationDelta = prev ? metrics.hydrationIndex - prev.hydrationIndex : null;
  const flareDelta = prev ? metrics.activeFlareUps - prev.activeFlareUps : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <h1 className="bg-gradient-to-r from-glass-purple to-glass-blue bg-clip-text text-3xl font-bold text-transparent sm:text-4xl">
          Your Digital Twin
        </h1>
        <p className="mt-1 text-sm text-white/50">
          Last updated {new Date(twin.updatedAt).toLocaleString()}
        </p>
      </motion.header>

      {/* Metric cards */}
      <motion.section
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <motion.div variants={item}>
          <MetricCard
            label="Barrier Integrity"
            value={`${Math.round(metrics.barrierIntegrity)}`}
            score={metrics.barrierIntegrity}
            accent="#a78bfa"
            caption={deltaText(barrierDelta, "pts")}
            trend={trendOf(barrierDelta)}
          />
        </motion.div>
        <motion.div variants={item}>
          <MetricCard
            label="Hydration Index"
            value={`${Math.round(metrics.hydrationIndex)}`}
            score={metrics.hydrationIndex}
            accent="#60a5fa"
            caption={deltaText(hydrationDelta, "pts")}
            trend={trendOf(hydrationDelta)}
          />
        </motion.div>
        <motion.div variants={item}>
          <MetricCard
            label="Active Flare-ups"
            value={metrics.activeFlareUps}
            accent="#f472b6"
            caption={deltaText(flareDelta, "", true)}
            // fewer flare-ups is an improvement → invert the trend colour
            trend={flareDelta == null ? "flat" : flareDelta < 0 ? "up" : flareDelta > 0 ? "down" : "flat"}
            icon={<FlareIcon />}
          />
        </motion.div>
        <motion.div variants={item}>
          <MetricCard
            label="Fitzpatrick Tone"
            value={
              <span className="flex items-center gap-2">
                {tone.roman}
                <span
                  className="inline-block h-5 w-5 rounded-full ring-2 ring-white/30"
                  style={{ background: tone.swatch }}
                />
              </span>
            }
            caption="Skin-tone classification"
          />
        </motion.div>
      </motion.section>

      {/* Progression graph */}
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-white/90">Progression</h2>
        <ProgressionChart snapshots={snapshots} />
      </section>

      {/* Routine adjustments */}
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-white/90">
          Routine Adjustments{" "}
          <span className="text-sm font-normal text-white/40">
            · tuned to your current twin state
          </span>
        </h2>
        {routineAdjustments.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {routineAdjustments.map((a, i) => (
              <RoutineAdjustmentCard key={a.id} adjustment={a} index={i} />
            ))}
          </div>
        ) : (
          <div className="glass-panel p-6 text-sm text-white/60">
            No adjustments right now — your routine matches your current skin state.
          </div>
        )}
      </section>
    </div>
  );
}

// --- helpers ---------------------------------------------------------------

function trendOf(delta: number | null): "up" | "down" | "flat" {
  if (delta == null || delta === 0) return "flat";
  return delta > 0 ? "up" : "down";
}

function deltaText(delta: number | null, unit: string, isCount = false): string | undefined {
  if (delta == null) return undefined;
  if (delta === 0) return "No change vs. last";
  const sign = delta > 0 ? "+" : "";
  const val = isCount ? delta : Math.round(delta);
  return `${sign}${val}${unit ? " " + unit : ""} vs. last`;
}

function FlareIcon() {
  return (
    <svg width={28} height={28} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3s4 4 4 8a4 4 0 1 1-8 0c0-1.5.8-3 2-4-.3 2 .5 3 1 3.5.5-1.5 1-3.5 1-7.5Z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}
