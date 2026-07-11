/* Stores/updates a Web Push subscription. POST { subscription, userId?,
   managerId?, prefs? }. Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. */
const { createClient } = require('@supabase/supabase-js');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
  const supaUrl = process.env.SUPABASE_URL, supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return json(503, { error: 'Push not configured' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'Bad request' }); }
  const s = b.subscription;
  if (!s || !s.endpoint || !s.keys) return json(400, { error: 'Invalid subscription' });
  try {
    const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
    await sb.from('gwedge_push_subs').upsert({
      endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth,
      user_id: b.userId || null, manager_id: b.managerId ? Number(b.managerId) : null,
      prefs: b.prefs || { price: true, injury: true, deadline: true, scorer: true, bonus: true, defcon: true }
    }, { onConflict: 'endpoint' });
    return json(200, { ok: true });
  } catch (e) { return json(502, { error: 'Could not save subscription' }); }
};
