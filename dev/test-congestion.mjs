/*
 * Offline tests for midweek fixture congestion — the European and cup football
 * the official FPL API cannot see, and the effect it has on the minutes model.
 *
 * Two halves:
 *   1. netlify/functions/euro-fixtures.js — the pure parts of the endpoint
 *      (CSV parsing, club extraction, de-duplication, season derivation),
 *      imported directly since it is a real CommonJS module.
 *   2. index.html — congestionLoad / congestionFactor / congestionGames /
 *      congestionClubs / minutesModel, lifted into a sandbox the same way the
 *      other suites do it.
 *
 * The properties that matter are asymmetries, not magnitudes: a match BEFORE
 * kickoff counts and one after does not; a nailed starter is taxed less than a
 * squad player; congestion suppresses starts far more than appearances.
 *
 * Run: node dev/test-congestion.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const require = createRequire(import.meta.url);
const EF = require(join(ROOT, 'netlify/functions/euro-fixtures.js'));
const TE = require(join(ROOT, 'netlify/functions/team-elo.js'));

/* Comment/string-aware brace matcher (apostrophes in comments are safe). */
function extractBlock(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0, inStr = null, esc = false, com = 0;
  for (let j = open; j < src.length; j++) {
    const ch = src[j], nx = src[j + 1];
    if (com) { if (com === 1 && ch === '\n') com = 0; else if (com === 2 && ch === '*' && nx === '/') { com = 0; j++; } continue; }
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && nx === '/') { com = 1; j++; continue; }
    if (ch === '/' && nx === '*') { com = 2; j++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced');
}
const grabFn = (n) => extractBlock(html, html.indexOf('function ' + n + '('));
const grabConst = (n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); };

const API = new Function(
  grabConst('CONGEST_FULL') + '\n' + grabConst('CONGEST_FADE') + '\n' +
  grabConst('CONGEST_MAX') + '\n' + grabConst('CONGEST_NAILED') + '\n' +
  grabConst('CONGEST_TO_BENCH') + '\n' +
  grabConst('CONGEST_COMP') + '\n' +
  grabFn('euroIndex') + '\n' + grabFn('congestionLoad') + '\n' +
  grabFn('congestionGames') + '\n' + grabFn('congestionClubs') + '\n' +
  grabFn('congestionFactor') + '\n' + grabFn('minutesModel') + '\n' +
  'return {euroIndex,congestionLoad,congestionGames,congestionClubs,congestionFactor,minutesModel,' +
  'CONGEST_FULL,CONGEST_FADE,CONGEST_MAX,CONGEST_NAILED};'
)();

let failures = 0, passes = 0;
const ok = (c, label) => { if (c) passes++; else { failures++; console.error('  ✗ ' + label); } };
const near = (a, b, tol, label) => ok(Math.abs(a - b) <= (tol == null ? 1e-9 : tol), label + ' (got ' + a + ', want ~' + b + ')');

/* A Sunday 14:00 Premier League kickoff, and the midweek slots around it. */
const SUN = Date.parse('2026-11-08T14:00:00Z');
const DAY = 86400e3;
const before = (d) => new Date(SUN - d * DAY).toISOString();

console.log('• euro-fixtures: parsing the tournament CSV');
{
  /* The real shape: the PL club's element id sits in whichever of home_team /
     away_team it occupies, and the other is blank for a non-PL opponent. */
  const csv = [
    'gameweek,kickoff_time,home_team,home_team_elo,home_score,away_score,away_team,away_team_elo,finished,match_id',
    '10.0,2026-11-05T20:00:00,,,0.0,1.0,14.0,1965.83,True,26-27-europa-league-real-madrid-vs-liverpool',
    '10.0,2026-11-05T17:45:00,3.0,2069.87,3.0,0.0,,,True,26-27-europa-league-arsenal-vs-slavia-prague',
    '10.0,2026-11-05T20:00:00,8.0,1933.91,1.0,1.0,6.0,1802.35,False,26-27-europa-league-chelsea-vs-tottenham',
  ].join('\n');
  const rows = EF.clubRows({ code: 'UEL' }, 10, EF.parseCsv(csv));
  const teams = rows.map((r) => r.team).sort((a, b) => a - b);
  ok(teams.join(',') === '3,6,8,14', 'every PL club in the file is extracted, from both columns');
  ok(rows.every((r) => r.comp === 'UEL' && r.gw === 10), 'each row is tagged with its competition and gameweek');
  ok(rows.filter((r) => r.team === 8)[0].home === true, 'the home flag follows the column the id was found in');
  ok(rows.filter((r) => r.team === 6)[0].finished === false, 'an unplayed fixture is marked unfinished');

  /* Two PL clubs meeting each other is ONE match for each of them, not two. */
  const both = rows.filter((r) => r.team === 8 || r.team === 6);
  ok(both.length === 2, 'an all-PL tie yields one row per club');

  /* A blank kickoff is unusable — congestion is entirely about timing. */
  const noTime = EF.clubRows({ code: 'UEL' }, 10, EF.parseCsv(
    'gameweek,kickoff_time,home_team,away_team,finished\n10,,3,,True'));
  ok(noTime.length === 0, 'a row with no kickoff time is dropped');
  ok(EF.clubRows({ code: 'UEL' }, 10, []).length === 0, 'an empty file is safe');
}

console.log('• euro-fixtures: de-duplication and season choice');
{
  const r = (team, kickoff, comp) => ({ team, kickoff, comp, gw: 10 });
  const out = EF.dedupe([
    r(3, '2026-11-05T20:00:00', 'UEL'),
    r(3, '2026-11-05T20:00:00', 'UEL'),        // exact repeat
    r(3, '2026-11-05T20:00:00', 'UCL'),        // same slot, different competition — real
    r(1, '2026-11-04T20:00:00', 'UCL'),
  ]);
  ok(out.length === 3, 'an exact duplicate is collapsed');
  ok(out.filter((x) => x.team === 3).length === 2, 'but two competitions in one slot are kept');
  ok(out[0].kickoff <= out[1].kickoff, 'rows come back in kickoff order');

  /* July belongs to the season about to start — and unlike the stats
     aggregator there is deliberately no fallback to last season, because last
     season's cup calendar is history, not a fixture list. */
  ok(EF.deriveSeasonLabel(new Date('2026-07-26T00:00:00Z')) === '2026-2027', 'July is the coming season');
  ok(EF.deriveSeasonLabel(new Date('2027-01-15T00:00:00Z')) === '2026-2027', 'January is still that season');
  ok(EF.deriveSeasonLabel(new Date('2026-06-30T00:00:00Z')) === '2025-2026', 'June is still the old one');

  ok(EF.COMPS.every((c) => c.dir !== 'Premier League'),
    'the Premier League folder is excluded — those fixtures are the baseline, not congestion');
}

console.log('• congestionLoad: only football BEFORE kickoff counts');
{
  const L = API.congestionLoad;
  const idx = API.euroIndex({ rows: [{ team: 3, comp: 'UEL', kickoff: before(3) }] });

  ok(idx[3] && idx[3].length === 1, 'the feed indexes by club');
  near(L(idx, 3, SUN), 1, 1e-9, 'a Thursday tie before a Sunday game is full load');
  ok(L(idx, 99, SUN) === 0, 'a club with no midweek football is uncongested');
  ok(L(null, 3, SUN) === 0 && L({}, 3, SUN) === 0, 'an absent calendar means no congestion, not a crash');
  ok(L(idx, 3, NaN) === 0, 'an unknown kickoff cannot be scored');

  /* The asymmetry that matters: a match AFTER the fixture tires nobody. */
  const after = API.euroIndex({ rows: [{ team: 3, comp: 'UCL', kickoff: new Date(SUN + 3 * DAY).toISOString() }] });
  ok(L(after, 3, SUN) === 0, 'a midweek tie the following week does not count');

  /* The taper: full inside CONGEST_FULL, nothing beyond CONGEST_FADE. */
  const at = (d) => L(API.euroIndex({ rows: [{ team: 3, comp: 'UCL', kickoff: before(d) }] }), 3, SUN);
  near(at(2), 1, 1e-9, 'two days before is full load');
  near(at(3), 1, 1e-9, 'three days before — the classic Thursday-to-Sunday — is full load');
  ok(at(7) === 0, 'a week before is a normal rest and scores nothing');
  ok(at(6) === 0, 'and so is the fade boundary itself');
  ok(at(4) > 0 && at(4) < 1, 'four days before is partial');
  ok(at(4) > at(5), 'and the taper is monotonic — closer is always worse');

  /* Two competitions in one week stack, but the total is bounded. */
  const two = API.euroIndex({ rows: [
    { team: 3, comp: 'UEL', kickoff: before(3) },
    { team: 3, comp: 'EFL', kickoff: before(5.5) },
  ] });
  ok(L(two, 3, SUN) > 1, 'two extra matches stack above one');
  ok(L(two, 3, SUN) <= 2, 'but the load is capped so a freak week cannot run away');
}

console.log('• congestionFactor: the nailed starter is taxed least');
{
  const F = API.congestionFactor;
  ok(F(0, 0.5) === 1 && F(null, 0.5) === 1, 'no congestion changes nothing');
  ok(F(1, 1) < 1, 'even a certain starter loses something in a congested week');
  ok(F(1, 0.5) < F(1, 1), 'a squad player loses more than a nailed one');
  ok(F(1, 0) < F(1, 0.5), 'and a fringe player more still');
  ok(F(1, 1) >= 1 - API.CONGEST_MAX, 'the nailed case is bounded by the maximum bite');
  ok(F(2, 0) >= 0.5, 'the factor never collapses to nothing, however congested');
  ok(F(0.5, 0.5) > F(1, 0.5), 'a partial week bites less than a full one');
  /* Load is clamped, so a stacked week cannot be scored twice over. */
  ok(F(2, 0.5) === F(1, 0.5), 'load beyond one is already capped inside the factor');
}

console.log('• minutesModel: congestion suppresses starts, not appearances');
{
  const M = API.minutesModel;
  /* A regular starter who occasionally gets a rest: 8 starts in 10, and a
     couple of substitute outings on top. */
  const el = { status: 'a', chance_of_playing_next_round: null, starts: 8, minutes: 760 };
  const base = M(el, 10, 0);
  const hit = M(el, 10, 1);

  ok(hit.pStart < base.pStart, 'a congested week lowers the chance of a start');
  ok(hit.pAppear < base.pAppear, 'and the chance of appearing at all, a little');
  ok((base.pStart - hit.pStart) > (base.pAppear - hit.pAppear),
    'but starts fall further than appearances — a rested player is benched, not dropped');
  ok(hit.p60 < base.p60, 'the 60-minute probability follows the start');
  ok(hit.minFrac < base.minFrac, 'and so do expected minutes');
  ok(M(el, 10) .pStart === base.pStart, 'omitting congestion is the same as none');
  ok(M(el, 10, undefined).pStart === base.pStart, 'and so is passing undefined');

  /* An injured player is already at zero; congestion cannot make it worse. */
  const out = { status: 'i', starts: 8, minutes: 760 };
  ok(M(out, 10, 1).pStart === 0 && M(out, 10, 0).pStart === 0, 'a ruled-out player is unaffected');

  /* The nailed man barely moves; the rotation risk takes the hit. */
  const nailed = M({ status: 'a', starts: 10, minutes: 900 }, 10, 1);
  const nailedBase = M({ status: 'a', starts: 10, minutes: 900 }, 10, 0);
  const fringe = M({ status: 'a', starts: 4, minutes: 400 }, 10, 1);
  const fringeBase = M({ status: 'a', starts: 4, minutes: 400 }, 10, 0);
  const drop = (a, b) => (b.pStart - a.pStart) / Math.max(b.pStart, 1e-9);
  ok(drop(fringe, fringeBase) > drop(nailed, nailedBase),
    'proportionally, the fringe player loses more of his start than the nailed one');
}

console.log('• congestionClubs: naming the tie, not just the number');
{
  const b = { euro: API.euroIndex({ rows: [
    { team: 3, comp: 'UEL', kickoff: before(3) },
    { team: 3, comp: 'EFL', kickoff: before(5) },
    { team: 8, comp: 'UCL', kickoff: before(4) },
    { team: 9, comp: 'UCL', kickoff: before(9) },        // too long ago to matter
  ] }) };
  const nf = {
    3: { event: 11, kickoff: SUN, congest: API.congestionLoad(b.euro, 3, SUN) },
    8: { event: 11, kickoff: SUN, congest: API.congestionLoad(b.euro, 8, SUN) },
    9: { event: 11, kickoff: SUN, congest: API.congestionLoad(b.euro, 9, SUN) },
    14: { event: 11, kickoff: SUN, congest: 0 },
  };
  const rows = API.congestionClubs(b, nf);
  ok(rows.length === 2, 'only clubs actually carrying load are listed');
  ok(rows[0].team === 3, 'worst first');
  ok(rows[0].games.length === 2, 'and the contributing matches come with it');
  ok(rows[0].games[0].comp === 'UEL', 'most recent match first, so the copy names the relevant tie');
  ok(rows.every((r) => r.team !== 9), 'a match nine days ago is not congestion');
  ok(rows.every((r) => r.team !== 14), 'nor is an uncongested club listed');

  ok(API.congestionClubs({}, nf).length === 0, 'no calendar means no card at all');
  ok(API.congestionClubs(b, null).length === 0, 'and no fixtures means nothing to report');
  ok(API.congestionGames(b.euro, 3, NaN).length === 0, 'an unknown kickoff yields no detail');
}

console.log('• team-elo: club ratings keyed by the official FPL team id');
{
  const csv = [
    'code,id,name,short_name,strength,pulse_id,elo,fotmob_name',
    '3,1,Arsenal,ARS,5,1,2064,Arsenal',
    '7,2,Aston Villa,AVL,3,2,1921,Aston Villa',
    '90,3,Burnley,BUR,2,43,1666,Burnley',
  ].join('\n');
  const m = TE.eloMap(TE.parseCsv(csv));
  ok(m[1] === 2064 && m[3] === 1666, 'ratings are keyed by FPL team id, so no name matching is needed');
  ok(Object.keys(m).length === 3, 'every club with a rating is returned');

  /* A bad rating goes MISSING rather than being clamped — the caller then
     falls back to the generic prior, which is honest. A clamped value would
     be a confident wrong answer. */
  const bad = TE.eloMap(TE.parseCsv([
    'id,name,elo',
    '1,Good,1900',
    '2,Zeroed,0',
    '3,Absurd,99999',
    '4,Blank,',
    '5,Words,n/a',
    ',Nameless,1800',
  ].join('\n')));
  ok(Object.keys(bad).length === 1 && bad[1] === 1900, 'zero, absurd, blank and non-numeric ratings are dropped');
  ok(bad[2] === undefined && bad[3] === undefined, 'and are absent rather than clamped to a plausible-looking value');
  ok(Object.keys(TE.eloMap([])).length === 0 && Object.keys(TE.eloMap(null)).length === 0, 'no rows is safe');

  /* Season choice: July belongs to the coming campaign, and unlike the cup
     calendar last season IS a sane fallback here — a club's strength does not
     reset in August, so a rating from the last completed season beats none. */
  ok(TE.deriveSeasonLabel(new Date('2026-07-26T00:00:00Z')) === '2026-2027', 'July is the coming season');
  ok(TE.seasonCandidates(new Date('2026-07-26T00:00:00Z')).join() === '2026-2027,2025-2026',
    'and last season is a legitimate fallback for a strength rating');
}

console.log('• cached: a failed fetch is never pinned for the full TTL');
{
  /* The best-effort loaders resolve to null when their endpoint is
     unreachable. Caching that for six hours turns one transient blip into six
     hours without the feature — which is exactly what happened while wiring
     the cup calendar up, and cost an afternoon of confusing browser runs. */
  const store = {};
  /* `ck` namespaces every key by the active game pack; it comes along
     verbatim so the test exercises the real scoping rather than a stub. */
  const CACHE = new Function(
    'MEM', 'localStorage', 'noteData', 'GAME',
    grabFn('ck') + '\n' +
    /* The Refresh button raises this floor so entries written before it are
       ignored and refetched; cached() reads it on both its hit paths and
       clamps its write stamp up to it. Nothing here exercises a refresh, so
       a resting 0 is the honest value — every real timestamp clears it, and
       the behaviour under test is unchanged by its presence. */
    'let CACHE_FLOOR=0;\n' +
    /* grabFn anchors on `function cached(`, which drops the `async`
       keyword in front of it — put it back or the awaits inside are a
       syntax error. */
    'async ' + grabFn('cached') + '\nreturn cached;'
  )({}, {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
  }, () => {}, { id: 'fpl' });

  let calls = 0;
  const failing = async () => { calls++; return null; };
  ok(await CACHE('k', 60000, failing) === null, 'a failing loader still returns null to the caller');
  ok(await CACHE('k', 60000, failing) === null, 'and again on the next call');
  ok(calls === 2, 'the loader is retried rather than served a cached failure (' + calls + ' calls)');
  ok(Object.keys(store).length === 0, 'and nothing is written to storage');

  let hits = 0;
  const working = async () => { hits++; return { ok: true }; };
  const first = await CACHE('j', 60000, working);
  const again = await CACHE('j', 60000, working);
  ok(first.ok && again.ok && hits === 1, 'a successful result IS cached, exactly once');
  ok(Object.keys(store).length === 1, 'and persisted');
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
