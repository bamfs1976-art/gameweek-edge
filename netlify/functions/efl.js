/* Gameweek Edge — Fantasy EFL proxy (Netlify Function)

   The official Fantasy EFL game publishes three JSON documents that need no
   API key and no account:

     squads   72 clubs across the Championship, League One and League Two —
              league position, recent form, the game's own 1-5 fixture
              ratings, and the percentage of managers who have picked each
     players  every player: season totals, position, club, injury note
     rounds   every round, its games, its status and its lockout time

   Invoked at /api/efl/<route> via the redirect in netlify.toml, and read by
   efl/app/assets/provider.js.

   ── WHY THIS EXISTS AT ALL, GIVEN THE FEED IS PUBLIC ──────
   Three reasons, in order of how load-bearing they are.

   1. THE CSP. connect-src in netlify.toml is 'self'. The browser cannot
      talk to fantasy.efl.com and should not be allowed to: adding a third
      party to connect-src to save a hop is how a content policy stops
      meaning anything.
   2. THE CACHE IS THE RATE LIMITER. Same reasoning as football-data.js.
      With the TTLs below, a busy day costs a handful of upstream requests
      an hour regardless of traffic. The official game is not offering us an
      API; it is serving its own front end, and the polite way to read it is
      rarely. Shortening these is not a tuning decision.
   3. ONE BASE URL. The packaged iOS build configures a single origin, the
      same reason /api/history is a redirect to a static file.

   ── UNVERIFIED AGAINST THE LIVE API ───────────────────────
   fantasy.efl.com was NOT reachable from the machine this was written on —
   the egress proxy refuses it, exactly as it refuses api.football-data.org
   for the sibling function. The paths and response shapes come from the
   official game's own front end as used by a working public site, not from
   a response anyone here has seen.

   That is why the app-side default provider is still 'sample', why the
   readers in provider.js pick fields defensively and return null rather
   than inventing a value, and why nothing here reshapes the payload: this
   function is a dumb pipe, so the first person to see a shape change sees
   it in the mapper's tests rather than in a silently wrong table.

   Before trusting it, run `npx netlify dev` and hit:
       /api/efl/squads
       /api/efl/players
       /api/efl/rounds
   and check `_meta.upstreamStatus` and that a squad carries competitionId,
   leaguePosition, percentSelected, fdrHome and fdrAway.

   ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────
   There is a fourth endpoint, /json/fantasy/player_profiles/{id}.json,
   carrying per-match player history. It requires a logged-in Fantasy EFL
   account, and reading it for a whole game means roughly eleven hundred
   requests. This function will not authenticate as a user and will not fan
   out: holding somebody's game credentials to fill in a form column is a
   bad trade, and the app states the resulting gap in plain English instead
   (see `coverage` in provider.js) rather than hiding it. */

const UPSTREAM = 'https://fantasy.efl.com/json/fantasy';

/* An allowlist, not a splat-through. Without it this is an open proxy for
   any path on the upstream host, which is somebody else's bandwidth and our
   name on the requests. TTLs reflect how often each thing actually changes:
   squads carry live ownership and form, rounds change when a fixture moves,
   players change on team news. */
const ROUTES = {
  squads: { path: 'squads.json', ttl: 900 },
  players: { path: 'players.json', ttl: 900 },
  rounds: { path: 'rounds.json', ttl: 3600 }
};

/* The fields the app actually depends on, per document. `health` reports
   which of them are present so a shape change is a one-request diagnosis
   rather than an afternoon. Keep this list in step with
   assertOfficialShape() in efl/app/assets/provider.js — they are the same
   claim, made once for a human and once for the code. */
const EXPECTED = {
  squads: ['id', 'competitionId', 'name', 'leaguePosition', 'percentSelected', 'fdrHome', 'fdrAway', 'last3Form'],
  players: ['id', 'squadId', 'position', 'appearances', 'totalPoints', 'goalsScored', 'injuryDetails'],
  rounds: ['roundNumber', 'status', 'lockoutDate', 'games']
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept'
};

const json = (statusCode, body, extra) => ({
  statusCode,
  headers: { ...CORS, 'Content-Type': 'application/json', ...(extra || {}) },
  body: JSON.stringify(body)
});

/* The upstream serves its own front end, so it wants to look like a browser
   request. No credentials of any kind are sent — these three documents need
   none, and the moment a route here needs one it does not belong here. */
const UPSTREAM_HEADERS = {
  Accept: 'application/json',
  Referer: 'https://fantasy.efl.com/',
  'User-Agent': 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const requested = String(event.path || '')
    .replace(/^.*\/(?:api\/efl|efl)\/?/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  /* ── /api/efl/health ───────────────────────────────────────
     The app defaults to a feed whose responses were never observed from the
     machine it was written on. This is the answer to "did that gamble pay
     off", and it is deliberately a URL a person can open rather than a test
     only CI can run: it fetches all three documents and reports, per
     document, the HTTP status, how many records came back, and which of the
     fields this app depends on are actually present.

     Not cached. A health check that can answer from ten minutes ago is not
     a health check. */
  if (requested === 'health') {
    const report = {};
    let ok = true;
    for (const [name, spec] of Object.entries(ROUTES)) {
      try {
        const res = await fetch(`${UPSTREAM}/${spec.path}`, { headers: UPSTREAM_HEADERS });
        const entry = { status: res.status };
        if (!res.ok) { ok = false; report[name] = entry; continue; }
        let data;
        try { data = await res.json(); }
        catch (err) {
          ok = false;
          report[name] = { ...entry, error: 'response was not JSON (a login wall or error page?)' };
          continue;
        }
        entry.isArray = Array.isArray(data);
        entry.count = Array.isArray(data) ? data.length : null;
        if (!entry.isArray) { ok = false; report[name] = entry; continue; }
        const sample = data[0] && typeof data[0] === 'object' ? data[0] : {};
        entry.fieldsPresent = EXPECTED[name].filter((f) => sample[f] !== undefined);
        entry.fieldsMissing = EXPECTED[name].filter((f) => sample[f] === undefined);
        entry.sampleKeys = Object.keys(sample).slice(0, 30);
        if (entry.fieldsMissing.length) ok = false;
        report[name] = entry;
      } catch (err) {
        ok = false;
        report[name] = { status: null, error: String(err && err.message ? err.message : err) };
      }
    }
    /* Divisions are derived by ranking competitionId, so "three of them" is
       the single assumption most likely to break quietly across a season. */
    return json(ok ? 200 : 503, {
      ok,
      checkedAt: new Date().toISOString(),
      summary: ok
        ? 'The official Fantasy EFL feed is answering in the shape this app expects.'
        : 'The official feed did not answer in the expected shape — see the per-document detail. '
          + 'The app will show an error rather than wrong numbers; ?provider=sample still works.',
      documents: report
    }, { 'Cache-Control': 'no-store' });
  }

  const route = ROUTES[requested];
  if (!route) {
    return json(404, {
      error: `Unknown Fantasy EFL route "${requested}"`,
      available: [...Object.keys(ROUTES), 'health']
    });
  }

  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM}/${route.path}`, { headers: UPSTREAM_HEADERS });
  } catch (err) {
    /* Reachability is the failure mode this function was written blind to,
       so it reports it as itself rather than as an empty document. */
    return json(502, {
      error: 'Could not reach the official Fantasy EFL feed.',
      details: String(err && err.message ? err.message : err),
      _meta: { route: requested, upstreamStatus: null }
    });
  }

  if (!upstream.ok) {
    return json(upstream.status === 404 ? 502 : upstream.status, {
      error: `The official Fantasy EFL feed returned ${upstream.status}.`,
      _meta: { route: requested, upstreamStatus: upstream.status }
    });
  }

  let data;
  try {
    data = await upstream.json();
  } catch (err) {
    /* A login wall or an error page answers 200 with HTML. Saying so beats
       handing the app something it will read as "no clubs". */
    return json(502, {
      error: 'The official Fantasy EFL feed did not return JSON.',
      details: String(err && err.message ? err.message : err),
      _meta: { route: requested, upstreamStatus: upstream.status }
    });
  }

  return json(200, data, {
    'Cache-Control': `public, max-age=${route.ttl}, stale-while-revalidate=${route.ttl * 4}`,
    'X-EFL-Route': requested
  });
};
