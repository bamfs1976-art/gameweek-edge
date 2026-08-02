/*
 * Tests for the multi-season history artefact (data/fpl-history.json) and the
 * priors derived from it.
 *
 * The artefact is built offline from ~250k rows of open data and then trusted
 * by four panels, so the failure mode to guard against is silent corruption —
 * a join that fragments careers, an era flag that lets the model read a column
 * that did not exist yet, a prior that ranks a player it has no data for. None
 * of those throw; they just produce confident nonsense. So what is tested here:
 *
 *   1. the artefact is well formed and self-describing (cols/seasons/players);
 *   2. careers join across seasons on the stable `code`, not on name;
 *   3. era flags match what each season's columns can actually support;
 *   4. aggregates are internally consistent (appearances <= gameweeks, etc.);
 *   5. priors are minutes-weighted, recency-weighted and era-aware;
 *   6. a player with no Premier League history gets the fallback, flagged low
 *      confidence, rather than silently ranking last.
 *
 * Run: node dev/test-history.mjs   (wired into npm test)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildPriors, seasonWeight, PRIOR_VERSION, draftXP6, priorIndex, shapeFor,
  careersOf, mysteryFor, mysteryPool, daySeed,
} from '../scripts/history/priors.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PATH = join(ROOT, 'data', 'fpl-history.json');

let failures = 0, passes = 0;
const ok = (c, label) => { if (c) passes++; else { failures++; console.error('  ✗ ' + label); } };

if (!existsSync(PATH)) {
  /* Same contract as the vaastav backtest: skip cleanly rather than fail on a
     machine that has not run the fetch step. */
  console.log('data/fpl-history.json not built — skipping (run: npm run history)');
  process.exit(0);
}

const H = JSON.parse(readFileSync(PATH, 'utf8'));
const C = Object.fromEntries(H.cols.map((c, i) => [c, i]));

console.log('• the artefact is well formed and self-describing');
{
  ok(H.v === 1, 'it is versioned');
  ok(Array.isArray(H.cols) && H.cols.length > 20, 'it publishes its own column order');
  ok(typeof H.seasons === 'object' && Object.keys(H.seasons).length >= 8,
    'it covers at least eight seasons');
  ok(Array.isArray(H.players) && H.players.length > 1000, 'it has a real number of careers');
  ok(/vaastav/.test(H.source?.name || ''), 'it names its source');
  ok(/lookahead/i.test(H.source?.note || ''), 'it records why xP is not read');
  ok(!JSON.stringify(H).includes('"xP"'), 'and no xP column leaked into the output');
}

console.log('• careers join across seasons on the stable player code');
{
  const multi = H.players.filter((p) => Object.keys(p.s).length >= 8);
  ok(multi.length > 20, 'many players span eight or more seasons');

  const salah = H.players.find((p) => /Salah/i.test(p.n));
  ok(!!salah, 'a known long career is present');
  if (salah) {
    const seasons = Object.keys(salah.s).length;
    const pts = Object.values(salah.s).reduce((t, s) => t + s[C.pts], 0);
    /* He joined Liverpool for 2017-18, so nine of the ten seasons. If the join
       were name-based across the three historical name formats this would
       fragment into two or three short careers. */
    ok(seasons === 9, `the career spans nine seasons (got ${seasons})`);
    ok(pts > 2000, `and accumulates a career-scale total (got ${pts})`);
  }

  const codes = new Set(H.players.map((p) => p.c));
  ok(codes.size === H.players.length, 'player codes are unique — no career is listed twice');
}

console.log('• era flags match what each season can actually support');
{
  for (const [season, meta] of Object.entries(H.seasons)) {
    const anySeason = H.players.filter((p) => p.s[season]);
    if (!anySeason.length) continue;
    const totalXg = anySeason.reduce((t, p) => t + p.s[season][C.xg], 0);
    const totalDc = anySeason.reduce((t, p) => t + p.s[season][C.dc], 0);
    if (!meta.era.xg) ok(totalXg === 0, `${season}: no xG recorded when the era lacks it`);
    else ok(totalXg > 0, `${season}: xG is present when the era has it`);
    if (!meta.era.defcon) ok(totalDc === 0, `${season}: no defensive contribution before it existed`);
  }
  ok(H.seasons['2025-26']?.era.defcon === true, 'DefCon is flagged for 2025-26');
  ok(H.seasons['2016-17']?.era.xg === false, 'and xG is correctly absent from 2016-17');
  ok(H.seasons['2019-20']?.gwGap === 47,
    'the COVID season records its gameweek numbering gap (1-29 then 39-47)');
  ok(H.seasons['2019-20']?.gws === 38, 'while still counting as 38 gameweeks');
}

console.log('• aggregates are internally consistent');
{
  let bad = 0, blanksExceedApps = 0, minutesWithoutApps = 0;
  for (const p of H.players) {
    for (const [season, s] of Object.entries(p.s)) {
      const gws = H.seasons[season]?.gws || 38;
      if (s[C.ap] > gws + 2) bad++;                        /* +2 slack for DGWs */
      if (s[C.bl] > s[C.ap]) blanksExceedApps++;
      if (s[C.m] > 0 && s[C.ap] === 0) minutesWithoutApps++;
      if (s[C.hap] + s[C.awap] !== s[C.ap]) bad++;
    }
  }
  ok(bad === 0, 'appearances fit the season and split home/away exactly');
  ok(blanksExceedApps === 0, 'a player never blanks more often than they appear');
  ok(minutesWithoutApps === 0, 'minutes never accrue without an appearance');
}

console.log('• priors are minutes-weighted, recency-weighted and era-aware');
{
  ok(typeof PRIOR_VERSION === 'string' && PRIOR_VERSION.length > 0, 'priors are versioned');

  const seasons = Object.keys(H.seasons).sort();
  const recent = seasons[seasons.length - 1];
  const oldest = seasons[0];
  ok(seasonWeight(recent, recent) > seasonWeight(oldest, recent),
    'a recent season counts for more than a decade-old one');
  ok(seasonWeight(oldest, recent) > 0, 'but an old season still counts for something');

  const priors = buildPriors(H);
  ok(priors.size > 1000, 'a prior is produced for every career with usable minutes');

  const salah = H.players.find((p) => /Salah/i.test(p.n));
  const pr = salah && priors.get(salah.c);
  ok(!!pr, 'a prior exists for a well-known player');
  if (pr) {
    ok(pr.per90.gi > 0.4, `an elite attacker has a high per-90 goal involvement (got ${pr.per90.gi})`);
    ok(pr.conf > 0.8, `and high confidence from a decade of minutes (got ${pr.conf})`);
    ok(pr.basis.seasons >= 3, 'built from several seasons, not just the last one');
  }

  /* A low-minutes player must not out-rank an elite one on a tiny sample. */
  const thin = [...priors.values()].filter((x) => x.basis.minutes < 400);
  ok(thin.length > 0, 'there are thin-sample players to check');
  ok(thin.every((x) => x.conf < 0.6), 'thin samples all carry low confidence');
}

console.log('• a player with no Premier League history gets a flagged fallback');
{
  const priors = buildPriors(H);
  const unknown = priors.get(-1);
  ok(unknown === undefined, 'an unknown code has no prior of its own');

  const { priorFor } = buildPriors(H, { withLookup: true });
  const newSigning = priorFor(999999, { pos: 4 });
  ok(!!newSigning, 'but a lookup still returns something usable');
  ok(newSigning.fallback === true, 'flagged as a fallback rather than passed off as real');
  ok(newSigning.conf === 0, 'with zero confidence');
  ok(newSigning.per90.gi > 0, 'and a positional baseline rather than zero, so it does not rank last');

  const fwd = priorFor(999999, { pos: 4 });
  const gkp = priorFor(999999, { pos: 1 });
  ok(fwd.per90.gi > gkp.per90.gi, 'the fallback is position-aware');
  /* Goal involvement is meaningless for a keeper, so his baseline has to live
     on the axes he actually scores on — otherwise an unknown keeper is zero
     everywhere and sorts last, which is the bug the fallback exists to stop. */
  ok(gkp.per90.sv > 0, 'an unknown keeper still gets a save baseline');
  ok(gkp.per90.cs > 0, 'and a clean-sheet baseline');
  ok(fwd.per90.sv === 0, 'while an unknown forward is not credited with saves');
}

console.log('• the Draft board ranks before a ball is kicked');
{
  const { priorFor } = buildPriors(H, { withLookup: true });
  const salah = H.players.find((p) => /Salah/i.test(p.n));

  /* Exactly the pre-season state: FPL zeroes every total at rollover, so the
     only thing separating two players is their history. */
  const preseason = (code) => ({
    code, minutes: 0, total_points: 0, element_type: 3, status: 'a',
    chance_of_playing_next_round: null,
  });

  const withHistory = draftXP6(preseason(salah.c), 1, 0, priorFor(salah.c, { pos: 3 }));
  const noHistory = draftXP6(preseason(salah.c), 1, 0, null);
  ok(noHistory === 0, 'with no prior the old behaviour stands — a zero, and an unranked board');
  ok(withHistory > 0, 'with a prior the same player gets a real projection');

  const unknown = draftXP6(preseason(999999), 1, 0, priorFor(999999, { pos: 3 }));
  ok(unknown > 0, 'a player with no PL record still scores, on the positional baseline');
  ok(withHistory > unknown, 'but an established player out-ranks him');

  /* Once real minutes exist the live rate must take over, or the board would
     keep deferring to history halfway through the season. */
  const midSeason = {
    code: salah.c, minutes: 1800, total_points: 140, element_type: 3, status: 'a',
    chance_of_playing_next_round: null,
  };
  const blended = draftXP6(midSeason, 1, 20, priorFor(salah.c, { pos: 3 }));
  const liveOnly = draftXP6(midSeason, 1, 20, null);
  ok(Math.abs(blended - liveOnly) / liveOnly < 0.25,
    'by 1,800 minutes the live rate dominates and the prior has mostly handed over');

  /* Availability still has the last word — an injured player is not a pick
     however good his decade was. */
  const injured = { ...preseason(salah.c), status: 'i' };
  ok(draftXP6(injured, 1, 0, priorFor(salah.c, { pos: 3 })) < withHistory,
    'an injury flag still discounts a strong history');
}

console.log('• career shape describes the distribution, not just the average');
{
  const idx = priorIndex(H);
  ok(!!idx && idx.byCode.size === H.players.length, 'every career is indexed by code');

  const salah = H.players.find((p) => /Salah/i.test(p.n));
  const sh = shapeFor(idx, salah.c);
  ok(!!sh, 'a shape is produced for a long career');
  ok(sh.haulRate > 0.15, `an elite attacker hauls often (got ${sh.haulRate})`);
  ok(sh.haulRate + sh.blankRate <= 1.001, 'haul and blank rates cannot exceed all appearances');
  ok(sh.sd > 0, 'the spread is real');
  ok(sh.ppa > 4, `and the mean per appearance is elite (got ${sh.ppa})`);
  ok(sh.best >= 15, 'the career-best gameweek is recorded');
  ok(sh.home != null && sh.away != null, 'home and away splits are both present');

  /* The memo must return the same object, or every render recomputes 1,600
     careers and the panels stutter. */
  ok(shapeFor(idx, salah.c) === sh, 'shapes are memoised per code');
  ok(shapeFor(idx, 999999) === null, 'an unknown code yields null rather than a fake shape');

  /* Rates are proportions and must behave like them across the whole set. */
  let bad = 0, withRegress = 0, ratioAbsurd = 0;
  for (const p of H.players) {
    const s = shapeFor(idx, p.c);
    if (!s) continue;
    if (s.haulRate < 0 || s.haulRate > 1 || s.blankRate < 0 || s.blankRate > 1) bad++;
    if (s.returnRate < s.haulRate) bad++;      /* every haul is also a return */
    if (s.regress) withRegress++;
    if (s.xgRatio != null && (s.xgRatio < 0 || s.xgRatio > 6)) ratioAbsurd++;
  }
  ok(bad === 0, 'all rates are proportions, and every haul counts as a return');
  ok(withRegress > 100, 'the regression read is available for a useful number of players');
  ok(ratioAbsurd === 0, 'no goals-versus-expected ratio is absurd');

  /* The regression read depends on expected goals, so a career that ended
     before 2022-23 must not have one invented for it. */
  const preXg = H.players.find((p) => Object.keys(p.s).every((s) => !H.seasons[s].era.xg));
  if (preXg) {
    const s = shapeFor(idx, preXg.c);
    ok(!s || s.regress === null, 'a pre-2022-23 career gets no regression read rather than a guessed one');
  }
}

console.log('• the daily puzzle is the same for everyone and changes once a day');
{
  const idx = priorIndex(H);
  const careers = careersOf(idx);
  ok(careers.length === H.players.length, 'every career is summarised');
  ok(careers.every((v) => v.ap >= 0 && v.m >= 0), 'appearances and minutes are non-negative');
  /* Points, though, genuinely can be: Kayne Ramsay's whole Premier League
     career is 180 minutes and −2 points, an own goal outweighing the
     appearance points. Anything that assumes a non-negative career total is
     wrong about FPL, so the guard is on the magnitude, not the sign. */
  ok(careers.every((v) => v.pts > -50), 'and points, which may be negative, are still sane');
  ok(careers.some((v) => v.pts < 0), 'the dataset really does contain a negative career');

  const salah = careers.find((v) => /Salah/i.test(v.n));
  ok(salah.pts > 2000 && salah.ap > 250, 'a known career totals correctly');
  ok(Math.abs(salah.ppa - salah.pts / salah.ap) < 0.001, 'points per appearance is consistent');

  const pool = mysteryPool(idx);
  ok(pool.length > 50, `the puzzle pool is a real size (got ${pool.length})`);
  ok(pool.every((v) => v.pts >= 600 && v.ap >= 80),
    'and holds only players recognisable enough to guess');

  /* Determinism is the entire premise: everyone must get the same player on
     the same day, with no server involved. */
  const a = mysteryFor(idx, '2026-08-02');
  const b = mysteryFor(idx, '2026-08-02');
  ok(a.answer.c === b.answer.c, 'the same date always yields the same player');
  ok(a.clues.length >= 5, 'there are enough clues to work with');
  ok(!a.clues.some((c) => c.toLowerCase().includes(a.answer.n.toLowerCase())),
    'no clue simply contains the answer');

  /* And it has to actually rotate — a puzzle stuck on one player is not a
     daily puzzle. */
  const days = [];
  for (let i = 1; i <= 60; i++) days.push(mysteryFor(idx, `2026-09-${String(i % 30 + 1).padStart(2, '0')}`).answer.c);
  ok(new Set(days).size > 10, `the answer rotates across dates (${new Set(days).size} distinct in 60)`);

  /* The pool order must not depend on how the artefact happened to be built,
     or a rebuild would silently change today's answer under people. */
  ok(pool.every((v, i) => i === 0 || pool[i - 1].c < v.c),
    'the pool is ordered by stable player code, so a rebuild cannot reshuffle it');

  ok(daySeed('2026-08-02') !== daySeed('2026-08-03'), 'consecutive days seed differently');
}

console.log('• the multi-season backtest separates what it can grade from what it cannot');
{
  const btPath = join(ROOT, 'data', 'backtest-history.json');
  if (!existsSync(btPath)) {
    console.log('  (data/backtest-history.json not built — skipping)');
  } else {
    const B = JSON.parse(readFileSync(btPath, 'utf8'));
    ok(B.seasons.length >= 8, 'every available season is graded');
    ok(B.seasons.every((s) => s.mode === 'shipping' || s.mode === 'proxy'),
      'each season declares which model was graded');

    /* The whole integrity of this panel: a season without expected-goals
       columns must never be labelled as the shipping model. */
    for (const s of B.seasons) {
      if (s.era.xg) ok(s.mode === 'shipping', `${s.season}: graded as shipped when xG exists`);
      else ok(s.mode === 'proxy', `${s.season}: marked proxy when xG does not exist`);
    }
    ok(B.seasons.filter((s) => s.mode === 'shipping').length === 4,
      'exactly the four expected-goals seasons count as shipping');

    /* The pooled headline must not quietly include the proxy seasons. */
    const shippingN = B.seasons.filter((s) => s.mode === 'shipping')
      .reduce((t, s) => t + s.appear.n, 0);
    ok(B.pooled.appear.n === shippingN, 'the pooled figure covers only the shipping seasons');
    ok(B.pooled.appear.n < B.seasons.reduce((t, s) => t + s.appear.n, 0),
      'and is therefore smaller than the all-season total');

    ok(B.seasons.every((s) => s.appear.model > 0 && s.appear.form > 0),
      'every season produces real error figures');
    ok(/lookahead|walk-forward/i.test(B.method), 'the method records its no-lookahead discipline');

    /* Cross-check against the single-season backtest that already ships: the
       two runners must agree on the season they share, or one of them is
       wrong about the model. */
    const s2324 = B.seasons.find((s) => s.season === '2023-24');
    ok(s2324 && Math.abs(s2324.appear.model - 2.157) < 0.01,
      'the 2023-24 figure reproduces dev/backtest-vaastav.mjs');
  }
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
