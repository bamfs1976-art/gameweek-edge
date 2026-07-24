-- Gameweek Edge — FPL Core Insights advanced-stats mirror.
-- Per-player, season-aggregated Opta-like metrics that the official FPL API
-- does NOT expose — sourced from the open FPL-Core-Insights dataset
-- (https://github.com/olbauday/FPL-Core-Insights, CC-style "use freely,
-- link back" terms) and keyed by the official FPL element id so the app can
-- merge them straight onto its player objects.
--
-- The headline field is `goals_prevented` (post-shot xG faced minus goals
-- conceded — a keeper's shot-stopping above expectation), which sharpens the
-- goalkeeper term in nativeXP well beyond a raw save count. The rest add
-- finishing quality (xgot, big_chances_missed), open-play threat
-- (non-penalty xG) and involvement (chances_created, touches in the box).
--
-- Like gwedge_predictions this is MODEL analytics, not per-user data, so it is
-- written by a scheduled Netlify function and read publicly, both with the
-- service-role key. RLS is on with NO policies: anon / authenticated cannot
-- touch it; the service role bypasses RLS.
--
-- The `season` column matters because FPL renumbers players every August; the
-- aggregator targets the latest season that has match data (pre-season that is
-- last season, which is exactly the right prior for GW1 projections).
--
-- Run in the Supabase SQL editor (idempotent — safe to re-run).

create table if not exists public.gwedge_core_insights (
  season                 text    not null,
  element                integer not null,          -- official FPL element id
  games                  integer not null default 0,-- matches with minutes > 0
  minutes                integer not null default 0,
  goals_prevented        real,                       -- Σ post-shot xG faced − goals conceded (GK)
  goals_prevented_per_90 real,
  xgot_faced             real,                       -- Σ xG on target faced (GK)
  saves                  integer,
  goals_conceded         integer,
  xg                     real,                       -- Σ expected goals
  xgot                   real,                       -- Σ xG on target (finishing quality, attackers)
  np_xg                  real,                       -- Σ non-penalty xG (open-play threat)
  np_xg_per_90           real,
  big_chances_missed     integer,
  chances_created        integer,
  touches_opp_box        integer,                    -- Σ touches in opposition box
  touches_opp_box_per_90 real,
  penalties              integer,                    -- scored + missed (context for np_xg)
  updated_at             timestamptz not null default now(),
  primary key (season, element)
);

create index if not exists gwedge_core_insights_season on public.gwedge_core_insights (season);

alter table public.gwedge_core_insights enable row level security;

-- No policies on purpose: only the service role (which bypasses RLS) may read
-- or write. Revoke the default grants for belt and braces.
revoke all on table public.gwedge_core_insights from anon, authenticated;
