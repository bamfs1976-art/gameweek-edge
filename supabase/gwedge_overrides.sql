-- Gameweek Edge — a Pro manager's own team news, synced across devices.
-- One row per player per season per user: "out" (until a date, or until
-- cleared) or "benched" (lost his place). The browser reads and writes its
-- own rows with the publishable key and the user's session; RLS keeps every
-- row to its owner. A cleared override is kept as kind 'clear' so a device
-- that still holds the old note learns it was cleared, rather than pushing
-- it back up (newest updated_at wins on merge).
--
-- These rows never reach the model record, the prediction logger or the MCP
-- tools: they change only the projections their owner sees.
--
-- Run in the Supabase SQL editor (idempotent). NOT YET APPLIED: until it is,
-- overrides save on the device and the player card says so.

create table if not exists public.gwedge_overrides (
  user_id    uuid not null references auth.users (id) on delete cascade,
  season     text not null,                 -- e.g. 2026/27; overrides do not cross seasons
  element_id integer not null,              -- FPL player id
  kind       text not null check (kind in ('out', 'benched', 'clear')),
  until      date,                          -- first day he is expected back; null = until cleared
  updated_at timestamptz not null default now(),
  primary key (user_id, season, element_id)
);

alter table public.gwedge_overrides enable row level security;

drop policy if exists "own overrides: read"   on public.gwedge_overrides;
drop policy if exists "own overrides: insert" on public.gwedge_overrides;
drop policy if exists "own overrides: update" on public.gwedge_overrides;
drop policy if exists "own overrides: delete" on public.gwedge_overrides;
create policy "own overrides: read"   on public.gwedge_overrides for select using (auth.uid() = user_id);
create policy "own overrides: insert" on public.gwedge_overrides for insert with check (auth.uid() = user_id);
create policy "own overrides: update" on public.gwedge_overrides for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own overrides: delete" on public.gwedge_overrides for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.gwedge_overrides to authenticated;
revoke all on table public.gwedge_overrides from anon;
