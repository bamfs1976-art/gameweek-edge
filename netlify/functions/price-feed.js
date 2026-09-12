/* Gameweek Edge — price feed public read.
   Serves the hourly transfer momentum and the day-by-day price changes the
   hourly push sender writes to gwedge_push_state (see netlify/lib/price-feed.js).
   Model data only, no user data: read with the service-role key server-side
   and cached at the edge for ten minutes, which is well inside the hourly
   cadence it is written at.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Returns {configured:false}
   when unset, so the app shows the game's own figures and says the history
   is not recorded yet. */

const { flowDeltas } = require('../lib/price-feed');

const json = (o, maxAge) => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=' + (maxAge || 600) + ', stale-while-revalidate=1800',
  },
  body: JSON.stringify(o),
});

exports.handler = async () => {
  const supaUrl = process.env.SUPABASE_URL, supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return json({ configured: false, hours: 0, ts: [], net: {}, log: { days: {} } }, 300);

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
  const { data, error } = await sb.from('gwedge_push_state').select('key,value').in('key', ['price_flow', 'price_log']);
  if (error) return json({ configured: true, hours: 0, ts: [], net: {}, log: { days: {} } }, 120);
  const by = {};
  (data || []).forEach((r) => { by[r.key] = r.value; });
  const flow = flowDeltas(by.price_flow || null);
  const log = by.price_log && by.price_log.days ? by.price_log : { days: {} };
  return json({ configured: true, hours: flow.ts.length, ts: flow.ts, net: flow.net, log });
};
