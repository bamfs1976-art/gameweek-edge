-- Gameweek Edge — email and Telegram alerts: who wants what, where.
-- One row per signed-in user. The browser reads and writes its own row with
-- the publishable key; RLS keeps every row to its owner.
--
-- telegram_chat_id is NOT writable from the browser (column grants below):
-- it is set only by netlify/functions/telegram-webhook.js, with the service
-- key, when the user sends the bot the one-time link_code the app showed
-- them. Otherwise anyone could point their alerts at someone else's chat.
-- Email goes to the account's own address, read server-side from auth.
--
-- Run in the Supabase SQL editor (idempotent).
--
-- APPLIED 2 Oct 2026 to project knodunjnsxelmpziupwk (RLS and the revoke in
-- the same transaction as the create, then policies and grants). Verified:
-- four policies, no anon access, telegram_chat_id not writable by users.

create table if not exists public.gwedge_alert_channels (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  email_on         boolean not null default false,
  telegram_on      boolean not null default false,
  telegram_chat_id bigint,                         -- server-written only
  link_code        text,                           -- one-time code for the bot, cleared once used
  windows          jsonb not null default '{"d24": true, "d6": true, "d1": true}'::jsonb,
  flags_on         boolean not null default false, -- Pro: your squad's new fitness flags
  manager_id       integer,                        -- FPL team, for the squad alerts
  updated_at       timestamptz not null default now()
);

alter table public.gwedge_alert_channels enable row level security;

drop policy if exists "own channels: read"   on public.gwedge_alert_channels;
drop policy if exists "own channels: insert" on public.gwedge_alert_channels;
drop policy if exists "own channels: update" on public.gwedge_alert_channels;
drop policy if exists "own channels: delete" on public.gwedge_alert_channels;
create policy "own channels: read"   on public.gwedge_alert_channels for select using ((select auth.uid()) = user_id);
create policy "own channels: insert" on public.gwedge_alert_channels for insert with check ((select auth.uid()) = user_id);
create policy "own channels: update" on public.gwedge_alert_channels for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own channels: delete" on public.gwedge_alert_channels for delete using ((select auth.uid()) = user_id);

revoke all on table public.gwedge_alert_channels from anon, authenticated;
grant select, delete on table public.gwedge_alert_channels to authenticated;
grant insert (user_id, email_on, telegram_on, link_code, windows, flags_on, manager_id, updated_at)
  on table public.gwedge_alert_channels to authenticated;
grant update (email_on, telegram_on, link_code, windows, flags_on, manager_id, updated_at)
  on table public.gwedge_alert_channels to authenticated;
