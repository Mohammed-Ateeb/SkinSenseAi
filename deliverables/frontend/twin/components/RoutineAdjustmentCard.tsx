"use client";

// Dynamic routine-adjustment card. Content is derived from current twin state
// (lib/deriveRoutine.ts); each item carries the metric that triggered it.
import { motion } from "framer-motion";
import type { RoutineAdjustment } from "../lib/deriveRoutine";

const STEP_LABEL: Record<RoutineAdjustment["step"], string> = {
  cleanse: "Cleanse",
  treat: "Treat",
  moisturize: "Moisturize",
  protect: "Protect",
};

const METRIC_LABEL: Record<RoutineAdjustment["triggeredBy"], string> = {
  barrier_integrity: "Barrier integrity",
  hydration_index: "Hydration index",
  active_flare_ups: "Active flare-ups",
  fitzpatrick_skin_tone: "Skin tone",
};

const PRIORITY_STYLE: Record<RoutineAdjustment["priority"], string> = {
  high: "border-rose-400/40 text-rose-200",
  medium: "border-amber-300/40 text-amber-100",
  low: "border-emerald-300/40 text-emerald-100",
};

export default function RoutineAdjustmentCard({
  adjustment,
  index = 0,
}: {
  adjustment: RoutineAdjustment;
  index?: number;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
      whileHover={{ y: -3 }}
      className="glass-panel flex flex-col gap-3 p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-white/70">
          {STEP_LABEL[adjustment.step]}
        </span>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
            PRIORITY_STYLE[adjustment.priority]
          }`}
        >
          {adjustment.priority}
        </span>
      </div>

      <h3 className="text-base font-semibold text-white">{adjustment.title}</h3>
      <p className="text-sm leading-relaxed text-white/70">{adjustment.rationale}</p>

      <p className="mt-auto pt-1 text-[11px] text-white/45">
        Driven by{" "}
        <span className="text-glass-blue">{METRIC_LABEL[adjustment.triggeredBy]}</span>
      </p>
    </motion.article>
  );
}
