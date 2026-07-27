/* Gameweek Edge — FPL Challenge API proxy (Netlify Function)

   FPL Challenge is a separate game on its own host, but it is the same
   Premier League, the same player pool and the same base scoring — what
   changes is the rulebook. Each gameweek sets its own challenge (three
   clubs only, defenders score double, and so on), the squad is rebuilt
   every week, transfers are free and unlimited, prices never move and
   there are no chips.

   Its API mirrors the main FPL one endpoint for endpoint, which is why
   this proxy is a near-copy of fpl.js rather than a new shape: same
   whitelist discipline (no open proxy / SSRF), same browser-like
   User-Agent, same CORS headers, same caching split between slow-moving
   and live data.

   Two things are deliberately NOT shared with fpl.js:
   - the upstream host, obviously;
   - the endpoint whitelist, which is a strict subset. Challenge has no
     set-piece notes and no dream team, and listing endpoints we have not
     confirmed would turn a 404 into a support ticket. Anything the game
     turns out to serve can be added here in one line.

   Invoked at /api/challenge/<endpoint> via the redirect in netlify.toml.

   VERIFY BEFORE RELYING ON IT: the upstream host and the payload shape
   below are the documented mirror of the FPL API, but they were not
   reachable from the machine this was written on. Run `npx netlify dev`
   and hit /api/challenge/bootstrap-static once — if the shape matches
   the FPL bootstrap (events / elements / teams / element_types /
   game_settings), nothing else needs changing. If the host differs,
   UPSTREAM below is the only line to edit. */

const UPSTREAM = 'https://fplchallenge.premierleague.com/api/';

const ALLOW = [
  /^bootstrap-static$/,
  /^fixtures$/,
  /^entry\/\d+$/,
  /^entry\/\d+\/history$/,
  /^entry\/\d+\/event\/\d+\/picks$/,
  /^element-summary\/\d+$/,
  /^event\/\d+\/live$/,
  /^event-status$/,
  /^leagues-classic\/\d+\/standings$/,
  /^leagues-h2h\/\d+\/standings$/,
  /^leagues-h2h\/\d+\/matches$/
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  /* Strip the routing prefix to get the bare endpoint. */
  const sub = (event.path || '')
    .replace(/^\/(\.netlify\/functions\/challenge|api\/challenge)\/?/, '')
    .replace(/\/+$/, '');

  if (!ALLOW.some((re) => re.test(sub))) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Endpoint not allowed', endpoint: sub }) };
  }

  const qs = event.rawQuery ? '?' + event.rawQuery : '';
  const url = UPSTREAM + sub + '/' + qs;
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
