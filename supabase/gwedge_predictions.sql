-- Gameweek Edge — model prediction log (the calibration loop, P5).
-- One row per (season, gameweek, player) capturing what the model forecast,
-- so a later job can grade it against the actual return and surface
-- calibration on the Model Accountability page. This is MODEL analytics
-- (not per-user personalisation), so like gwedge_events / gwedge_ai_usage it
-- is written and read ONLY by the server (a scheduled Netlify function)
-- using the service-role key. RLS is enabled with no policies, so the
-- publishable (anon) key and authenticated users can neither read nor write;
-- the service role bypasses RLS.
--
-- The `season` column is essential: FPL renumbers gameweeks from 1 every
-- August, so without it the new season's GW1 predictions would collide with
-- (and overwrite the graded actuals of) last season's GW1 rows.
--
-- Run in the Supabase SQL editor (idempotent — safe to re-run).

create table if not exists public.gwedge_predictions (
  season     text    not null default '2025/26',
  gw         integer not null,
  element    integer not null,
  xp         real    not null,          -- predicted expected points
  haul_prob  real,                      -- P(>=10)
  blank_prob real,                      -- P(<=2)
  actual     integer,                   -- filled in when the gameweek finishes
  created_at timestamptz not null default now(),
  primary key (season, gw, element)
);

-- Migrate an existing table created before the season column existed:
-- add the column (defaulting old rows to 2025/26) and swap the primary key
-- from (gw, element) to (season, gw, element).
alter table public.gwedge_predictions
  add column if not exists season text not null default '2025/26';

do $$
begin
  -- Drop a legacy (gw, element) primary key if that is what is in place.
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.gwedge_predictions'::regclass and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (gw, element)'
  ) then
    alter table public.gwedge_predictions drop constraint gwedge_predictions_pkey;
  end if;
  -- Add the (season, gw, element) primary key if no primary key exists yet.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.gwedge_predictions'::regclass and contype = 'p'
  ) then
    alter table public.gwedge_predictions
      add constraint gwedge_predictions_pkey primary key (season, gw, element);
  end if;
end $$;

create index if not exists gwedge_predictions_gw on public.gwedge_predictions (gw);
create index if not exists gwedge_predictions_season on public.gwedge_predictions (season);

alter table public.gwedge_predictions enable row level security;

-- No policies on purpose: only the service role (which bypasses RLS) may
-- touch this table. Revoke the default grants for belt and braces.
revoke all on table public.gwedge_predictions from anon, authenticated;
