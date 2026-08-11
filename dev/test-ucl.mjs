/*
 * Tests for the Euro Matchday Edge data layer (netlify/functions/ucl.js).
 *
 * This normaliser is the highest-risk code in the second app. Every number
 * Euro Matchday Edge shows depends on it, and it was written without a reachable
 * upstream to observe — so it is deliberately tolerant of several plausible
 * field spellings, and these tests pin the behaviour that tolerance must have:
 *
 *   - a field that resolves must map to the right FPL-vocabulary property;
 *   - a field that does NOT resolve must stay null, never 0 and never ''.
 *     A silent zero is the dangerous failure here: it looks like data, it
 *     passes every downstream isFinite check, and it quietly ruins a
 *     projection. A null is visibly absent.
 *   - the position map must be exactly right, because a mis-mapped position
 *     produces a wrong answer that still looks plausible.
 *
 * Run: node dev/test-ucl.mjs   (wired into npm test)
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const mod = require(join(ROOT, 'netlify/functions/ucl.js'));
const { pick, toPos, rowsOf, normPlayer, normTeam, normFixture, unmapped, POS } = mod._internal;
const SOURCES_URL_PROBE = mod._internal.SOURCES.matches;

let failures = 0, passes = 0;
const ok = (c, label) => { if (c) passes++; else { failures++; console.error('  ✗ ' + label); } };

console.log('• pick: absent is null, never zero');
{
  ok(pick({ a: 5 }, ['a'], 'num') === 5, 'reads the first matching name');
  ok(pick({ b: 7 }, ['a', 'b'], 'num') === 7, 'falls through to a later name');
  ok(pick({}, ['a'], 'num') === null, 'missing field is null');
  ok(pick({ a: '' }, ['a'], 'num') === null, 'empty string is null');
  ok(pick({ a: null }, ['a'], 'num') === null, 'explicit null is null');
  ok(pick({ a: 'nope' }, ['a'], 'num') === null, 'unparseable number is null, not NaN');
  /* The distinction the whole design rests on. */
  ok(pick({ a: 0 }, ['a'], 'num') === 0, 'a genuine zero survives as zero');
  ok(pick(null, ['a'], 'num') === null, 'a null record is null, not a throw');
  ok(pick({ a: '12' }, ['a'], 'num') === 12, 'numeric strings are cast');
  ok(pick({ a: 'Real Madrid' }, ['a']) === 'Real Madrid', 'text passes through uncast');
}

console.log('• toPos: the mapping everything else depends on');
{
  const expect = { GK: 1, GKP: 1, GOALKEEPER: 1, DF: 2, DEF: 2, DEFENDER: 2,
    MF: 3, MID: 3, MIDFIELDER: 3, FW: 4, FWD: 4, FORWARD: 4, ST: 4 };
  for (const [k, v] of Object.entries(expect)) {
    ok(toPos(k) === v, k + ' → ' + v);
    ok(toPos(k.toLowerCase()) === v, k.toLowerCase() + ' (lowercase) → ' + v);
    ok(toPos(' ' + k + ' ') === v, k + ' (padded) → ' + v);
  }
  for (const n of [1, 2, 3, 4]) ok(toPos(n) === n, 'numeric ' + n + ' passes through');
  for (const n of ['1', '2', '3', '4']) ok(toPos(n) === Number(n), 'numeric string ' + n + ' maps');
  ok(toPos('WINGER') === null, 'an unknown code is null, not a guess');
  ok(toPos(null) === null && toPos(undefined) === null && toPos('') === null, 'absent is null');
  ok(toPos(9) === null, 'an out-of-range code is null');
  /* Every value in POS must be a legal FPL element_type. */
  ok(Object.values(POS).every((v) => [1, 2, 3, 4].includes(v)), 'every mapping lands on 1-4');
}

console.log('• rowsOf: finding the array inside an unknown envelope');
{
  ok(rowsOf([1, 2]).length === 2, 'a bare array is the rows');
  ok(rowsOf({ data: [1] }).length === 1, 'data envelope');
  ok(rowsOf({ data: { value: [1, 2, 3] } }).length === 3, 'nested data.value envelope');
  ok(rowsOf({ playerList: [] }).length === 0, 'unrecognised top-level key yields nothing');
  ok(rowsOf({ value: { playerList: [1, 2] } }).length === 2, 'value.playerList envelope');
  ok(rowsOf(null).length === 0, 'null is an empty list, not a throw');
  ok(rowsOf({}).length === 0, 'an empty object is an empty list');
}

console.log('• normPlayer: three plausible upstream spellings');
{
  /* The same player, as UEFA's compact feed, a verbose feed, and a generic one. */
  const compact = { pDId: 101, pDName: 'Vinícius', pFName: 'Vinícius', pLName: 'Júnior',
    skill: 4, tId: 7, value: 11.5, totPoints: 42, minsPlayed: 540, gsScored: 6,
    assists: 3, cleanSheet: 1, saves: 0, selPercentage: '31.2', avgPlayerPts: '4.7', pStatus: 'A' };
  const verbose = { playerId: 101, displayName: 'Vinícius', position: 'FW', currentTeamId: 7,
    currentValue: 11.5, totalPoints: 42, minutes: 540, goalsScored: 6, assist: 3 };
  const generic = { id: 101, name: 'Vinícius', pos: 'fwd', clubId: 7, price: 11.5, points: 42, mins: 540 };

  for (const [label, raw] of [['compact', compact], ['verbose', verbose], ['generic', generic]]) {
    const p = normPlayer(raw);
    ok(p.id === 101, label + ': id');
    ok(p.element_type === 4, label + ': position → FWD');
    ok(p.team === 7, label + ': club id');
    ok(p.now_cost === 115, label + ': price scaled to FPL tenths (11.5 → 115)');
    ok(p.total_points === 42, label + ': total points');
    ok(p.minutes === 540, label + ': minutes');
    ok(p.web_name === 'Vinícius', label + ': display name');
  }

  /* Absence must survive as absence all the way through. */
  const sparse = normPlayer({ id: 5, skill: 2, tId: 1 });
  ok(sparse.now_cost === null, 'no price → null, NOT 0.0');
  ok(sparse.minutes === null, 'no minutes → null, NOT 0');
  ok(sparse.total_points === null, 'no points → null, NOT 0');
  ok(sparse.goals_scored === null && sparse.assists === null, 'no returns → null');
  ok(sparse.status === 'a', 'unknown availability reads as available, not injured');
  ok(sparse.web_name === null, 'no name → null rather than an empty label');

  /* A genuine zero is different from a missing value and must stay zero. */
  const zeroed = normPlayer({ id: 6, skill: 3, tId: 2, value: 4.5, minsPlayed: 0, totPoints: 0 });
  ok(zeroed.minutes === 0, 'a real zero minutes stays 0');
  ok(zeroed.total_points === 0, 'a real zero points stays 0');
  ok(zeroed.now_cost === 45, 'and the price still scales');

  /* Availability. */
  ok(normPlayer({ id: 1, skill: 1, pStatus: 'injured' }).status === 'i', 'injured maps to i');
  ok(normPlayer({ id: 1, skill: 1, pStatus: 'I' }).status === 'i', 'single-letter injured maps to i');
  ok(normPlayer({ id: 1, skill: 1, pStatus: 'suspended' }).status === 's', 'suspended maps to s');
  ok(normPlayer({ id: 1, skill: 1, pStatus: 'Fit' }).status === 'a', 'anything else is available');

  /* A record with no usable position must be droppable by the caller. */
  ok(normPlayer({ id: 9, tId: 1 }).element_type === null, 'no position → null so the caller can drop it');
}

console.log('• normFixture: finished only when both scores are present');
{
  const played = normFixture({ mId: 1, mdId: 3, htId: 4, atId: 9, homeScore: 2, awayScore: 1 });
  ok(played.finished === true, 'both scores → finished');
  ok(played.team_h === 4 && played.team_a === 9, 'team ids');
  ok(played.event === 3, 'matchday maps to event');

  ok(normFixture({ mId: 2, htId: 4, atId: 9 }).finished === false, 'no scores → not finished');
  ok(normFixture({ mId: 3, htId: 4, atId: 9, homeScore: 0 }).finished === false,
    'one score only → not finished (a half-mapped result must not enter the fit)');
  /* 0-0 is a real result and must count — the case a truthiness check breaks. */
  const goalless = normFixture({ mId: 4, htId: 4, atId: 9, homeScore: 0, awayScore: 0 });
  ok(goalless.finished === true, 'a 0-0 is a finished match, not an absent one');
  ok(goalless.team_h_score === 0 && goalless.team_a_score === 0, 'and its scores are zero, not null');
}

console.log('• normTeam and unmapped reporting');
{
  ok(normTeam({ tId: 3, tName: 'Bayern', tSCode: 'FCB' }).short_name === 'FCB', 'short name');
  ok(normTeam({ id: 3, name: 'Bayern' }).id === 3, 'generic spelling');
  const keys = unmapped([{ id: 1, somethingNew: 2, alsoNew: 3 }], 'player');
  ok(keys.join() === 'alsoNew,somethingNew', 'unrecognised keys are reported, sorted');
  ok(unmapped([{ id: 1, skill: 4 }], 'player').length === 0, 'known keys are not reported');
}

console.log('• the UEFA football mappers (the ones that answer)');
{
  const { normMatch, normMatchTeam, teamsFromMatches, fill } = mod._internal;

  /* Shaped exactly as match.uefa.com/v5 answered on 11 Aug 2026 — a real
     record, trimmed. Mapping against an invented shape is what this app did
     for a year and it is why nothing worked. */
  const team = (id, name, code, country) => ({
    id, internationalName: name, teamCode: code, countryCode: country,
    isPlaceHolder: false, logoUrl: 'https://img.uefa.com/x.png',
    translations: { displayName: { EN: name, FR: name } }
  });
  const match = (id, h, a, hs, as, status, seq) => ({
    id, homeTeam: h, awayTeam: a, status, competitionPhase: 'LEAGUE',
    kickOffTime: { date: '2026-09-16', dateTime: '2026-09-16T19:00:00Z', utcOffsetInHours: 2 },
    matchday: { id: '1', name: `MD${seq}`, longName: `Matchday ${seq}`, sequenceNumber: String(seq) },
    score: hs == null ? {} : { total: { home: hs, away: as }, regular: { home: hs, away: as } }
  });

  const t1 = team('1001', 'Real Madrid', 'RMA', 'ESP');
  const t2 = team('1002', 'Bayern München', 'BAY', 'GER');
  const played = normMatch(match('m1', t1, t2, 2, 1, 'FINISHED', 1));
  ok(played.team_h === 1001 && played.team_a === 1002, 'both teams map');
  ok(played.team_h_score === 2 && played.team_a_score === 1, 'the score maps');
  ok(played.finished === true, 'UEFA says FINISHED, so it is finished');
  ok(played.event === 1, 'the matchday sequence becomes the engine\'s event number');
  ok(played.kickoff_time === '2026-09-16T19:00:00Z', 'kickoff comes from the nested object');

  const goalless = normMatch(match('m2', t1, t2, 0, 0, 'FINISHED', 2));
  ok(goalless.team_h_score === 0 && goalless.finished === true,
    'nil-nil is a result, not a missing one');

  const upcoming = normMatch(match('m3', t1, t2, null, null, 'UPCOMING', 3));
  ok(upcoming.finished === false, 'an unplayed match is not finished');
  ok(upcoming.team_h_score === null, 'and has no score rather than a zero');

  /* A postponed match can carry no score at all; inferring "finished" from
     two present scores would have called it unfinished forever, and
     inferring from one would have been worse. */
  const odd = normMatch({ id: 'm4', homeTeam: t1, awayTeam: t2, status: 'POSTPONED', matchday: {} });
  ok(odd.finished === false && odd.status === 'POSTPONED', 'status is carried through');

  const mapped = normMatchTeam(t2);
  ok(mapped.name === 'Bayern München', 'the English display name wins');
  ok(mapped.short_name === 'BAY' && mapped.country === 'GER', 'code and country map');

  const placeholder = { ...team('9999', 'Winner path B', 'W/B', null), isPlaceHolder: true };
  ok(normMatchTeam(placeholder).placeholder === true, 'placeholders are marked');
  const teams = teamsFromMatches([
    match('a', t1, t2, null, null, 'UPCOMING', 1),
    match('b', t2, t1, null, null, 'UPCOMING', 2),
    match('c', t1, placeholder, null, null, 'UPCOMING', 3)
  ]);
  ok(teams.length === 2, 'teams are deduplicated across the calendar (' + teams.length + ')');
  ok(!teams.some((t) => t.placeholder), 'and a placeholder is not a club you can pick');

  ok(!fill(SOURCES_URL_PROBE, { season: '../../etc' }).includes('../'),
    'a season cannot escape the URL');
}

console.log('• handler: end-to-end over a mocked UEFA');
{
  const seasons = [
    { competitionId: '1', id: '20417', name: 'UEFA Champions League 2025/2026', seasonYear: '2026',
      startDate: '2025-07-01', endDate: '2026-06-01', status: 'CLOSED' },
    { competitionId: '1', id: '20418', name: 'UEFA Champions League 2026/2027', seasonYear: '2027',
      startDate: '2026-07-06', endDate: '2027-06-05', status: 'ACTIVE' }
  ];
  const mkTeam = (id, name) => ({ id, internationalName: name, teamCode: name.slice(0, 3).toUpperCase(),
    countryCode: 'ESP', isPlaceHolder: false, translations: { displayName: { EN: name } } });
  const mkMatch = (id, h, a, seq, finished) => ({
    id, homeTeam: mkTeam(h, 'Club ' + h), awayTeam: mkTeam(a, 'Club ' + a),
    status: finished ? 'FINISHED' : 'UPCOMING', competitionPhase: 'LEAGUE',
    kickOffTime: { dateTime: '2026-09-16T19:00:00Z' },
    matchday: { sequenceNumber: String(seq), name: 'MD' + seq },
    score: finished ? { total: { home: 1, away: 0 } } : {}
  });
  const matches = [mkMatch('m1', '1', '2', 1, true), mkMatch('m2', '3', '4', 1, true),
    mkMatch('m3', '1', '3', 2, false), mkMatch('m4', '2', '4', 2, false)];

  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    const body = String(url).includes('comp.uefa.com') ? seasons
      : String(url).includes('offset=0') ? matches : [];
    return { ok: true, status: 200, json: async () => body };
  };
  const res = await mod.handler({ httpMethod: 'GET', path: '/api/ucl/bootstrap-static', rawQuery: '' });
  globalThis.fetch = realFetch;

  ok(res.statusCode === 200, 'bootstrap responds 200');
  const body = JSON.parse(res.body);

  /* The season is asked for, not assumed. This is the bug the probe found:
     the old code hard-coded 2026 and UEFA calls this season 2027. */
  ok(body.season === '2027', 'the ACTIVE season is used, not a hard-coded guess (' + body.season + ')');
  ok(seen.some((u) => u.includes('seasonYear=2027')), 'and the matches are fetched for it');

  ok(body.teams.length === 4, 'clubs come out of the calendar (' + body.teams.length + ')');
  ok(body.fixtures.length === 4, 'every match maps to a fixture');
  ok(body.matchday === 2, 'the current matchday is the earliest unfinished one');

  /* The whole point of the rewrite: no invented players. */
  ok(body.elements.length === 0, 'no players are served');
  ok(body.players.available === false, 'and their absence is declared, not implied');
  ok(/403/.test(body.players.reason), 'with the actual reason');
  ok(Array.isArray(body.players.affects) && body.players.affects.length > 0,
    'and a list of what it costs the user');
  ok(!!body.note, 'the payload carries a human sentence for the app to render');

  ok(body.game_settings.squad_squadsize === 15, 'squad rules are still declared for the engine');
  ok(body.element_types.length === 4, 'all four position types are declared');

  /* Paging: a competition is longer than one page, and stopping at the
     first would silently lose the knockouts. */
  ok(seen.filter((u) => u.includes('match.uefa.com')).length >= 1, 'the matches feed is paged');

  const fx = await (async () => {
    globalThis.fetch = async (url) => ({ ok: true, status: 200,
      json: async () => (String(url).includes('comp.uefa.com') ? seasons
        : String(url).includes('offset=0') ? matches : []) });
    const r = await mod.handler({ httpMethod: 'GET', path: '/api/ucl/fixtures', rawQuery: '' });
    globalThis.fetch = realFetch;
    return JSON.parse(r.body);
  })();
  ok(fx.fixtures.length === 4, '/fixtures returns the same calendar');

  /* An upstream 404 before a competition starts is a normal state. */
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const pre = await mod.handler({ httpMethod: 'GET', path: '/api/ucl/bootstrap-static', rawQuery: '' });
  globalThis.fetch = realFetch;
  ok(pre.statusCode === 200, 'a pre-season 404 is not surfaced as an error');
  ok(JSON.parse(pre.body).elements.length === 0, 'and returns an empty squad list');
  ok(!!JSON.parse(pre.body).note, 'with a note explaining why');

  const bad = await mod.handler({ httpMethod: 'GET', path: '/api/ucl/whatever', rawQuery: '' });
  ok(bad.statusCode === 400, 'an unknown endpoint is refused (no open proxy)');
  const post = await mod.handler({ httpMethod: 'POST', path: '/api/ucl/bootstrap-static', rawQuery: '' });
  ok(post.statusCode === 405, 'only GET is allowed');
}

console.log('• the app shell parses and uses only the shared engine');
{
  const html = readFileSync(join(ROOT, 'euro/app/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  ok(scripts.length === 1, 'one inline script');
  let parsed = true;
  try { new vm.Script(scripts[0], { filename: 'matchday-app' }); } catch (e) { parsed = false; console.error('   ' + e.message); }
  ok(parsed, 'the app script parses');

  /* The second app must not grow its own copy of the model. */
  const banned = ['function nativeXP', 'function plsimRatings', 'function squadOptimise', 'function bestXI'];
  for (const b of banned) ok(!html.includes(b), 'no local copy of ' + b.replace('function ', ''));
  ok(html.includes('window.GEEngine'), 'the model comes from the shared engine');
  ok(html.includes('<script src="engine.js">'), 'and the engine is loaded before the app');

  /* Brand rule: the competition may be described, never used as the name. */
  ok(!/<title>[^<]*Champions League/i.test(html), 'the competition is not in the product name');
  ok(/not affiliated with/i.test(html), 'the disclaimer is present');
}

console.log('• the app actually renders against the shared engine');
{
  /* Parsing the shell is not enough — a wrong engine signature or a renamed
     export only shows up when a view is rendered. So the app is executed
     here, over the real extracted engine and a mocked upstream, and every
     view is rendered and inspected. */
  const { buildEngine } = await import('../scripts/extract-engine.mjs');
  const engineSrc = buildEngine(readFileSync(join(ROOT, 'index.html'), 'utf8'));
  const appSrc = readFileSync(join(ROOT, 'euro/app/index.html'), 'utf8')
    .match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];

  /* Enough of a DOM for the shell: elements it looks up by id, plus the
     querySelectorAll it uses to wire the tabs. */
  const made = {};
  const el = (id) => (made[id] = made[id] || {
    id, innerHTML: '', textContent: '', href: 'https://gameweekedge.co.uk',
    dataset: {}, classList: { add(){}, remove(){}, toggle(){} },
    addEventListener(){}, setAttribute(){}, appendChild(){}
  });

  /* Two matchdays of results so plsimRatings has something to fit, plus an
     unplayed round for the forecast and difficulty views. */
  const players = [];
  let pid = 1;
  const addP = (skill, team, value, mins, goals) => players.push({
    pDId: pid++, pDName: 'P' + pid + '-' + skill, skill, tId: team,
    value, minsPlayed: mins, gsScored: goals, assists: 1, cleanSheet: 1, saves: skill === 1 ? 12 : 0
  });
  for (let t = 1; t <= 6; t++) {
    addP(1, t, 5.0, 540, 0); addP(1, t, 4.5, 90, 0);
    for (let i = 0; i < 5; i++) addP(2, t, 4.5 + i * 0.5, 500 - i * 40, i === 0 ? 1 : 0);
    for (let i = 0; i < 5; i++) addP(3, t, 5.5 + i * 0.7, 520 - i * 50, 2 + i);
    for (let i = 0; i < 3; i++) addP(4, t, 7.0 + i * 1.5, 480 - i * 60, 3 + i);
  }
  const teams = Array.from({ length: 6 }, (_, i) =>
    ({ tId: i + 1, tName: 'Club ' + (i + 1), tSCode: 'C' + (i + 1) }));
  /* Six played rounds, then an unplayed one. Six matters: nativeXP refuses to
     project a club with fewer than five matches behind it, so a shorter
     fixture list would exercise only the "too early" path and quietly leave
     the projection code untested. */
  const fixtures = [];
  let fid = 1;
  const ROUNDS = [
    [[1,2,2,1],[3,4,0,0],[5,6,1,3]],
    [[2,3,1,1],[4,5,2,0],[6,1,0,2]],
    [[1,3,3,0],[2,5,1,2],[4,6,1,1]],
    [[3,1,0,1],[5,2,2,2],[6,4,0,3]],
    [[1,4,2,0],[2,6,3,1],[3,5,1,0]],
    [[4,1,1,1],[6,2,0,2],[5,3,2,1]]
  ];
  ROUNDS.forEach((round, i) => round.forEach(([h, a, hs, as_]) =>
    fixtures.push({ mId: fid++, mdId: i + 1, htId: h, atId: a, homeScore: hs, awayScore: as_ })));
  /* The round every view forecasts against. */
  for (const [h, a] of [[1,5],[2,4],[3,6]])
    fixtures.push({ mId: fid++, mdId: ROUNDS.length + 1, htId: h, atId: a });

  const ctx = {
    window: {}, console,
    document: {
      getElementById: el,
      querySelectorAll: () => [],
      addEventListener(){}
    },
    location: { hash: '', href: 'https://gameweekedge.co.uk/euro/' },
    URL, URLSearchParams, setTimeout, Math, JSON, isFinite, Number, String, Object, Array, Set, Map,
    /* NOTE: this block feeds the app a payload that HAS players, which the
       live proxy can no longer produce — UEFA's fantasy feeds refuse
       server-side clients, so `elements` is empty in production. That is
       deliberate: the projection code is still the shared engine's most
       important path and must stay covered, and it would become untestable
       the moment the only fixture available had nobody in it. The block
       below this one drives the SAME app through the real handler and
       asserts the honest empty state. */
    fetch: async (url) => ({
      ok: true, status: 200,
      json: async () => {
        const u = String(url);
        const mapped = players.map((p) => mod._internal.normPlayer(p)).filter((e) => e.element_type != null);
        const fx = fixtures.map((f) => mod._internal.normFixture(f));
        if (u.includes('fixtures')) return { fixtures: fx, season: '2027' };
        return {
          game_settings: { squad_squadsize: 15, squad_squadplay: 11, squad_team_limit: 3,
            squad_total_spend: 1000, ui_currency_multiplier: 10, transfers_sell_on_fee: 0 },
          element_types: [
            { id: 1, singular_name_short: 'GKP', squad_select: 2, squad_min_play: 1, squad_max_play: 1 },
            { id: 2, singular_name_short: 'DEF', squad_select: 5, squad_min_play: 3, squad_max_play: 5 },
            { id: 3, singular_name_short: 'MID', squad_select: 5, squad_min_play: 2, squad_max_play: 5 },
            { id: 4, singular_name_short: 'FWD', squad_select: 3, squad_min_play: 1, squad_max_play: 3 }
          ],
          elements: mapped,
          teams: teams.map((t) => mod._internal.normTeam(t)),
          fixtures: fx, events: [], season: '2027', matchday: 7,
          _counts: { players: players.length, mapped: mapped.length }
        };
      }
    })
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true, status: 200,
    json: async () => (String(url).includes('/teams/') ? { data: teams }
      : String(url).includes('/fixtures/') ? { data: fixtures } : { data: players })
  });

  let ran = true, why = '';
  try {
    new vm.Script(engineSrc, { filename: 'engine.js' }).runInContext(ctx);
    new vm.Script(appSrc, { filename: 'matchday-app.js' }).runInContext(ctx);
    /* show() is async and fired on load; give its promise chain a turn. */
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  } catch (e) { ran = false; why = e.message; }
  globalThis.fetch = realFetch;

  ok(ran, 'the app boots against the engine' + (ran ? '' : ' — ' + why));
  const view = made.view ? made.view.innerHTML : '';
  ok(view.length > 200, 'the default view rendered something substantial (' + view.length + ' bytes)');
  ok(!/Could not load/.test(view), 'it is not the error state');
  ok(!/did not map/.test(view), 'it is not the unmapped-data state');
  ok(/Projected points/.test(view), 'the projected-points view rendered');
  ok(/<table/.test(view), 'with a real table of players');
  /* An xP column of dashes would mean the engine ran but produced nothing. */
  const xps = [...view.matchAll(/class="xp">([\d.]+)</g)].map((m) => Number(m[1]));
  ok(xps.length >= 5, 'several players carry a projection (' + xps.length + ')');
  ok(xps.every((v) => v > 0 && v < 25), 'every projection is a plausible points figure');
  ok(xps.some((v) => v !== xps[0]), 'projections differ between players (the model is discriminating)');
}

console.log('• with the real proxy, the app says why there are no players');
{
  /* The block above proves the projection code still works when player data
     exists. This one proves the app is honest when it does not — which, as
     of the probe on 11 Aug 2026, is production. */
  const { buildEngine } = await import('../scripts/extract-engine.mjs');
  const engineSrc = buildEngine(readFileSync(join(ROOT, 'index.html'), 'utf8'));
  const appSrc = readFileSync(join(ROOT, 'euro/app/index.html'), 'utf8')
    .match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];

  const made = {};
  const el = (id) => (made[id] = made[id] || {
    id, innerHTML: '', textContent: '', href: 'https://gameweekedge.co.uk',
    dataset: {}, classList: { add(){}, remove(){}, toggle(){} },
    addEventListener(){}, setAttribute(){}, appendChild(){}
  });

  const seasons = [{ competitionId: '1', id: '20418', name: 'UEFA Champions League 2026/2027',
    seasonYear: '2027', startDate: '2026-07-06', endDate: '2027-06-05', status: 'ACTIVE' }];
  const mkTeam = (id) => ({ id, internationalName: 'Club ' + id, teamCode: 'C' + id,
    countryCode: 'ESP', isPlaceHolder: false, translations: { displayName: { EN: 'Club ' + id } } });
  const upstream = [{ id: 'm1', homeTeam: mkTeam('1'), awayTeam: mkTeam('2'), status: 'UPCOMING',
    competitionPhase: 'LEAGUE', kickOffTime: { dateTime: '2026-09-16T19:00:00Z' },
    matchday: { sequenceNumber: '1', name: 'MD1' }, score: {} }];

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, status: 200,
    json: async () => (String(url).includes('comp.uefa.com') ? seasons
      : String(url).includes('offset=0') ? upstream : []) });

  const ctx = {
    window: {}, console,
    document: { getElementById: el, querySelectorAll: () => [], addEventListener(){} },
    location: { hash: 'players', href: 'https://gameweekedge.co.uk/euro/' },
    URL, URLSearchParams, setTimeout, Math, JSON, isFinite, Number, String, Object, Array, Set, Map,
    fetch: async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(
      (await mod.handler({ httpMethod: 'GET',
        path: String(url).includes('fixtures') ? '/api/ucl/fixtures' : '/api/ucl/bootstrap-static',
        rawQuery: '' })).body) })
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  let ran = true, why = '';
  try {
    new vm.Script(engineSrc, { filename: 'engine.js' }).runInContext(ctx);
    new vm.Script(appSrc, { filename: 'matchday-app.js' }).runInContext(ctx);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  } catch (e) { ran = false; why = e.message; }
  globalThis.fetch = realFetch;

  ok(ran, 'the app boots against a proxy with no players' + (ran ? '' : ' — ' + why));
  const view = made.view ? made.view.innerHTML : '';
  ok(!/Could not load/.test(view), 'a competition with no player feed is not an error state');
  ok(/not available/i.test(view), 'the view says player data is not available');
  ok(/403|refuse/i.test(view), 'and gives the actual reason rather than a shrug');
  ok(/clubs|fixtures/i.test(view), 'and says what still works');

  const note = made['data-note'] ? made['data-note'].textContent : '';
  ok(/clubs/.test(note), 'the footer note counts what actually loaded (' + note + ')');
}

console.log('• early in the league phase it says "too early", not "no data"');
{
  /* This is what everyone sees for the first five matchdays of an eight-round
     league phase, so it is at least as important as the happy path. The model
     declining to project is not a fault and must not read like one. */
  const html = readFileSync(join(ROOT, 'euro/app/index.html'), 'utf8');
  const appSrc = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
  const fn = appSrc.slice(appSrc.indexOf('function emptyState('));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);

  ok(/Too early for projections/.test(body), 'there is a distinct "too early" state');
  ok(/kind = 'warn'/.test(body), 'and it is styled as a warning, not an error');
  const errBranch = body.slice(body.indexOf('}else{'));
  ok(/did not map/.test(errBranch), 'only the unmapped case is styled as an error');
  ok(/XP_MIN_GAMES/.test(body), 'the threshold is stated from the constant, not hard-coded twice');
  ok(/const XP_MIN_GAMES = 5/.test(appSrc), 'and the threshold matches nativeXP\'s own gate');

  /* If nativeXP's gate ever moves, this app's copy of the number must move
     with it or the message becomes a lie. */
  const engineGate = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const nat = engineGate.slice(engineGate.indexOf('function nativeXP('));
  const gate = nat.slice(0, 300).match(/gp<(\d+)/);
  ok(gate && Number(gate[1]) === 5, 'nativeXP still refuses below 5 games (found ' +
    (gate ? gate[1] : 'no gate') + ') — update XP_MIN_GAMES in euro/app if this changed');
}

console.log('• the service worker serves the right app at /euro/');
{
  /* Both apps share an origin and therefore share one service worker, whose
     scope is the whole site whether it wants it or not. Two ways that bites:
     an offline /euro/ navigation falling back to Gameweek Edge's shell, and
     /euro/engine.js — the model itself — being pinned cache-first so a
     deployed model fix never reaches anyone with the worker installed. */
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');

  ok(/const EURO = '\/euro\/'/.test(sw), 'the worker knows about the second app');
  /* Written as "the EURO branch resolves to the euro shell" rather than as
     the whole ternary: Fantasy EFL added a third branch to the same
     expression, and pinning the literal text would make every future app on
     this origin break a test about Euro Matchday Edge. The claim being
     guarded is unchanged — a /euro/ navigation must not fall back to
     Gameweek Edge's page. */
  ok(/startsWith\(EURO\)\s*\?\s*'\/euro\/index\.html'/.test(sw),
    'offline, a /euro/ navigation falls back to the euro shell, not Gameweek Edge');
  ok(/: '\/index\.html'/.test(sw), 'everything else still falls back to Gameweek Edge');

  const codeBlock = sw.slice(sw.indexOf('const CODE'), sw.indexOf('self.addEventListener'));
  for (const p of ['/euro/engine.js', '/euro/index.html', '/euro/']) {
    ok(codeBlock.includes("'" + p + "'"), p + ' is treated as code (network-first), not a cached asset');
  }
  const shellBlock = sw.slice(sw.indexOf('const SHELL'), sw.indexOf('const CODE'));
  ok(shellBlock.includes("'/euro/'"), 'the euro shell is precached so it opens offline');

  /* A stale worker would keep serving the old cache under the old version. */
  const ver = sw.match(/const VERSION = '([^']+)'/);
  ok(ver && ver[1] !== 'ge-v5', 'the cache version was bumped so installed workers refresh (' +
    (ver ? ver[1] : 'none') + ')');
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
