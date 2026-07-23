-- Gameweek Edge — model prediction log (the calibration loop, P5).
-- One row per (gameweek, player) capturing what the model forecast, so a
-- later job can grade it against the actual return and surface calibration
-- on the Model Accountability page. This is MODEL analytics (not per-user
-- personalisation), so like gwedge_events / gwedge_ai_usage it is written
-- and read ONLY by the server (a scheduled Netlify function) using the
-- service-role key. RLS is enabled with no policies, so the publishable
-- (anon) key and authenticated users can neither read nor write; the
-- service role bypasses RLS.
--
-- Run in the Supabase SQL editor (idempotent).

create table if not exists public.gwedge_predictions (
  gw         integer not null,
  element    integer not null,
  xp         real    not null,          -- predicted expected points
  haul_prob  real,                      -- P(>=10)
  blank_prob real,                      -- P(<=2)
  actual     integer,                   -- filled in when the gameweek finishes
  created_at timestamptz not null default now(),
  primary key (gw, element)
);

create index if not exists gwedge_predictions_gw on public.gwedge_predictions (gw);

alter table public.gwedge_predictions enable row level security;

-- No policies on purpose: only the service role (which bypasses RLS) may
-- touch this table. Revoke the default grants for belt and braces.
revoke all on table public.gwedge_predictions from anon, authenticated;
