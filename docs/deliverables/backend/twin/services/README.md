# Digital Skin Twin — Backend Service

## Files

| File | Purpose |
|---|---|
| `twin.py` | State aggregation engine — the only file to import |
| `../../migrations/003_digital_twin.sql` | Supabase migration (run first) |

---

## Database tables (003_digital_twin.sql)

### `skin_twins` — current state, one row per user

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → auth.users; unique; RLS key |
| `fitzpatrick_skin_tone` | smallint 1–6 | null until first measurement |
| `hydration_index` | numeric(5,4) | 0.0–1.0; EMA of scan history |
| `barrier_integrity` | numeric(5,4) | 0.0–1.0; EMA of scan history |
| `active_flare_ups` | jsonb | `{condition: severity}` |
| `dominant_condition` | text | highest-severity condition |
| `scan_count` | int | running total |
| `last_scan_at` | timestamptz | |
| `last_updated_at` | timestamptz | |
| `created_at` | timestamptz | |

### `skin_twin_snapshots` — append-only history

Same metric columns as above plus:

| Column | Type | Notes |
|---|---|---|
| `twin_id` | uuid | FK → skin_twins |
| `analysis_result_id` | uuid | FK → analysis_results (null for chat-only events) |
| `deltas` | jsonb | `{hydration_index, barrier_integrity, flare_changes}` |
| `trigger` | text | `'scan'` or `'chat_feedback'` |
| `chat_feedback_summary` | text | raw user text when trigger=chat_feedback |

---

## Twin API object (JSON shape)

This is what `update_twin()` returns and what `/analyze` attaches to its response.  
Jim (T6 — dashboard) and Angela (T7 — history) should type against this.

```json
{
  "twin_id":              "uuid",
  "user_id":              "uuid",
  "fitzpatrick_skin_tone": 3,
  "hydration_index":      0.6240,
  "barrier_integrity":    0.7510,
  "active_flare_ups": {
    "eczema":   0.4120,
    "rosacea":  0.2800
  },
  "dominant_condition":   "eczema",
  "scan_count":           7,
  "last_scan_at":         "2026-08-18T10:00:00+00:00",
  "last_updated_at":      "2026-08-18T10:00:00+00:00",
  "created_at":           "2026-07-01T09:00:00+00:00",
  "snapshot_id":          "uuid",
  "deltas": {
    "hydration_index":    0.0350,
    "barrier_integrity": -0.0210,
    "flare_changes": {
      "eczema":  -0.1150,
      "rosacea":  0.0300
    }
  }
}
```

Supabase direct queries:

```sql
-- Current state
select * from skin_twins where user_id = auth.uid();

-- History (newest first, last 30 snapshots)
select * from skin_twin_snapshots
where user_id = auth.uid()
order by created_at desc
limit 30;
```

---

## Wiring into /analyze

```python
# app/routes/analyze.py  (add after the existing analysis_results insert)
from twin.services.twin import PredictResult, ConditionScore, ChatFeedback, update_twin

# ... existing analyze logic ...

twin_state = update_twin(
    db=supabase,               # service-role client from app/supabase_client.py
    user_id=user.id,           # from get_current_user() dependency
    predict_result=PredictResult(
        image_id=predict_resp["image_id"],
        analysis_result_id=analysis_result_id,
        model_version=predict_resp["model_version"],
        predictions=[ConditionScore(**p) for p in predict_resp["predictions"]],
        primary_condition=predict_resp["primary_condition"],
    ),
    # Optional: pass the most recent /chat turn's parsed feedback
    chat_feedback=ChatFeedback(trend="improving", raw_text="skin feels less dry today"),
)

return {
    **existing_analyze_response,
    "twin": twin_state.__dict__,
}
```

No new FastAPI route is needed — the twin update is a side-effect of `/analyze`.  
The only new data the frontend gets is the `"twin"` key in the `/analyze` response.

---

## Metric logic

| Metric | Formula |
|---|---|
| `hydration_index` | `EMA(prev, 1 − 0.6·eczema − 0.4·psoriasis) + trend_nudge` |
| `barrier_integrity` | `EMA(prev, 1 − 0.4·eczema − 0.3·psoriasis − 0.2·rosacea − 0.1·seb_ker) + trend_nudge` |
| `active_flare_ups` | Per-condition EMA; dropped when EMA falls below 0.25 |
| EMA alpha | 0.35 (new obs weight); tune in `twin.py:_EMA_ALPHA` |
| Chat nudge | ±0.03 hydration, ±0.02 barrier for improving/worsening trends |
