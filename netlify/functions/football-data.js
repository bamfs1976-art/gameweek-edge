/* Gameweek Edge — football-data.org proxy (Netlify Function)

   Two things the official FPL API cannot tell us, and this one can:

     1. WHO IS REFEREEING. The string "referee" appears nowhere in the app,
        because FPL's feed does not carry it. It is the input the cards and
        bookings work needs.
     2. WHO IS PLAYING MIDWEEK. FPL knows only about FPL. Rotation Risk and
        the "Playing midweek" card need fixtures from the OTHER competitions
        a club is in, which means a cross-competition feed.

   Everything else football-data publishes either duplicates the bootstrap
   (top scorers — `goals_scored` is already on every element and used in a
   dozen places) or is decoration. Duplicating a number we already publish is
   worse than not having it: the two sources disagree on penalty awards and
   own-goal timing, and then we are adjudicating our own numbers in public.

   ── THE RATE LIMIT SHAPES THIS WHOLE FILE ─────────────────────────────
   The free tier allows ~10 requests a minute for the entire site, not per
   user. Two consequences, both deliberate:

   a) THIS FUNCTION NEVER FANS OUT. Referees are available per match from
      /v4/matches/{id}, so "referees for this matchday" reads as ten calls —
      one matchday would spend the entire minute's budget. So referees are
      taken from the ONE matchday-list call instead, and if the upstream
      omits them the app degrades to not showing a referee. A missing name
      is a small loss; a 429 for every visitor is an outage.

   b) THE EDGE CACHE IS THE RATE LIMITER. TTLs below are long and deliberate.
      With them, a busy day costs a handful of upstream calls per hour
      regardless of traffic. Shortening them is not a tuning decision, it is
      a decision to start returning 429s.

   ── UNVERIFIED AGAINST THE LIVE API ───────────────────────────────────
   api.football-data.org was not reachable from the machine this was written
   on (the egress proxy refuses it), so the response shapes below come from
   the published v4 documentation, not from a response anyone has seen. That
   is why the app-side readers pick fields defensively and return null rather
   than inventing a value — the same stance ucl.js takes for the same reason.

   Before trusting anything this feeds, run `npx netlify dev` and hit:
       /api/football-data/matchday?matchday=1
       /api/football-data/window?dateFrom=2026-08-21&dateTo=2026-08-27
   and check `_meta.upstreamStatus` and the shape of `matches[].referees`.

   ── COVERAGE CAVEAT ───────────────────────────────────────────────────
   football-data's free tier covers a fixed competition list which, per their
   published tiers, includes the Premier League and the Champions League but
   NOT the domestic cups. Midweek congestion will therefore be European plus
   league only — the FA Cup and EFL Cup rounds that cause a good deal of real
   rotation will be invisible. Confirm against your own plan before the app
   claims to show "all" midweek football; it should say what it actually
   covers.

   Invoked at /api/football-data/<route> via the redirect in netlify.toml.
   The API key lives in the FOOTBALL_DATA_KEY environment variable and is
   never sent to the browser. */

const API = 'https://api.football-data.org/v4';

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

/* Competitions the app may ask for. An allowlist rather than a passthrough:
   the route builder below interpolates this into a URL, so leaving it open
   would be an SSRF hole dressed up as a feature. */
const COMPS = new Set(['PL', 'CL', 'ELC', 'EC', 'WC']);

const isId = (v) => /^[1-9]\d{0,6}$/.test(String(v || ''));
/* Round-trips rather than trusting Date.parse, which happily rolls an
   impossible date over — 2026-02-30 parses as 2 March and would have been
   forwarded upstream to spend budget on a request nobody meant to make. */
const isDate = (v) => {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/* route -> { path, ttl }. Each entry returns null to reject bad input, so a
   malformed request never reaches the upstream and never spends budget. */
const ROUTES = {
  /* One call gives the round's fixtures, kickoff times, status and — per the
     v4 docs — a referees array per match. This is the only referee source
     the app uses; see (a) above. */
  matchday(q) {
    const comp = String(q.competition || 'PL').toUpperCase();
    if (!COMPS.has(comp)) return null;
    const md = q.matchday;
    if (md != null && md !== '' && !/^[1-9]\d?$/.test(String(md))) return null;
    return {
      path: `/competitions/${comp}/matches` + (md ? `?matchday=${md}` : ''),
      /* This used to read "referees are published a couple of days out and
         then do not move", and the half-hour cache was justified by it.

         Two things were wrong with that. First, THIS FEED does not carry
         them: probed on 13 Aug 2026 through this very endpoint, not one of
         552 Championship or 380 Premier League matches had a referee named,
         including twelve inside four days of kick-off.

         Second — and this is the part worth remembering — the probe's own
         write-up then reported that as "referees are not published before
         kick-off", which is false. The EFL publishes its appointments three
         to nine days ahead on its own site. The feed's silence was a fact
         about the feed, and it got told as a fact about football.

         So: no referee data here, and that says nothing about whether the
         suspension panel is buildable. See dev/probe-referees.mjs, which now
         tests both sources and names which one it is talking about.

         The half hour stays, on different grounds: kick-off times and match
         status do move, and half an hour is a reasonable staleness for a
         fixture list. If referees ever do appear here, revisit this
         deliberately rather than inheriting a number that meant something
         else. */
      ttl: 1800
    };
  },

  /* Cross-competition window — the congestion feed. The upstream caps the
     span at 10 days; enforcing it here turns a 400 from them into a clear
     error from us, and costs no budget to find out. */
  window(q) {
    const { dateFrom, dateTo } = q;
    if (!isDate(dateFrom) || !isDate(dateTo)) return null;
    const span = days(dateFrom, dateTo);
    if (span < 0 || span > 10) return null;
    return { path: `/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`, ttl: 21600 };
  },

  /* Club metadata: venue, founded, coach, colours. Effectively static. */
  team(q) {
    if (!isId(q.id)) return null;
    return { path: `/teams/${q.id}`, ttl: 86400 };
  },

  /* Head-to-head history for one fixture. */
  h2h(q) {
    if (!isId(q.id)) return null;
    const limit = /^[1-9]\d?$/.test(String(q.limit || '')) ? q.limit : 10;
    return { path: `/matches/${q.id}/head2head?limit=${limit}`, ttl: 86400 };
  }
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });

  const route = (event.path || '')
    .replace(/^\/(\.netlify\/functions\/football-data|api\/football-data)\/?/, '')
    .replace(/\/+$/, '');

  const build = ROUTES[route];
  if (!build) return json(400, { error: 'Unknown route', route, known: Object.keys(ROUTES) });

  const spec = build(event.queryStringParameters || {});
  if (!spec) return json(400, { error: 'Bad parameters for route', route });

  const key = process.env.FOOTBALL_DATA_KEY;
  /* Fail loudly. A silent empty body here would surface as "no referee this
     week" and look like upstream having nothing, which is the kind of quiet
     wrong that survives for months.

     The message says what to CHECK, not just what is wrong. When the key was
     first set in the Netlify UI this endpoint kept 503-ing, and "not
     configured" is ambiguous between the three reasons it can be missing —
     the variable was never set, it was set but no deploy has happened since
     (Netlify snapshots the environment per deploy), or it was set with a
     scope that excludes Functions or a deploy context that excludes
     production. All three look identical from here, and only the first is
     what the old wording implied. Names only; never the value. */
  if (!key) {
    return json(503, {
      error: 'FOOTBALL_DATA_KEY is not visible to this function',
      check: [
        'the variable exists on this Netlify site',
        'a deploy has run SINCE it was set — env changes need a new deploy',
        'its scope includes Functions, and its context includes Production'
      ]
    });
  }

  let r, text;
  try {
    r = await fetch(API + spec.path, {
      headers: { 'X-Auth-Token': key, Accept: 'application/json' }
    });
    text = await r.text();
  } catch (e) {
    return json(502, { error: 'Upstream fetch failed' });
  }

  /* Rate-limited: say so plainly and pass the reset hint through, so the app
     can back off rather than hammer. Never cached. */
  if (r.status === 429) {
    return json(429, {
      error: 'Rate limited by football-data.org',
      retryAfterSeconds: Number(r.headers.get('X-RequestCounter-Reset')) || 60
    }, { 'Cache-Control': 'no-store' });
  }
  if (!r.ok) {
    /* Deliberately does not echo the upstream body: their error payloads can
       quote the request, and the request carries the key. */
    return json(r.status, { error: 'Upstream error', upstreamStatus: r.status },
      { 'Cache-Control': 'no-store' });
  }

  let data;
  try { data = JSON.parse(text); }
  catch (_) { return json(502, { error: 'Upstream returned non-JSON' }); }

  return json(200, {
    ...data,
    _meta: {
      route,
      upstreamStatus: r.status,
      /* Surfaced so the verification pass above can see how much budget is
         left without a second call. */
      requestsAvailableMinute: r.headers.get('X-Requests-Available-Minute'),
      fetchedAt: new Date().toISOString(),
      attribution: 'Football data provided by the Football-Data.org API'
    }
  }, { 'Cache-Control': `public, max-age=${spec.ttl}, stale-while-revalidate=${spec.ttl * 2}` });
};

/* Exported for dev/test-footballdata.mjs — the routing, validation and
   budget rules are the part worth testing, and all of it is decided before
   any network call. */
exports._internal = { ROUTES, COMPS, isId, isDate, days };
