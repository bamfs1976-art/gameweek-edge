/*
 * Tests for the football-data.org proxy (netlify/functions/football-data.js).
 *
 * The upstream was not reachable from the machine this was written on, so
 * these test the part that does not need it — and that part is the part that
 * matters, because every decision the free tier punishes is made before the
 * fetch:
 *
 *   1. an unknown route or bad parameter never reaches the upstream, so a
 *      malformed request costs no budget;
 *   2. the competition list is an allowlist, because the route builder
 *      interpolates it straight into a URL;
 *   3. the 10-day window cap is enforced here rather than discovered as a
 *      400 from them;
 *   4. no route can fan out — every route resolves to exactly one upstream
 *      path, which is what keeps a matchday from costing ten calls;
 *   5. the cache TTLs, which ARE the rate limiter, are long enough to be one.
 *
 * Run: node dev/test-footballdata.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const mod = require(join(ROOT, 'netlify/functions/football-data.js'));
const { ROUTES, COMPS, isDate, days } = mod._internal;
const src = readFileSync(join(ROOT, 'netlify/functions/football-data.js'), 'utf8');

let failures = 0, passes = 0;
const ok = (c, label) => { if (c) passes++; else { failures++; console.error('  ✗ ' + label); } };

/* ── 1. bad input is rejected before any network call ─────────────── */
ok(ROUTES.matchday({ competition: 'XX' }) === null, 'an unlisted competition is rejected');
ok(ROUTES.matchday({ competition: 'PL', matchday: '0' }) === null, 'matchday 0 is rejected');
ok(ROUTES.matchday({ competition: 'PL', matchday: 'abc' }) === null, 'a non-numeric matchday is rejected');
ok(ROUTES.matchday({ competition: 'PL', matchday: '1; DROP' }) === null, 'an injected matchday is rejected');
ok(ROUTES.team({ id: 'abc' }) === null, 'a non-numeric team id is rejected');
ok(ROUTES.team({ id: '../../secret' }) === null, 'a traversal attempt in an id is rejected');
ok(ROUTES.h2h({ id: '0' }) === null, 'a zero match id is rejected');
ok(ROUTES.window({ dateFrom: 'yesterday', dateTo: '2026-08-27' }) === null, 'a non-ISO date is rejected');

/* ── 2. the happy paths build exactly one upstream path ───────────── */
const md = ROUTES.matchday({ competition: 'PL', matchday: '1' });
ok(md && md.path === '/competitions/PL/matches?matchday=1', 'matchday builds the competition path');
ok(ROUTES.matchday({}).path === '/competitions/PL/matches', 'matchday defaults to the Premier League, whole season');
ok(ROUTES.matchday({ competition: 'pl', matchday: '7' }).path === '/competitions/PL/matches?matchday=7',
  'competition is case-insensitive');
ok(ROUTES.team({ id: '57' }).path === '/teams/57', 'team builds a single team path');
ok(ROUTES.h2h({ id: '441613' }).path.startsWith('/matches/441613/head2head'), 'h2h builds a single match path');
ok(ROUTES.h2h({ id: '441613', limit: 'lots' }).path.endsWith('limit=10'), 'a bad h2h limit falls back rather than passing through');

/* ── 3. the ten-day window cap ────────────────────────────────────── */
ok(ROUTES.window({ dateFrom: '2026-08-21', dateTo: '2026-08-27' }) !== null, 'a six-day window is allowed');
ok(ROUTES.window({ dateFrom: '2026-08-21', dateTo: '2026-08-31' }) !== null, 'a ten-day window is allowed');
ok(ROUTES.window({ dateFrom: '2026-08-21', dateTo: '2026-09-05' }) === null, 'an eleven-day window is rejected');
ok(ROUTES.window({ dateFrom: '2026-08-27', dateTo: '2026-08-21' }) === null, 'a backwards window is rejected');
ok(days('2026-08-21', '2026-08-31') === 10, 'the span helper counts days inclusive of neither end');
ok(isDate('2026-02-30') === false, 'an impossible date is rejected');

/* ── 4. no route may fan out ──────────────────────────────────────────
   This is the rule that keeps one matchday from costing the whole minute's
   budget. Every route must resolve to a single path string; the moment one
   returns a list, the caller will loop it. */
for (const [name, build] of Object.entries(ROUTES)) {
  const spec = build(name === 'window'
    ? { dateFrom: '2026-08-21', dateTo: '2026-08-27' }
    : { id: '57', matchday: '1' });
  ok(spec && typeof spec.path === 'string', name + ': resolves to exactly one upstream path');
}
ok(!/for\s*\(|\.map\(|Promise\.all/.test(src.split('exports.handler')[1] || ''),
  'the handler contains no loop or Promise.all — it cannot fan out');

/* ── 5. the cache TTLs are the rate limiter ───────────────────────── */
const ttl = (n, args) => ROUTES[n](args).ttl;
ok(ttl('matchday', { matchday: '1' }) >= 900, 'the matchday TTL is at least fifteen minutes');
ok(ttl('window', { dateFrom: '2026-08-21', dateTo: '2026-08-27' }) >= 3600, 'the congestion window caches for at least an hour');
ok(ttl('team', { id: '57' }) >= 86400, 'club metadata caches for a day');
ok(ttl('h2h', { id: '1' }) >= 86400, 'head-to-head caches for a day');

/* ── 6. the key never leaves the server ───────────────────────────── */
ok(/process\.env\.FOOTBALL_DATA_KEY/.test(src), 'the key is read from the environment');
ok(!/FOOTBALL_DATA_KEY[^\n]*body/.test(src), 'the key is never put in a response body');
const errPaths = src.slice(src.indexOf('if (!r.ok)'));
ok(!/body:\s*text/.test(errPaths),
  'the upstream error body is not echoed — their payloads can quote the request, and the request carries the key');
/* Asserted on the SHAPE rather than on one line of it: the guard used to be a
   single statement and became a block when the message grew into something a
   reader could act on. What must not change is that a missing key returns 503
   from inside the `!key` branch, before anything is fetched — the failure mode
   this guards is a silent empty body that reads as "no referee this week". */
const guard = src.slice(src.indexOf('if (!key)'), src.indexOf('let r, text'));
ok(/if \(!key\)/.test(guard) && /json\(503/.test(guard),
  'a missing key fails loudly rather than returning empty');
ok(src.indexOf('if (!key)') < src.indexOf('await fetch('),
  'and it does so before any upstream request is attempted');
/* The message has to name the three reasons the variable can be invisible,
   because it took a live incident to learn that "not configured" covers a
   variable that IS set but predates the last deploy. */
ok(/deploy/i.test(guard) && /scope/i.test(guard),
  'and it points at the deploy and scope causes, not just at the name');

/* ── 7. the competition allowlist is closed ───────────────────────── */
ok(COMPS instanceof Set && COMPS.size > 0, 'competitions are an allowlist');
ok(!COMPS.has(''), 'the empty competition is not allowed');
ok(COMPS.has('PL'), 'the Premier League is allowed');

/* ── 8. the app-side readers, against the documented shape ────────────
   Extracted from index.html rather than reimplemented, so a change to the
   app cannot silently pass a copy of itself. The fixture below is the shape
   football-data's v4 docs describe; it is NOT a captured response, and that
   is exactly why the readers must tolerate fields going missing. */
const app = readFileSync(join(ROOT, 'index.html'), 'utf8');
const grab = (name) => {
  const i = app.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found in index.html: ' + name);
  let d = 0, started = false;
  for (let j = i; j < app.length; j++) {
    if (app[j] === '{') { d++; started = true; }
    else if (app[j] === '}') { d--; if (started && d === 0) return app.slice(i, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
};
const readers = new Function(
  [grab('fdMatches'), grab('fdReferee'), grab('fdClubTokens'), grab('fdSameClub'),
   grab('fdCongestion'), grab('fdCongestionFor')].join('\n') +
  '\nconst FD_NOISE = new Set(["fc","afc","cf","sc","ac","the"]);' +
  '\nreturn { fdMatches, fdReferee, fdClubTokens, fdSameClub, fdCongestion, fdCongestionFor };')();

const FIXTURE = { matches: [
  { id: 1, utcDate: '2026-08-22T14:00:00Z', competition: { code: 'PL', name: 'Premier League' },
    homeTeam: { name: 'Arsenal FC', shortName: 'Arsenal' }, awayTeam: { name: 'Leeds United FC', shortName: 'Leeds United' },
    referees: [ { id: 9, name: 'Michael Oliver', type: 'REFEREE' }, { id: 10, name: 'A Assistant', type: 'ASSISTANT_REFEREE_N1' } ] },
  { id: 2, utcDate: '2026-08-25T19:00:00Z', competition: { code: 'CL', name: 'UEFA Champions League' },
    homeTeam: { name: 'Arsenal FC', shortName: 'Arsenal' }, awayTeam: { name: 'Real Madrid CF', shortName: 'Real Madrid' },
    referees: [] },
  { id: 3, utcDate: '2026-08-26T19:00:00Z', competition: { code: 'CL', name: 'UEFA Champions League' },
    homeTeam: { name: 'Manchester City FC', shortName: 'Man City' }, awayTeam: { name: 'FC Bayern Munchen' } }
]};

ok(readers.fdMatches(FIXTURE).length === 3, 'the match list is read');
ok(readers.fdMatches(null).length === 0, 'a null payload reads as no matches, not a throw');
ok(readers.fdMatches({}).length === 0, 'a payload with no matches key reads as no matches');

ok(readers.fdReferee(FIXTURE.matches[0]) === 'Michael Oliver', 'the main referee is picked out of the officials list');
ok(readers.fdReferee(FIXTURE.matches[1]) === null, 'an empty officials list yields null, not a blank string');
ok(readers.fdReferee(FIXTURE.matches[2]) === null, 'a match with no referees key yields null');
ok(readers.fdReferee({ referees: [{ name: 'Only One' }] }) === 'Only One',
  'an official with no type still gives a name — a wrong role label beats a blank');
ok(readers.fdReferee(null) === null, 'a null match yields null');

/* The club-name bridge is the fragile part of this integration, so the tests
   pin both what must reconcile and what must never. */
ok(readers.fdSameClub('Manchester City FC', 'Man City'), 'Manchester City reconciles across the two feeds');
ok(readers.fdSameClub('Arsenal FC', 'Arsenal'), 'Arsenal reconciles');
ok(readers.fdSameClub('Tottenham Hotspur FC', 'Spurs') === false,
  'Spurs does not reconcile by name alone — better a miss than a guess');
ok(readers.fdSameClub('Leeds United FC', 'Leicester City') === false, 'Leeds is not confused with Leicester');
ok(readers.fdSameClub('Manchester City', 'Manchester United') === false,
  'the two Manchester clubs are never confused');
ok(readers.fdSameClub('Nottingham Forest FC', 'Nott\'m Forest'), 'an apostrophised abbreviation reconciles');
ok(readers.fdClubTokens('FC') === null, 'a name that is only a suffix gives up rather than matching everything');
ok(readers.fdClubTokens('') === null, 'an empty name gives up');
ok(readers.fdSameClub('', 'Arsenal') === false, 'an empty name matches nothing');

const cong = readers.fdCongestion(FIXTURE, 'PL');
ok(readers.fdCongestionFor(cong, 'Leeds').length === 0, 'a club with only a league fixture shows no congestion');
ok(readers.fdCongestionFor(cong, 'Arsenal').length === 1, 'a midweek European tie counts as congestion');
ok(readers.fdCongestionFor(cong, 'Arsenal')[0].competition === 'CL', 'and it names the competition');
ok(readers.fdCongestionFor(cong, 'Man City').length === 1, 'the home side of a European tie counts, by its FPL name');
ok(readers.fdCongestionFor(cong, 'Real Madrid').length === 1, 'the away side counts too');
ok(readers.fdCongestion({ matches: [] }, 'PL').length === 0, 'an empty window is no congestion, not a throw');
ok(readers.fdCongestion(null, 'PL').length === 0, 'a failed fetch reads as no congestion rather than throwing');
ok(readers.fdCongestionFor(null, 'Arsenal').length === 0, 'a null list is no congestion, not a throw');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
