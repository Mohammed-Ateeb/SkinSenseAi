// Derive routine-adjustment cards from the CURRENT twin state.
//
// Pam's locked twin shape carries no routine-adjustments field, so the dashboard
// derives them here from live metrics (a small, transparent rules engine). Each
// suggestion records which metric triggered it so the UI can show the "driven by"
// chip. Keep this the single source of routine logic; if the backend later emits
// adjustments directly, swap this call for that payload.
import type { DigitalTwin } from "@/types/twin";
import { activeFlareList } from "@/types/twin";

export type RoutineStep = "cleanse" | "treat" | "moisturize" | "protect";
export type Priority = "high" | "medium" | "low";

export interface RoutineAdjustment {
  id: string;
  title: string;
  rationale: string;
  step: RoutineStep;
  priority: Priority;
  triggeredBy: "hydration_index" | "barrier_integrity" | "active_flare_ups" | "fitzpatrick_skin_tone";
}

export function deriveRoutineAdjustments(twin: DigitalTwin): RoutineAdjustment[] {
  const out: RoutineAdjustment[] = [];
  const pct = (v: number) => Math.round(v * 100);

  // Barrier integrity ------------------------------------------------------
  if (twin.barrier_integrity < 0.75) {
    out.push({
      id: "barrier-ceramide",
      title: "Add a ceramide moisturizer at night",
      rationale: `Barrier integrity is ${pct(
        twin.barrier_integrity
      )}%. Ceramides reinforce the lipid barrier and reduce trans-epidermal water loss while it recovers.`,
      step: "moisturize",
      priority: twin.barrier_integrity < 0.55 ? "high" : "medium",
      triggeredBy: "barrier_integrity",
    });
  }

  // Hydration --------------------------------------------------------------
  if (twin.hydration_index < 0.7) {
    out.push({
      id: "hydration-ha",
      title: "Layer a hyaluronic acid serum on damp skin",
      rationale: `Hydration index is ${pct(
        twin.hydration_index
      )}%. Applying HA to damp skin before moisturizer draws more water into the stratum corneum.`,
      step: "treat",
      priority: twin.hydration_index < 0.5 ? "high" : "medium",
      triggeredBy: "hydration_index",
    });
  }

  // Active flare-ups -------------------------------------------------------
  const flares = activeFlareList(twin.active_flare_ups);
  if (flares.length > 0) {
    const top = flares[0];
    out.push({
      id: "flare-target",
      title: `Introduce a targeted treatment for ${prettyCondition(top.condition)}`,
      rationale: `${prettyCondition(top.condition)} is your most active flare-up (${pct(
        top.severity
      )}% severity). Add a low-strength, condition-appropriate active a few nights a week and monitor tolerance.`,
      step: "treat",
      priority: top.severity >= 0.6 ? "high" : "medium",
      triggeredBy: "active_flare_ups",
    });
  }

  // Skin tone / photoprotection -------------------------------------------
  const pihRisk = twin.fitzpatrick_skin_tone >= 4 && flares.length > 0;
  out.push({
    id: "spf",
    title: "Keep a broad-spectrum SPF 30+ every morning",
    rationale: pihRisk
      ? `With Fitzpatrick ${roman(
          twin.fitzpatrick_skin_tone
        )} skin and active flare-ups, consistent UV protection is the strongest defence against post-inflammatory hyperpigmentation.`
      : "Daily SPF locks in the gains from the rest of your routine and prevents UV-driven barrier and pigment damage.",
    step: "protect",
    priority: pihRisk ? "high" : "low",
    triggeredBy: "fitzpatrick_skin_tone",
  });

  // Highest priority first.
  const rank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.priority] - rank[b.priority]);
}

function prettyCondition(c: string): string {
  return c.replace(/[_-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function roman(t: number): string {
  return ["", "I", "II", "III", "IV", "V", "VI"][t] ?? String(t);
}
