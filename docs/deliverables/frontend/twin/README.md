# Digital Twin Dashboard (T6)

Production-ready Next.js (App Router, TS, Tailwind v4) dashboard for the SkinSense AI
**Digital Twin**, matching the existing glassmorphism theme (`.glass-panel`,
`glass-purple`/`glass-blue` tokens, purple→blue gradient, Framer Motion).

## What's here

| File | Role |
|------|------|
| `types.ts` | Twin domain types. **⚠️ Assumed shape** — see below. |
| `lib/supabaseServer.ts` | Cookie-session Supabase client (`@supabase/ssr`, `cookies()`). |
| `lib/fetchTwin.ts` | Server-only fetch layer: reads the signed-in user's twin under RLS. |
| `components/DigitalTwinDashboard.tsx` | Top-level view (metric cards + graph + adjustments). |
| `components/MetricCard.tsx` | Interactive glass tile w/ radial gauge. |
| `components/ProgressionChart.tsx` | Dependency-free SVG line chart (toggleable series). |
| `components/RoutineAdjustmentCard.tsx` | State-driven routine-adjustment card. |
| `mock.ts` | Sample payload for local preview / Storybook. |
| `page.example.tsx` | Example server route wiring the fetch → dashboard. |

## Mapping into `skinsense-frontend/src/`

```
deliverables/frontend/twin/
  types.ts                       → src/app/twin/types.ts   (or src/lib/twin/types.ts)
  lib/supabaseServer.ts          → src/lib/supabaseServer.ts   (reuse if you already have one)
  lib/fetchTwin.ts               → src/lib/fetchTwin.ts
  components/*.tsx                → src/app/twin/components/*  (or src/components/twin/*)
  page.example.tsx               → src/app/twin/page.tsx      (rename, drop ".example")
  mock.ts                        → keep out of prod bundle (dev/story only)
```

Import paths in the files are **relative** so they work as-dropped; switch to your
`@/` alias if preferred.

## Install

Uses what the app already has (`framer-motion`, `@supabase/supabase-js`). One likely
addition for the cookie-session server client:

```bash
npm install @supabase/ssr
```

Charts are hand-rolled SVG — **no charting dependency added**. If the project later
adopts `recharts`, `ProgressionChart.tsx` can be swapped without touching its callers.

Env vars are the existing ones: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Data flow

`page.tsx` (Server Component) → `fetchDigitalTwin()` reads the Supabase **cookie
session** (runs as the logged-in user, RLS-safe) → passes a resolved `DigitalTwin`
to `<DigitalTwinDashboard>` (Client Component). No service key ever reaches the client.

## ⚠️ Assumed twin shape — pending Pam (T4)

This is **BLOCKED** on Pam's real twin JSON. Everything is scaffolded against the
documented assumption in `types.ts`, isolated so only two files change when the real
shape arrives:

1. **`types.ts`** — the `DigitalTwin` interface.
2. **`lib/fetchTwin.ts`** — table/column names (`digital_twins`, `twin_snapshots`) and
   the `mapTwinRow` mapping.

Assumed today:
- `digital_twins` row per user: `barrier_integrity`, `hydration_index`,
  `active_flare_ups` (0–100 / count), `fitzpatrick_tone` (1–6),
  `routine_adjustments` (JSON array), `updated_at`.
- `twin_snapshots` history rows: `date`, `barrier_integrity`, `hydration_index`,
  `active_flare_ups`, ordered chronologically.

The **components** consume `types.ts` only, so once Pam's shape is relayed the UI
needs no structural change — just remap in `fetchTwin.ts`.
