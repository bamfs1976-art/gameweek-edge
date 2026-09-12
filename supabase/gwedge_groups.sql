-- Gameweek Edge — "your own league": a named group of FPL Team IDs a signed-in
-- reader tracks as a league. One row per group per user. The browser reads
-- and writes its own rows with the publishable key and the user's session;
-- RLS keeps every row to its owner. Signed-out readers keep their groups in
-- localStorage, and a signed-in reader's groups also stay local when this
-- table is missing or unreachable.
--
-- Run in the Supabase SQL editor (idempotent). NOT YET APPLIED: apply it as
-- the migration `create_gwedge_groups` and note the date here.

create table if not exists public.gwedge_groups (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null,                 -- the client's group id
  name       text not null default 'My league',
  season     text,
  entries    jsonb not null default '[]'::jsonb,   -- the Team IDs, as numbers
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.gwedge_groups enable row level security;

drop policy if exists "own groups: read"   on public.gwedge_groups;
drop policy if exists "own groups: insert" on public.gwedge_groups;
drop policy if exists "own groups: update" on public.gwedge_groups;
drop policy if exists "own groups: delete" on public.gwedge_groups;
create policy "own groups: read"   on public.gwedge_groups for select using (auth.uid() = user_id);
create policy "own groups: insert" on public.gwedge_groups for insert with check (auth.uid() = user_id);
create policy "own groups: update" on public.gwedge_groups for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own groups: delete" on public.gwedge_groups for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.gwedge_groups to authenticated;
revoke all on table public.gwedge_groups from anon;
