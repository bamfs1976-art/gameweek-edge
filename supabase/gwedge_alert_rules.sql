-- Gameweek Edge — per-user alert rules / preferences.
-- User-facing: read and written by the CLIENT with the publishable (anon)
-- key under the signed-in user's own session (unlike gwedge_events /
-- gwedge_ai_usage, which are service-role only). Row Level Security
-- enforces the user-owns-rows pattern, so a manager can only ever see and
-- change their own row — the same model already used for gwedge_watchlist,
-- gwedge_rivals and gwedge_profiles.
--
-- Run in the Supabase SQL editor (idempotent).

create table if not exists public.gwedge_alert_rules (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  rules      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.gwedge_alert_rules enable row level security;

-- user-owns-rows: the authenticated user may only touch their own row.
drop policy if exists gwedge_alert_rules_select on public.gwedge_alert_rules;
create policy gwedge_alert_rules_select on public.gwedge_alert_rules
  for select using (auth.uid() = user_id);

drop policy if exists gwedge_alert_rules_insert on public.gwedge_alert_rules;
create policy gwedge_alert_rules_insert on public.gwedge_alert_rules
  for insert with check (auth.uid() = user_id);

drop policy if exists gwedge_alert_rules_update on public.gwedge_alert_rules;
create policy gwedge_alert_rules_update on public.gwedge_alert_rules
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists gwedge_alert_rules_delete on public.gwedge_alert_rules;
create policy gwedge_alert_rules_delete on public.gwedge_alert_rules
  for delete using (auth.uid() = user_id);

-- The anon (signed-out) role gets nothing; authenticated users act only on
-- their own row via the policies above.
revoke all on table public.gwedge_alert_rules from anon;
grant select, insert, update, delete on table public.gwedge_alert_rules to authenticated;
