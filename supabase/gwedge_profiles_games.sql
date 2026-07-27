-- Gameweek Edge — per-game entry ids on the profile.
--
-- The app now runs against more than one fantasy game, and an FPL manager id
-- is a different number from an FPL Challenge entry id. Each game therefore
-- gets its own column rather than overloading `manager_id`.
--
-- `manager_id` deliberately keeps its name and meaning (Fantasy Premier
-- League), so every existing profile and every already-shipped client keeps
-- working untouched — this migration only ever ADDS.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table public.gwedge_profiles
  add column if not exists challenge_entry_id bigint;

comment on column public.gwedge_profiles.manager_id
  is 'Fantasy Premier League manager id (the number in /entry/<id>/).';
comment on column public.gwedge_profiles.challenge_entry_id
  is 'FPL Challenge entry id. Distinct from manager_id — different game, different number.';

-- No new policies are needed: the existing row-level security on
-- gwedge_profiles is per-row (auth.uid() = user_id), so it already covers
-- every column on that row, including ones added later. Verify rather than
-- assume — this should list RLS enabled plus the owner-only policies:
--
--   select relrowsecurity from pg_class where relname = 'gwedge_profiles';
--   select policyname, cmd, qual from pg_policies where tablename = 'gwedge_profiles';
