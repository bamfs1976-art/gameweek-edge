-- Gameweek Edge — first-party analytics events.
-- Insert-only, written ONLY by the server (netlify/functions/track.js)
-- using the service-role key. RLS is enabled with no policies, so the
-- publishable (anon) key and authenticated users can neither read nor
-- write rows; the service role bypasses RLS. Query it from the Supabase
-- dashboard / SQL editor.
--
-- Run in the Supabase SQL editor (idempotent).

create table if not exists public.gwedge_events (
  id      bigint generated always as identity primary key,
  event   text not null,
  props   jsonb,
  anon_id text,
  ua      text,
  ts      timestamptz not null default now()
);

create index if not exists gwedge_events_event_ts on public.gwedge_events (event, ts);

alter table public.gwedge_events enable row level security;

-- No policies on purpose: only the service role (which bypasses RLS)
-- may touch this table. Revoke the default grants for belt and braces.
revoke all on table public.gwedge_events from anon, authenticated;
