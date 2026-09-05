-- Gameweek Edge — display mode, synced per user.
--
-- Adds one column to the existing profiles table: the user's chosen
-- display mode, 'simple' (five panels in the rail plus More) or
-- 'terminal' (every panel). The client keeps the device's own choice in
-- localStorage as the working copy and writes it here on sign-in and on
-- every change, so a manager who signs in on a second device gets the mode
-- they chose on the first.
--
-- Safe to run more than once. The client reads this column in its own
-- guarded query, so a project that has not run this file loses nothing but
-- the sync. RLS on gwedge_profiles is unchanged: the row is still the
-- user's own (auth.uid() = user_id).

alter table public.gwedge_profiles
  add column if not exists display_mode text
  check (display_mode is null or display_mode in ('simple', 'terminal'));

comment on column public.gwedge_profiles.display_mode is
  'Gameweek Edge display mode: simple (five panels + More) or terminal (every panel). Null means the device default, which is simple.';
