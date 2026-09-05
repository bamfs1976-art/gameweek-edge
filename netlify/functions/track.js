/* Gameweek Edge — first-party analytics sink (Netlify Function)
   POST { event, props?, anon_id?, src? } -> 204. Inserts a row into
   gwedge_events via the service-role key. No third-party scripts, no
   cookies: the client sends a random persisted anon id so funnels can
   be counted without identifying anyone.

   Graceful degradation: when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
   are missing the function no-ops with 204 so tracking never breaks
   the app. Same-origin only — no CORS headers are emitted, so browsers
   on other origins can't post events here. */

const resp = (code) => ({ statusCode: code, body: '' });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(204);
  if (event.httpMethod !== 'POST') return resp(405);

  const supaUrl = process.env.SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) return resp(204);          /* analytics not configured: no-op */

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (_) { return resp(204); }
  const name = String(b.event || '').slice(0, 64);
  if (!name || !/^[a-z0-9_.-]+$/i.test(name)) return resp(204);

  let props = null;
  if (b.props && typeof b.props === 'object') {
    const s = JSON.stringify(b.props);
    if (s.length <= 2000) props = b.props;
  }
  /* Channel attribution. The client sends the ?src= tag this device first
     arrived with; it lands in props.src so the weekly view in
     supabase/gwedge_attribution.sql can group sign-ups and Pro conversions
     by channel. Allow-listed, so a stray value cannot become a column. */
  const SRC = ['x', 'reddit', 'threads', 'bluesky', 'linkedin', 'email', 'creator', 'seo'];
  if (typeof b.src === 'string' && SRC.includes(b.src)) {
    props = Object.assign({}, props || {}, { src: b.src });
  }

  const row = {
    event: name,
    props,
    anon_id: String(b.anon_id || '').slice(0, 64) || null,
    ua: String(event.headers['user-agent'] || '').slice(0, 300) || null
  };

  try {
    await fetch(supaUrl + '/rest/v1/gwedge_events', {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(row)
    });
  } catch (_) { /* fire-and-forget */ }
  return resp(204);
};
