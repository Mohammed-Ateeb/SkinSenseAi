-- Migration 003: Digital Skin Twin
-- Tables:  skin_twins (one current-state row per user)
--          skin_twin_snapshots (chronological history, append-only)
-- RLS:     owner-only, keyed to auth.uid() — matches existing JWKS auth pattern
-- Run after 001_initial_schema.sql and 002_*.sql

-- ── skin_twins ─────────────────────────────────────────────────────────────
-- Stores the current aggregated twin state.  Upserted on every scan / chat
-- feedback event.  One row per user, enforced by the UNIQUE constraint.

create table public.skin_twins (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users(id) on delete cascade,

  -- Skin-tone fingerprint (Fitzpatrick 1–6); NULL until first measurement.
  fitzpatrick_skin_tone smallint    check (fitzpatrick_skin_tone between 1 and 6),

  -- Aggregated indices — exponential moving averages, clamped 0–1.
  hydration_index       numeric(5,4) not null default 0.7000
                                    check (hydration_index  between 0 and 1),
  barrier_integrity     numeric(5,4) not null default 0.8000
                                    check (barrier_integrity between 0 and 1),

  -- Active flare-ups: {condition_name: severity_float (0–1)}.
  -- Only conditions whose EMA confidence exceeds the detection threshold
  -- (0.25) are kept here.  Empty dict == no active flares.
  active_flare_ups      jsonb        not null default '{}',

  -- Highest-severity condition at last update.
  dominant_condition    text,

  -- Running count of scan events that shaped this twin.
  scan_count            int          not null default 0,
  last_scan_at          timestamptz,
  last_updated_at       timestamptz  not null default now(),
  created_at            timestamptz  not null default now(),

  unique (user_id)
);

comment on table public.skin_twins is
  'Current digital skin twin state — one row per user, updated by the twin engine after every scan or chat feedback loop.';

-- ── skin_twin_snapshots ────────────────────────────────────────────────────
-- Append-only chronological record of every twin state change.
-- Each row captures the full metric set at the time of the event plus
-- deltas vs. the previous snapshot for trend visualisation.

create table public.skin_twin_snapshots (
  id                    uuid        primary key default gen_random_uuid(),
  twin_id               uuid        not null references public.skin_twins(id) on delete cascade,
  user_id               uuid        not null references auth.users(id) on delete cascade,

  -- Source analysis result (null for chat-feedback-only events).
  analysis_result_id    uuid        references public.analysis_results(id) on delete set null,

  fitzpatrick_skin_tone smallint    check (fitzpatrick_skin_tone between 1 and 6),
  hydration_index       numeric(5,4) not null check (hydration_index  between 0 and 1),
  barrier_integrity     numeric(5,4) not null check (barrier_integrity between 0 and 1),
  active_flare_ups      jsonb        not null default '{}',
  dominant_condition    text,

  -- Signed deltas vs. the immediately preceding snapshot for this twin.
  -- Shape: {hydration_index: float, barrier_integrity: float,
  --          flare_changes: {condition: delta_float}}
  deltas                jsonb        not null default '{}',

  -- What triggered this snapshot.
  trigger               text         not null check (trigger in ('scan', 'chat_feedback')),
  chat_feedback_summary text,        -- raw user sentiment / symptom text if trigger='chat_feedback'

  created_at            timestamptz  not null default now()
);

comment on table public.skin_twin_snapshots is
  'Chronological twin history — one row per scan or chat-feedback event.  Never updated, only inserted.';

-- Indexes for efficient history queries (dashboard + history pages).
create index skin_twin_snapshots_user_time
  on public.skin_twin_snapshots (user_id, created_at desc);

create index skin_twin_snapshots_twin_time
  on public.skin_twin_snapshots (twin_id, created_at desc);

-- ── Row Level Security ─────────────────────────────────────────────────────

alter table public.skin_twins          enable row level security;
alter table public.skin_twin_snapshots enable row level security;

-- skin_twins: owner-only read + write
create policy "owner: select skin_twins" on public.skin_twins
  for select using (auth.uid() = user_id);

create policy "owner: insert skin_twins" on public.skin_twins
  for insert with check (auth.uid() = user_id);

create policy "owner: update skin_twins" on public.skin_twins
  for update using (auth.uid() = user_id);

-- skin_twin_snapshots: owner-only read + append (no update/delete — intentionally append-only)
create policy "owner: select skin_twin_snapshots" on public.skin_twin_snapshots
  for select using (auth.uid() = user_id);

create policy "owner: insert skin_twin_snapshots" on public.skin_twin_snapshots
  for insert with check (auth.uid() = user_id);

-- ── Grants ─────────────────────────────────────────────────────────────────
-- Matches the pattern from migration 001 (service_role bypass for backend writes).

grant select, insert, update on public.skin_twins          to service_role;
grant select, insert          on public.skin_twin_snapshots to service_role;
grant usage on schema public  to service_role;
