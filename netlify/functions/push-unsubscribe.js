/* Removes a Web Push subscription. POST { endpoint }. */
const { createClient } = require('@supabase/supabase-js');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
  const supaUrl = process.env.SUPABASE_URL, supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return json(503, { error: 'Push not configured' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'Bad request' }); }
  if (!b.endpoint) return json(400, { error: 'No endpoint' });
  try {
    const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
    await sb.from('gwedge_push_subs').delete().eq('endpoint', b.endpoint);
    return json(200, { ok: true });
  } catch (e) { return json(502, { error: 'Could not remove subscription' }); }
};
