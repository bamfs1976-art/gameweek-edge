-- Gameweek Edge — the six-week Team Planner's named drafts, synced for Pro.
-- One row per draft per user. The browser reads and writes its own rows
-- with the publishable key and the user's session; RLS keeps every row to
-- its owner. Free readers never touch this table: their one plan stays in
-- localStorage, and a Pro reader's drafts also stay local when this table
-- is missing or unreachable (the planner says "saved on this device").
--
-- Run in the Supabase SQL editor (idempotent). NOT YET APPLIED: apply it
-- as the migration `create_gwedge_plans` and note the date here.

create table if not exists public.gwedge_plans (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null,                 -- the client's draft id
  name       text not null default 'My plan',
  season     text,                          -- e.g. 2026/27; drafts do not cross seasons
  plan       jsonb not null,                -- squad, bank, free transfers, per-gameweek moves
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.gwedge_plans enable row level security;

drop policy if exists "own plans: read"   on public.gwedge_plans;
drop policy if exists "own plans: insert" on public.gwedge_plans;
drop policy if exists "own plans: update" on public.gwedge_plans;
drop policy if exists "own plans: delete" on public.gwedge_plans;
create policy "own plans: read"   on public.gwedge_plans for select using (auth.uid() = user_id);
create policy "own plans: insert" on public.gwedge_plans for insert with check (auth.uid() = user_id);
create policy "own plans: update" on public.gwedge_plans for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own plans: delete" on public.gwedge_plans for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.gwedge_plans to authenticated;
revoke all on table public.gwedge_plans from anon;
