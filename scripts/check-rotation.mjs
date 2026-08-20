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
import { extractEngine, ENGINE_FNS } from './extract-engine.mjs';

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

/* ---- report ------------------------------------------------------------- */
const horizon = Math.round(
  (Math.max(...CAL.map((r) => Date.parse(r.d))) - Date.now()) / 86400000);
console.log(`check-rotation OK: fitted on ${M.fitted} team-fixtures of ${M.season}; ` +
  `rest fresh ${M.rest.fresh}, normal ${M.rest.normal}, congested ${M.rest.congested}, ` +
  `European away extra ${M.euroAwayExtra}; lift ${M.lift} above club habit ` +
  `(CI ${M.liftCi95[0]} to ${M.liftCi95[1]}, z ${M.liftZ}); club habit spans ` +
  `${spread.toFixed(2)}; bands cut on lift; ${CAL.length} cup/European dates reaching ` +
  `${horizon} days out; no points path reads it`);
