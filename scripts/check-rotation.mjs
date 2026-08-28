#!/usr/bin/env node
/* The rotation signal says what the data says, and keeps saying it.
 *
 * WHAT THIS IS. How many changes a manager is likely to make to his starting
 * eleven, computed from the fixture calendar alone. The point of it is the
 * timing: congestion is knowable days before team news, which is what makes it
 * usable rather than merely true. The model is vendored from the Bookings Desk
 * (bamfs1976-art/pl-bookings), which fitted it on 740 team-fixtures of 2025-26.
 *
 * WHAT IT IS NOT. A card factor. That question was asked and answered on the
 * same season: -0.09 yellows per team per match, with a 95% interval that
 * EXCLUDES an effect the size of the 0.2 gate. This predicts SELECTION and
 * nothing else — and because a rotation model sitting in the same repo as an
 * expected-points model is one import away from being mistaken for one, the
 * last section here goes looking for exactly that import.
 *
 * THE FAILURES THIS GUARDS. Each is a way the signal keeps rendering while
 * having quietly stopped meaning anything.
 *
 *   1. THE VENDORED COPY DRIFTING FROM ITS SOURCE. Delegated to
 *      scripts/vendor-rotation.mjs --check, which owns the byte proof; what is
 *      re-asserted here is that the coefficients this repo REASONS about are
 *      the ones in the file, so a silent re-vendor cannot move them under the
 *      prose that explains them.
 *
 *   2. THE LIFT QUIETLY EVAPORATING. If a refit cannot separate rest from club
 *      habit, the model is squad depth wearing a fatigue label and must not be
 *      published as anything else. The interval has to exclude zero.
 *
 *   3. THE CLUB BASELINE BEING DROPPED. Rotation habit spans 1.57 to 3.27
 *      changes a match — far larger than rest. Without the baseline this
 *      rediscovers squad depth and calls it fatigue.
 *
 *   4. BANDING ON THE ABSOLUTE. Cut on the level rather than the lift and the
 *      heaviest rotator is flagged every week whatever its schedule, while the
 *      most settled side never is. That is a table of club identity, not a
 *      forecast.
 *
 *   5. REST COMPUTED FROM LEAGUE FIXTURES ALONE. On league dates only, 74% of
 *      a season buckets as "fresh", and the mislabelling lands on exactly the
 *      European clubs this is about.
 *
 *   6. A SIDE WITH NO EVIDENCE RENDERED AS A RESTED ONE. Cup and European
 *      rounds are drawn progressively, so early in a season most clubs have no
 *      previous competitive match on file. That must read as unknown.
 *
 *   7. THE MODEL LEAKING INTO THE POINTS PATH. See above.
 *
 *     node scripts/check-rotation.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert';
import { extractEngine, ENGINE_FNS, sliceBalanced } from './extract-engine.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/* ---- load the vendored module exactly as the browser does ---------------- */
/* No dependencies, no DOM, no fetch, no state — so a bare context is a fair
   reproduction of the shell, and if that ever stops being true this throws. */
const ctx = { console };
vm.createContext(ctx);
for (const f of ['vendor/rotation.js', 'vendor/rotation_model.js', 'vendor/pl_other_fixtures.js']) {
  vm.runInContext(read(f), ctx);
}
const R = vm.runInContext('PLDRotation', ctx);
const M = vm.runInContext('PL_ROTATION_MODEL', ctx);
const CAL = vm.runInContext('PL_OTHER_FIXTURES', ctx);

/* The shell's side of the convergence: one calendar, and the horizon that says
   how far it can be trusted. Lifted out of index.html the same way the other
   suites do it, so what is graded is what ships. */
const html = read('index.html');
function lift(name) {
  const i = html.indexOf('function ' + name + '(');
  assert.ok(i > 0, `index.html no longer defines ${name}() — the shared calendar has been ` +
    'renamed or removed, and with it the single place league, cup and European football meet');
  return sliceBalanced(html, i);
}
vm.runInContext('function teamShort(b,id){return b.teams[id]?b.teams[id].short_name:"";}', ctx);
vm.runInContext(/const ROT_COMP_ALIAS=\{[^}]*\};/.exec(html)[0], ctx);
for (const n of ['competitiveCalendar', 'calendarHorizon', 'rotationEntries', 'teamRotationRisk']) {
  vm.runInContext(lift(n), ctx);
}
const call = (expr, vars) => {
  Object.assign(ctx, vars || {});
  return vm.runInContext(expr, ctx);
};

/* ---- 0. the contract is the contract ------------------------------------ */
for (const fn of ['rotationRisk', 'rotationBand', 'restDays', 'restBucket',
                  'previousMatch', 'euroAway72h']) {
  assert.equal(typeof R[fn], 'function', `PLDRotation.${fn} is missing — the vendored module no ` +
    'longer exposes the contract this app calls');
}

/* ---- 1. the vendored model is the one the desk published ----------------- */
/* The byte proof belongs to the vendoring script, which can also re-fetch. */
execFileSync('node', [join(root, 'scripts', 'vendor-rotation.mjs'), '--check'],
  { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });

/* And the numbers this repo's prose quotes are the numbers in the file. These
   are asserted rather than read because they are cited in the UI copy, in the
   vendoring script's header and here; a re-vendor that moved them would
   otherwise leave three confident explanations of a model that no longer
   exists. If upstream refits deliberately, this list is what you update, and
   updating it is the moment to re-read what the new fit actually says. */
const PUBLISHED = {
  season: '2025-26',
  fitted: 740,
  rest: { fresh: -0.159, normal: 0.077, congested: 0.157 },
  euroAwayExtra: 0.231,
  lift: 0.346,
  liftZ: 2.901,
};
assert.equal(M.season, PUBLISHED.season, 'the vendored model is from a different season than the ' +
  'evidence quoted throughout this repo');
assert.equal(M.fitted, PUBLISHED.fitted,
  `fitted on ${M.fitted} team-fixtures, not the ${PUBLISHED.fitted} this repo cites`);
assert.deepEqual(M.rest, PUBLISHED.rest,
  `rest coefficients are ${JSON.stringify(M.rest)}, not the ${JSON.stringify(PUBLISHED.rest)} ` +
  'the UI copy and the vendoring notes describe');
assert.equal(M.euroAwayExtra, PUBLISHED.euroAwayExtra, 'the European increment has moved');
assert.equal(M.lift, PUBLISHED.lift, 'the headline lift has moved');
assert.equal(M.liftZ, PUBLISHED.liftZ, 'the z statistic has moved');

/* ---- 2. rest beats club habit, or it is not a model ---------------------- */
assert.ok(Array.isArray(M.liftCi95) && M.liftCi95.length === 2,
  'the model carries no 95% interval for the lift, so there is nothing to check it against zero');
assert.ok(M.liftCi95[0] > 0,
  `the lift above the club baseline is ${M.lift} with a 95% interval of ` +
  `${JSON.stringify(M.liftCi95)}, which includes zero. Rest days would then be adding nothing a ` +
  'club average does not already carry, and this must not be published as a rotation signal');
assert.ok(M.rest.congested > M.rest.normal && M.rest.normal > M.rest.fresh,
  `the rest effect is not monotonic across the buckets (fresh ${M.rest.fresh}, ` +
  `normal ${M.rest.normal}, congested ${M.rest.congested}) — the sign has flipped somewhere and ` +
  'the model would be advising the opposite of what the season showed');

/* ---- 3. the club baseline is carried, not dropped ------------------------ */
/* Two clubs, the same schedule, different answers — otherwise the baseline is
   decorative and the model has become a rest-only one. */
const baselines = Object.entries(M.clubBaseline);
assert.ok(baselines.length >= 20, `${baselines.length} club baselines, not a full league`);
const heavy = baselines.slice().sort((a, b) => b[1] - a[1])[0][0];
const light = baselines.slice().sort((a, b) => a[1] - b[1])[0][0];
const spread = M.clubBaseline[heavy] - M.clubBaseline[light];
assert.ok(spread > 1,
  `club habit spans only ${spread.toFixed(2)} changes a match. The whole reason the baseline is ` +
  'in this model is that habit is the big term; if it has collapsed, rest is being asked to ' +
  'explain variation that is not there');

const rested = [{ d: '2026-09-13T14:00:00+00:00', comp: 'PL', v: 'H' }];
const tired = [{ d: '2026-09-17T19:00:00+00:00', comp: 'UEL', v: 'A' }, ...rested];
const when = '2026-09-20T15:30:00+00:00';

const heavyRested = R.rotationRisk(M, heavy, rested, when);
const lightRested = R.rotationRisk(M, light, rested, when);
assert.ok(heavyRested.expected > lightRested.expected,
  `${heavy} and ${light} return the same expected changes on an identical schedule, so the club ` +
  'baseline is not reaching the answer — the model has been reduced to squad depth wearing a ' +
  'fatigue label');
assert.equal(heavyRested.baseline, M.clubBaseline[heavy], 'the reported baseline is not the club\'s own');

/* ---- 4. the band reads the lift, not the level --------------------------- */
assert.equal(heavyRested.band, 'settled',
  `${heavy} rotates most in the league and must still read "settled" when rested — a band cut on ` +
  'the absolute would flag them every week whatever their schedule');
const lightTired = R.rotationRisk(M, light, tired, when);
assert.ok(['raised', 'high'].includes(lightTired.band),
  `${light} rotates least and must still raise a flag when congested — cut on the absolute, the ` +
  'most settled side in the league never raises one');
/* And the published cuts are the documented ones. */
assert.equal(R.rotationBand(0.30), 'high', 'the high cut is no longer +0.30');
assert.equal(R.rotationBand(0.10), 'raised', 'the raised cut is no longer +0.10');
assert.equal(R.rotationBand(-0.10), 'settled', 'the settled cut is no longer -0.10');
assert.equal(R.rotationBand(0), 'normal', 'a club on its own average is not "normal"');

/* ---- 5. rest is measured over every competition -------------------------- */
/* The same club, the same league fixture: once with the midweek European tie
   visible, once with only the league dates. If those agree, the module is
   counting league football and the European clubs are being mislabelled as
   fresh — which is the specific bias that makes a fatigue factor measure
   nothing. */
const wholeCalendar = R.rotationRisk(M, light, tired, when);
const leagueOnly = R.rotationRisk(M, light, tired.filter((e) => e.comp === 'PL'), when);
assert.notEqual(wholeCalendar.bucket, leagueOnly.bucket,
  'dropping the midweek European tie does not change the rest bucket, so rest is being computed ' +
  'from league dates alone. On league dates only, 74% of a season reads as "fresh" and the ' +
  'mislabelling lands on exactly the European clubs this signal is about');
assert.equal(wholeCalendar.bucket, 'congested', 'Thursday to Sunday is not reading as congested');
assert.equal(leagueOnly.bucket, 'fresh', 'the league-only view should be the over-rested one');

/* The European away trip is derived from the dates, not hand-flagged. */
assert.equal(wholeCalendar.euroAway72h, true, 'an away UEL tie three days out is not being flagged');
const homeTie = [{ d: '2026-09-17T19:00:00+00:00', comp: 'UEL', v: 'H' }, ...rested];
assert.equal(R.rotationRisk(M, light, homeTie, when).euroAway72h, false,
  'a HOME European tie is being charged the away-trip increment');
assert.ok(wholeCalendar.expected > R.rotationRisk(M, light, homeTie, when).expected,
  'the away trip adds nothing, so the increment is not reaching the answer');

/* ---- 6. no evidence reads as unknown, never as rested -------------------- */
const nothingKnown = R.rotationRisk(M, light, [], when);
assert.equal(nothingKnown.known, false,
  'a club with no previous competitive match reports known:true — it would render as a well-rested ' +
  'side, which is the single most misleading thing this signal can do while the cup and European ' +
  'draws are still being made');
assert.equal(nothingKnown.bucket, null, 'an unknown bucket must be null, not a guess');
assert.equal(nothingKnown.lift, 0,
  'a club with no evidence is being given a non-zero lift, so it would carry a band it has not earned');
assert.equal(nothingKnown.expected, Math.round(M.clubBaseline[light] * 100) / 100,
  'with no rest evidence the answer must fall back to the club\'s own baseline and nothing more');
assert.equal(R.rotationRisk(M, light, rested, when).known, true,
  'a club with a previous match is reporting known:false');

/* The shipped calendar must actually be able to answer the question for
   somebody. A file that parses but describes nobody is the silent version of
   this failing. */
assert.ok(Array.isArray(CAL) && CAL.length > 0, 'the vendored calendar is empty');
assert.ok(CAL.every((r) => r && r.c && r.d && r.comp && (r.v === 'H' || r.v === 'A')),
  'a calendar row is missing a club, date, competition or venue — the venue is what the 72-hour ' +
  'European flag reads, and a missing one silently becomes "not an away trip"');

/* ---- 7. and it is not being used to price points ------------------------- */
/* The card question was asked and answered: no effect at the 0.2 gate. The
   equivalent here is the expected-points engine, and the check is the same —
   a rotation model in the same repo as a points model is one import away from
   being mistaken for one.

   The engine is checked as EXTRACTED rather than as source text, because that
   is the artefact the renderer and the tests actually evaluate: a reference
   that made it into the bundle is a reference that ships. */
const engine = extractEngine(join(root, 'index.html'));
const LEAK = /PLDRotation|PL_ROTATION_MODEL|rotationRisk|rotationBand|rotation_model/;
assert.ok(!LEAK.test(engine),
  'the extracted expected-points engine references the rotation model. Rest days do not move a ' +
  'points projection through this model — what was measured is SELECTION, and the card version of ' +
  'the same question came back with an interval excluding the gate. The engine has its own ' +
  'congestion term (congestionLoad/congestionFactor) fitted for minutes; this is not it');
assert.ok(engine.length > 1000 && ENGINE_FNS.every((n) => engine.includes(n)),
  'the engine extraction came back empty or partial, so the leak check above passed vacuously');

/* The daily-content renderer publishes numbers from that same engine. */
for (const p of ['scripts/content/model.mjs', 'scripts/extract-engine.mjs']) {
  if (!existsSync(join(root, p))) continue;
  assert.ok(!LEAK.test(read(p)),
    `${p} reads the rotation model. It is on the published-numbers path; this signal predicts ` +
    'team selection and must not become an input to a points or card projection');
}

/* ---- 8. one calendar, and one place it is merged ------------------------- */
/* THE CONVERGENCE THIS PINS. There were two notions of congestion in this repo
   fed by two different calendars: `congestionLoad`, a per-player minutes term
   reading the live cup/European feed, and this, a per-club count of changes
   reading league football as well. They disagreed on exactly the case that
   matters most — a midweek LEAGUE fixture, which the minutes term cannot see at
   all because /api/euro-fixtures deliberately excludes the Premier League.

   The fix was to merge once, in competitiveCalendar(), and let each consumer
   take the slice it is calibrated for. What must not happen now is a second
   merge growing back somewhere else. */
/* A club with no tie in the vendored snapshot, so this case isolates the
   live feed + league merge. PICKED DYNAMICALLY: the calendar is refreshed
   daily and rounds are drawn progressively, so any hardcoded club (it used
   to be MCI) eventually gains a snapshot tie and fails this guard for a
   reason that has nothing to do with the merge. The snapshot's own
   contribution is asserted separately below, with a club that does. */
const CANDIDATES = [
  ['MCI', 'Manchester City'], ['LIV', 'Liverpool'], ['ARS', 'Arsenal'],
  ['CHE', 'Chelsea'], ['TOT', 'Tottenham'], ['MUN', 'Manchester United'],
  ['NEW', 'Newcastle'], ['AVL', 'Aston Villa'], ['WHU', 'West Ham'],
  ['BHA', 'Brighton'], ['EVE', 'Everton'], ['FUL', 'Fulham'],
  ['CRY', 'Crystal Palace'], ['WOL', 'Wolves'], ['BOU', 'Bournemouth'],
  ['BRE', 'Brentford'], ['NFO', "Nott'm Forest"], ['BUR', 'Burnley'],
  ['LEE', 'Leeds'], ['SUN', 'Sunderland'],
];
/* In a League Cup week every club can hold a snapshot tie at once. The
   merge consults the snapshot only by short code (r.c !== code), so a code
   that cannot appear in it behaves identically to a real club without a
   tie — and keeps this case meaningful in those weeks. */
const isolated = CANDIDATES.find(([c]) => CAL.every((r) => r.c !== c))
  || ['ZZZ', 'Isolation FC'];
assert.equal(CAL.filter((r) => r.c === isolated[0]).length, 0,
  'the chosen club has a tie in the vendored snapshot, so it does not isolate the live-feed merge');
const TEAMS = { 1: { short_name: isolated[0], name: isolated[1] } };
const bLive = { teams: TEAMS, euro: { 1: [{ gw: 5, comp: 'EFL', ms: Date.parse('2026-09-16T19:00:00Z'), v: 'A' }] } };
const league = [
  { team_h: 1, team_a: 2, kickoff_time: '2026-09-13T14:00:00Z', event: 4 },
  { team_h: 2, team_a: 1, kickoff_time: '2026-09-20T15:30:00Z', event: 5 },
  /* A fixture FPL has not scheduled yet. It must be skipped, not guessed. */
  { team_h: 1, team_a: 3, kickoff_time: null, event: 6 },
];
const cal = call('competitiveCalendar(b,f,1)', { b: bLive, f: league });
assert.equal(cal.length, 3, `the calendar merged ${cal.length} entries, expected 3 — two dated ` +
  'league fixtures plus one cup tie, with the unscheduled fixture skipped');
assert.ok(cal.every((e) => Number.isFinite(e.ms)), 'a calendar entry has no usable kick-off time');
assert.deepEqual(cal.map((e) => e.ms), cal.map((e) => e.ms).slice().sort((a, b) => a - b),
  'the calendar is not in kick-off order, so "the previous match" is not well defined');
assert.deepEqual(cal.map((e) => e.src), ['fpl', 'euro', 'fpl'],
  'calendar entries have lost their provenance — which source an entry came from is what lets ' +
  'the minutes term and the rotation model take different slices of one calendar');
assert.deepEqual(cal.map((e) => e.league), [true, false, true], 'the league flag is wrong');
/* The domestic cup arrives from the feed spelled the endpoint's way and must
   be normalised into the model's vocabulary, or it silently stops matching. */
assert.equal(cal[1].comp, 'LCUP',
  `the League Cup reached the model as "${cal[1].comp}" rather than LCUP — the feed's spelling ` +
  'is not being normalised, and the vendored contract documents PL/UCL/UEL/UECL/FAC/LCUP');

/* THE SNAPSHOT FILLS WHAT THE FEED HAS NOT GOT. This is the offline half of
   the calendar and the reason the signal still works when /api/euro-fixtures is
   unreachable — so it has to be reached when the feed is silent... */
const snap = CAL.filter((r) => r.c === 'CHE')[0];
assert.ok(snap, 'the vendored snapshot has no CHE tie to test the fallback with');
const bNoFeed = { teams: { 1: { short_name: 'CHE', name: 'Chelsea' } } };
const filled = call('competitiveCalendar(b,f,1)', { b: bNoFeed, f: [] });
assert.equal(filled.length, 1,
  'with no live feed the vendored snapshot is not filling the calendar, so an app that cannot ' +
  'reach /api/euro-fixtures would read every club as rested');
assert.equal(filled[0].src, 'vendor', 'the snapshot entry is not tagged as vendored');

/* ...and NOT counted twice when the feed has the same tie. */
const bDup = { teams: bNoFeed.teams, euro: { 1: [{ gw: 2, comp: 'LCUP', ms: Date.parse(snap.d), v: snap.v }] } };
const merged = call('competitiveCalendar(b,f,1)', { b: bDup, f: [] });
assert.equal(merged.length, 1,
  'a tie present in both the live feed and the vendored snapshot is being counted twice, which ' +
  'would shorten the apparent rest gap and invent congestion out of a de-duplication bug');
assert.equal(merged[0].src, 'euro', 'the live feed must win over the snapshot, not the other way round');

/* ...and a draw-pending PLACEHOLDER BLOCK must be dropped whole. The upstream
   harvest can publish a club as identical-timestamp rows carrying both venues
   (seen live: eight UCL rows per club, 4×H + 4×A, one kick-off); conflicting
   venues at one kick-off carry no information, and "first row wins" fed
   fabricated congestion. Conditional on the current snapshot actually holding
   such a block, so this self-disables when upstream cleans its data. */
{
  const groups = {};
  for (const r of CAL) (groups[r.c + '|' + r.d] = groups[r.c + '|' + r.d] || []).push(r);
  const block = Object.values(groups).find((g) =>
    g.length > 1 && g.some((r) => (r.v || 'H') !== (g[0].v || 'H')));
  if (block) {
    const club = block[0].c;
    const bPh = { teams: { 1: { short_name: club, name: club } } };
    const calPh = call('competitiveCalendar(b,f,1)', { b: bPh, f: [] });
    assert.ok(calPh.every((e) => e.ms !== Date.parse(block[0].d)),
      club + ': a conflicting-venue placeholder block from the snapshot leaked into the calendar');
  }
}

/* rotationEntries must be a VIEW over that calendar, not a second merge. */
const view = call('rotationEntries(b,f,1)', { b: bLive, f: league });
assert.deepEqual(view.map((e) => Date.parse(e.d)), cal.map((e) => e.ms),
  'rotationEntries no longer matches competitiveCalendar — a second merge has grown back, and ' +
  'the two will drift the way the minutes term and this model already did once');
assert.ok(view.every((e) => e.d && e.comp && (e.v === 'H' || e.v === 'A')),
  'a rotation entry is missing the {d,comp,v} the vendored contract requires');

/* ---- 9. rest past the drawn calendar is flagged, not asserted ------------ */
/* The season-long failure this catches. The league fixture list is published in
   June, so from GW2 rest is always computable — and a club whose midweek cup
   tie has not been DRAWN yet therefore reads "fresh" confidently and wrongly.
   That is worse than the opening-weekend known:false, because it renders as an
   answer rather than as a blank. */
const horizon = call('calendarHorizon(b)', { b: bLive });
assert.equal(horizon, Date.parse('2026-09-16T19:00:00Z'),
  'calendarHorizon is not reporting the last known cup or European date');

const beyond = call('teamRotationRisk(b,f,1,Date.parse("2027-05-01T15:00:00Z"))', { b: bLive, f: league });
assert.equal(beyond.restProvisional, true,
  'a fixture beyond the drawn cup and European calendar is not flagged provisional. Past that ' +
  'horizon a club can only look MORE rested than it will turn out to be, and an unflagged ' +
  '"settled" is the confident wrong answer this signal exists to avoid');
const within = call('teamRotationRisk(b,f,1,Date.parse("2026-09-20T15:30:00Z"))', { b: bLive, f: league });
assert.equal(within.restProvisional, false,
  'a fixture inside the drawn calendar is being flagged provisional, which would put a caveat on ' +
  'every row and train people to ignore it');
assert.equal(within.bucket, 'congested',
  'the midweek League Cup tie four days out is not reaching the rest bucket');

/* ---- 10. the minutes term keeps its own, narrower input ------------------ */
/* congestionLoad is a GRADED term in the points model. Widening its input to
   the merged calendar — which is the obvious next move, and probably the right
   one — changes every projection, so it is a measurement to be backtested and
   not a tidy-up to be slipped in. Until that measurement happens, this fails if
   the merged calendar reaches the points path. */
assert.ok(!/competitiveCalendar|calendarHorizon|rotationEntries/.test(engine),
  'the shared calendar has reached the extracted points engine. congestionLoad is fitted against ' +
  'the live non-league feed alone; feeding it league football changes every projection and must ' +
  'be graded through dev/backtest-vaastav.mjs first, not adopted as a refactor');
assert.ok(/deliberately absent/.test(read('netlify/functions/euro-fixtures.js')),
  'netlify/functions/euro-fixtures.js no longer documents that the Premier League is excluded. ' +
  'That exclusion is why congestionLoad cannot see midweek league football, and it is the open ' +
  'question this convergence deliberately left measured-but-unclosed');

/* ---- report ------------------------------------------------------------- */
const calDays = Math.round(
  (Math.max(...CAL.map((r) => Date.parse(r.d))) - Date.now()) / 86400000);
console.log(`check-rotation OK: fitted on ${M.fitted} team-fixtures of ${M.season}; ` +
  `rest fresh ${M.rest.fresh}, normal ${M.rest.normal}, congested ${M.rest.congested}, ` +
  `European away extra ${M.euroAwayExtra}; lift ${M.lift} above club habit ` +
  `(CI ${M.liftCi95[0]} to ${M.liftCi95[1]}, z ${M.liftZ}); club habit spans ` +
  `${spread.toFixed(2)}; bands cut on lift; ${CAL.length} cup/European dates reaching ` +
  `${calDays} days out; one calendar feeds it; no points path reads it`);
