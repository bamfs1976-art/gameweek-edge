-- Gameweek Edge — user feedback submitted from the in-app feedback button.
-- Insert-only, written ONLY by the server (netlify/functions/feedback.js)
-- using the service-role key. RLS is enabled with no policies, so the
-- publishable (anon) key and authenticated users can neither read nor write
-- rows; the service role bypasses RLS. Read it from the Supabase dashboard.
--
-- Run in the Supabase SQL editor (idempotent).
--
-- APPLIED 16 Aug 2026 to project knodunjnsxelmpziupwk, as the migration
-- `create_gwedge_feedback`. Kept here as the source of truth: the file is what
-- was run, so a fresh environment can be brought up from it.
--
-- UNTIL THIS RUNS, the feedback button does not work — and it says so rather
-- than pretending. /api/feedback returns 503 when the table is missing and
-- the app tells the user their message was NOT saved, keeps their text on
-- screen and offers to copy it out. That is deliberate: a feedback form that
-- silently discards messages is worse than no feedback form.

create table if not exists public.gwedge_feedback (
  id       bigint generated always as identity primary key,
  message  text not null,
  kind     text not null default 'other',   -- bug | idea | data | praise | other
  -- Optional, and only ever what the user typed into the reply-to field.
  -- Null both when they left it blank and when what they typed could not be
  -- an address; the flag below keeps those two apart, so a reply that cannot
  -- be sent is visible rather than silently skipped.
  email    text,
  email_given_but_unusable boolean not null default false,
  page     text,                            -- which panel they were on
  app      text,                            -- short client hint, for repro
  anon_id  text,                            -- the same random id analytics uses
  ua       text,
  ts       timestamptz not null default now()
);

-- The two reads this table actually gets: newest first, and by kind.
create index if not exists gwedge_feedback_ts on public.gwedge_feedback (ts desc);
create index if not exists gwedge_feedback_kind_ts on public.gwedge_feedback (kind, ts desc);

alter table public.gwedge_feedback enable row level security;

-- No policies on purpose: only the service role (which bypasses RLS) may
-- touch this table. Feedback can contain anything a user chooses to write
-- about themselves, so it must never be readable with the browser's key.
revoke all on table public.gwedge_feedback from anon, authenticated;
