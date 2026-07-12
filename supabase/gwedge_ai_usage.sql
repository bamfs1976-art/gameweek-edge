-- Gameweek Edge — per-user daily AI usage metering.
-- Written to and read from ONLY by the server (netlify/functions/ai.js)
-- using the service-role key. RLS is enabled with no policies, so the
-- publishable (anon) key and authenticated users can neither read nor
-- write rows; the service role bypasses RLS.
--
-- Run in the Supabase SQL editor (idempotent).

create table if not exists public.gwedge_ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null default (now() at time zone 'utc')::date,
  count   integer not null default 0,
  primary key (user_id, day)
);

alter table public.gwedge_ai_usage enable row level security;

-- No policies on purpose: only the service role (which bypasses RLS)
-- may touch this table. Revoke the default grants for belt and braces.
revoke all on table public.gwedge_ai_usage from anon, authenticated;
