-- Gameweek Edge — sign-ups and Pro conversions by channel, by week.
--
-- The client stores the ?src= tag a device first arrived with
-- (x, reddit, threads, bluesky, linkedin, email, creator, seo) and
-- netlify/functions/track.js writes it into gwedge_events.props->>'src'
-- on every event. This view groups the two events that matter for
-- distribution — sign_up and checkout_success (a paid Pro subscription
-- confirmed on return from Stripe) — plus first opens, per ISO week.
--
-- Read it in the Supabase dashboard (SQL editor or Table editor → Views):
--   select * from gwedge_attribution_weekly order by week desc, src;
--
-- 'direct' means the device carried no tag: a typed URL, a bookmark, an
-- untagged share. Run in the SQL editor; safe to re-run.

create or replace view public.gwedge_attribution_weekly as
select
  date_trunc('week', ts)::date                                as week,
  coalesce(props->>'src', 'direct')                            as src,
  count(distinct anon_id) filter (where event = 'app_open')    as first_opens,
  count(*)                filter (where event = 'team_linked') as teams_linked,
  count(*)                filter (where event = 'sign_up')     as sign_ups,
  count(*)                filter (where event = 'checkout_started') as checkouts_started,
  count(*)                filter (where event = 'checkout_success') as pro_conversions
from public.gwedge_events
group by 1, 2
order by 1 desc, 2;

comment on view public.gwedge_attribution_weekly is
  'Gameweek Edge: first opens, team links, sign-ups, checkouts and Pro conversions by acquisition channel (?src=) per ISO week. direct = untagged.';

-- The events table has RLS with no policies, so only the service role and
-- the dashboard (postgres) can read this. No grant to anon or authenticated
-- is made here on purpose.
