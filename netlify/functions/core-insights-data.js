/* Gameweek Edge — FPL Core Insights public read.
   Serves the aggregated advanced-stats mirror (public.gwedge_core_insights)
   as compact JSON keyed by the official FPL element id, so the app can merge
   Opta-like metrics — the headline being goalkeeper `goals_prevented` — onto
   its player objects. Model analytics only (no user data), read with the
   service-role key and cached at the edge.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Returns {configured:false}
   when unset, so the client simply keeps using official data. */

const json = (o, maxAge) => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=' + (maxAge || 21600) + ', stale-while-revalidate=43200',
  },
  body: JSON.stringify(o),
});

exports.handler = async () => {
  const supaUrl = process.env.SUPABASE_URL, supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return json({ configured: false, players: {} }, 300);

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  /* Latest season present (gameweek numbers repeat every year, so never mix). */
  const { data: seasons, error: sErr } = await sb.from('gwedge_core_insights')
    .select('season').order('season', { ascending: false }).limit(1);
  if (sErr || !seasons || !seasons.length) return json({ configured: true, players: {} }, 600);
  const season = seasons[0].season;

  const { data, error } = await sb.from('gwedge_core_insights')
    .select('element,games,minutes,goals_prevented,goals_prevented_per_90,xgot,np_xg_per_90,big_chances_missed,chances_created,touches_opp_box_per_90,saves')
    .eq('season', season).limit(2000);
  if (error || !data) return json({ configured: true, season, players: {} }, 600);

  const players = {};
  for (const r of data) {
    players[r.element] = {
      g: r.games, m: r.minutes, gp: r.goals_prevented, gp90: r.goals_prevented_per_90,
      xgot: r.xgot, npxg90: r.np_xg_per_90, bcm: r.big_chances_missed,
      cc: r.chances_created, tob90: r.touches_opp_box_per_90, sv: r.saves,
    };
  }
  return json({ configured: true, season, players });
};
