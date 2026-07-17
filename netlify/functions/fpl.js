/* Gameweek Edge — FPL API proxy (Netlify Function)
   The official FPL API blocks direct browser calls (no CORS), so every
   request from the app is routed through here. This function:
   - whitelists only the endpoints the app needs (no open proxy / SSRF)
   - adds a browser-like User-Agent the FPL API expects
   - returns CORS headers so the web and native apps can call it
   - caches slow-changing data at the edge; never caches live data

   Invoked at /api/fpl/<endpoint> via the redirect in netlify.toml. */

const ALLOW = [
  /^bootstrap-static$/,
  /^fixtures$/,
  /^entry\/\d+$/,
  /^entry\/\d+\/history$/,
  /^entry\/\d+\/transfers$/,
  /^entry\/\d+\/event\/\d+\/picks$/,
  /^element-summary\/\d+$/,
  /^event\/\d+\/live$/,
  /^event-status$/,
  /^dream-team\/\d+$/,
  /^set-piece-notes$/,
  /^leagues-classic\/\d+\/standings$/,
  /^leagues-h2h\/\d+\/standings$/
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  /* Strip the routing prefix to get the bare FPL endpoint. */
  const sub = (event.path || '')
    .replace(/^\/(\.netlify\/functions\/fpl|api\/fpl)\/?/, '')
    .replace(/\/+$/, '');

  if (!ALLOW.some((re) => re.test(sub))) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Endpoint not allowed', endpoint: sub }) };
  }

  const qs = event.rawQuery ? '?' + event.rawQuery : '';
  const url = 'https://fantasy.premierleague.com/api/' + sub + '/' + qs;
  const isLive = /\/live$|\/picks$|^entry\/\d+$|^event-status$/.test(sub);

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)',
        'Accept': 'application/json'
      }
    });
    const body = await r.text();
    return {
      statusCode: r.status,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        /* Bootstrap / fixtures cache for 5 min at the edge; live data never. */
        'Cache-Control': isLive ? 'no-store' : 'public, max-age=300, stale-while-revalidate=600'
      },
      body
    };
  } catch (e) {
    return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Upstream fetch failed' }) };
  }
};
