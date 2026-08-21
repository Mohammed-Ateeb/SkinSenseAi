# History Drill-in — `/history/[id]`

Delivered by Angela (T7). Drop-in module for the Next.js frontend (App Router, TypeScript, Tailwind).

## Files

```
deliverables/frontend/history/
├── app/history/[id]/page.tsx        ← Server Component — copy to skinsense-frontend/src/app/history/[id]/page.tsx
└── components/
    ├── MetricRing.tsx               ← SVG circular progress ring (0–1 value)
    ├── ConditionBar.tsx             ← Horizontal confidence bars for CNN predictions
    ├── ChatHistoryPanel.tsx         ← Read-only chat transcript (llm_explanation + persisted follow-ups)
    └── ProgressionCard.tsx          ← Delta indicators vs prior scan
```

## Copy targets (relative to skinsense-frontend/src/)

| Deliverable file | Paste into |
|---|---|
| `app/history/[id]/page.tsx` | `app/history/[id]/page.tsx` |
| `components/MetricRing.tsx` | `components/MetricRing.tsx` |
| `components/ConditionBar.tsx` | `components/ConditionBar.tsx` |
| `components/ChatHistoryPanel.tsx` | `components/ChatHistoryPanel.tsx` |
| `components/ProgressionCard.tsx` | `components/ProgressionCard.tsx` |

## Dependencies

All already in the existing frontend:
- `@supabase/ssr` — server-side cookie-session client
- `@supabase/supabase-js` — client types
- `next/navigation` (notFound, redirect)
- `next/link`

No new packages required.

## Database tables queried

| Table | Purpose |
|---|---|
| `analysis_results` | primary condition, predictions jsonb, llm_explanation |
| `uploaded_images` | linked via image_id (ownership check) |
| `skin_twin_snapshots` | hydration_index, barrier_integrity, deltas (Pam/T4) |

RLS enforces ownership on all tables. The page also does an explicit `user_id` check as belt-and-suspenders.

## Data contracts

**`analysis_results.predictions`** — two accepted shapes:

```json
// Standard (CNN top-3):
[{"condition": "hormonal_acne", "confidence": 0.82}, ...]

// Extended (with persisted chat history):
{
  "conditions": [{"condition": "hormonal_acne", "confidence": 0.82}],
  "chat_history": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ]
}
```

The page handles both. If `predictions` is a plain array, `chat_history` defaults to empty (only `llm_explanation` is shown as the initial assistant message).

## Coordination with Jim (T6 — Digital Twin dashboard)

The `MetricRing` component is self-contained here. If Jim creates a `MetricRing` in `deliverables/frontend/twin/`, reconcile them into a shared `components/ui/MetricRing.tsx` during integration — the props interface (`value: number, label: string, color: string, size?: number`) is intentionally compatible.

## Middleware

`/history/:path*` is already protected in the existing `middleware.ts` — no changes needed.

## Environment variables (no additions needed)

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```
