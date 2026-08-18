// Sample twin payload matching the ASSUMED shape — for local preview / Storybook
// before Pam's real T4 JSON lands. Not used in production paths.
import type { DigitalTwin } from "./types";

export const mockTwin: DigitalTwin = {
  userId: "demo-user",
  updatedAt: new Date().toISOString(),
  metrics: {
    barrierIntegrity: 72,
    hydrationIndex: 64,
    activeFlareUps: 2,
    fitzpatrickTone: 4,
  },
  snapshots: [
    { date: "2026-06-20", barrierIntegrity: 55, hydrationIndex: 48, activeFlareUps: 5 },
    { date: "2026-07-04", barrierIntegrity: 60, hydrationIndex: 52, activeFlareUps: 4 },
    { date: "2026-07-18", barrierIntegrity: 63, hydrationIndex: 58, activeFlareUps: 4 },
    { date: "2026-08-01", barrierIntegrity: 68, hydrationIndex: 61, activeFlareUps: 3 },
    { date: "2026-08-15", barrierIntegrity: 72, hydrationIndex: 64, activeFlareUps: 2 },
  ],
  routineAdjustments: [
    {
      id: "adj-1",
      title: "Add a ceramide moisturizer at night",
      rationale:
        "Barrier integrity is recovering but still under 75. Ceramides reinforce the lipid barrier and lock in the hydration gains from the last two snapshots.",
      step: "moisturize",
      priority: "high",
      triggeredBy: "barrierIntegrity",
    },
    {
      id: "adj-2",
      title: "Layer a hyaluronic acid serum on damp skin",
      rationale:
        "Hydration index sits at 64. Applying HA to damp skin before moisturizer pulls more water into the stratum corneum.",
      step: "treat",
      priority: "medium",
      triggeredBy: "hydrationIndex",
    },
    {
      id: "adj-3",
      title: "Keep a mineral SPF 30+ every morning",
      rationale:
        "With Fitzpatrick IV skin and healing flare-ups, consistent UV protection prevents post-inflammatory hyperpigmentation.",
      step: "protect",
      priority: "medium",
      triggeredBy: "fitzpatrickTone",
    },
  ],
};
