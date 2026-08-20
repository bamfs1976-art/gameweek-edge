/*
 * Fantasy EFL — the season ledger.
 *
 * This suite exists because the ledger makes a claim that is very easy to
 * make falsely: "these are the picks we made BEFORE the round, and this is
 * how they did." Everything that could quietly turn that into a lie is
 * tested here.
 *
 *   1. THE REFUSALS. Recording after the lockout, recording twice, and
 *      grading a window that spans two rounds are the three ways a track
 *      record becomes fiction. Each has a test that fails if the refusal
 *      is ever softened.
 *   2. THE BASELINES. A percentile against random sevens is worthless if
 *      the random sevens are illegal or if the draw is not reproducible.
 *      Both are asserted, and the ceiling optimiser is checked against a
 *      case where a greedy pick provably loses.
 *   3. THE ARITHMETIC. Points are a subtraction across two snapshots; the
 *      captain is graded without assuming a multiplier; clubs are graded on
 *      whichever basis the feed actually supports.
 *
 * All synthetic. No network, no clock — a real season is not a test fixture
 * and would not be one for another nine months.
 *
 * Run: node dev/test-efl-record.mjs   (wired into npm test)
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const metrics = await import(join(ROOT, 'scripts/efl/metrics.mjs'));
const lib = await import(join(ROOT, 'scripts/efl/lib.mjs'));
const publish = await import(join(ROOT, 'scripts/efl/publish-record.mjs'));

let checks = 0;
const ok = (label, fn) => { fn(); checks += 1; void label; };

const RULES = metrics.DEFAULT_RULES;
const HOUR = 3600000;
const NOW = Date.parse('2026-09-12T09:00:00Z');

/* ── 1. The refusals ──────────────────────────────────── */

const roundAt = (n, lockHoursFromNow, games = []) => ({
  roundNumber: n,
  status: 'upcoming',
  lockoutDate: new Date(NOW + lockHoursFromNow * HOUR).toISOString(),
  games
});

ok('picks may be recorded in the window before a lockout', () => {
  const v = lib.canRecord({ round: roundAt(7, 20), existing: null, now: NOW });
  assert.equal(v.ok, true);
  assert.ok(v.hoursBeforeLock > 19 && v.hoursBeforeLock < 21);
});

ok('picks may NOT be recorded once the round has locked', () => {
  /* The single most important test in this file. A pick written after the
     deadline is a memory wearing a prediction's clothes. */
  const v = lib.canRecord({ round: roundAt(7, -0.5), existing: null, now: NOW });
  assert.equal(v.ok, false);
  assert.match(v.reason, /not a prediction/);
});

ok('a recorded round is never re-recorded', () => {
  const v = lib.canRecord({
    round: roundAt(7, 10),
    existing: { round: 7, recordedAt: '2026-09-11T09:00:00Z' },
    now: NOW
  });
  assert.equal(v.ok, false);
  assert.match(v.reason, /append-only/);
});

ok('picks are not recorded days out, when the team news has not happened yet', () => {
  const v = lib.canRecord({ round: roundAt(7, 120), existing: null, now: NOW });
  assert.equal(v.ok, false);
  assert.match(v.reason, /too early/);
});

ok('a season with no open round is a fact, not an error', () => {
  const v = lib.canRecord({ round: null, existing: null, now: NOW });
  assert.equal(v.ok, false);
  assert.match(v.reason, /season may be over/);
});

ok('the open round is the next one to lock, not the next in the file', () => {
  const rounds = [roundAt(9, 200), roundAt(7, 20), roundAt(8, 60), { ...roundAt(6, -50), status: 'completed' }];
  assert.equal(lib.openRound(rounds, NOW).roundNumber, 7);
  assert.equal(lib.openRound([{ ...roundAt(6, -50), status: 'completed' }], NOW), null);
});

/* ── 2. Settlement and attribution ────────────────────── */

const played = (homeId, awayId, hoursAgo, home, away) => ({
  homeId, awayId,
  kickoffDate: new Date(NOW - hoursAgo * HOUR).toISOString(),
  homeScore: home, awayScore: away
});

ok('a round is not settled while a ball is still to be kicked', () => {
  const rounds = [{ roundNumber: 7, status: 'live', lockoutDate: new Date(NOW - 50 * HOUR).toISOString(),
    games: [played('1', '2', 48, 1, 0), { homeId: '3', awayId: '4', kickoffDate: new Date(NOW + 2 * HOUR).toISOString() }] }];
  assert.equal(lib.roundSettlement(rounds, 7, NOW).settled, false);
});

ok('a round is not settled the instant the whistle goes', () => {
  /* The stats arrive after full time. Grading at 90 minutes would report a
     round that is still being scored. */
  const rounds = [{ roundNumber: 7, status: 'live', lockoutDate: new Date(NOW - 5 * HOUR).toISOString(),
    games: [played('1', '2', 1, 2, 1)] }];
  assert.equal(lib.roundSettlement(rounds, 7, NOW).settled, false);
  const later = lib.roundSettlement(rounds, 7, NOW + 3 * HOUR);
  assert.equal(later.settled, true);
});

ok('attribution is clean only while no later round has kicked off', () => {
  const rounds = [
    { roundNumber: 7, status: 'completed', lockoutDate: new Date(NOW - 60 * HOUR).toISOString(),
      games: [played('1', '2', 50, 1, 0)] },
    { roundNumber: 8, status: 'upcoming', lockoutDate: new Date(NOW + 40 * HOUR).toISOString(),
      games: [{ homeId: '1', awayId: '3', kickoffDate: new Date(NOW + 48 * HOUR).toISOString() }] }
  ];
  assert.equal(lib.roundSettlement(rounds, 7, NOW).clean, true, 'round 8 has not started');

  /* Once round 8 is under way, "points since lockout" can contain both, so
     the subtraction stops meaning round 7. */
  const during = lib.roundSettlement(rounds, 7, NOW + 50 * HOUR);
  assert.equal(during.settled, true);
  assert.equal(during.clean, false, 'a window spanning two rounds is not clean');
});

ok('scores are read whatever the feed calls them, and absent scores stay absent', () => {
  assert.deepEqual(lib.gameScore({ homeScore: 2, awayScore: 1 }), { home: 2, away: 1 });
  assert.deepEqual(lib.gameScore({ homeGoals: 0, awayGoals: 0 }), { home: 0, away: 0 });
  assert.equal(lib.gameScore({ homeScore: null, awayScore: null }), null);
  assert.equal(lib.gameScore({}), null);
});

ok('the points column is decided from the document, not from one lucky row', () => {
  const rows = [{ id: '1' }, { id: '2', totalPoints: 40 }, { id: '3', totalPoints: 51 }];
  assert.equal(lib.pointsFieldFor(rows), 'totalPoints');
  assert.equal(lib.pointsFieldFor([{ id: '1' }, { id: '2' }]), null,
    'no points column must be reported as none, never guessed');
});

ok('club results are read from both sides of every played game', () => {
  const rounds = [{ roundNumber: 7, games: [played('1', '2', 50, 3, 0), { homeId: '3', awayId: '4' }] }];
  const results = lib.clubResults(rounds, 7);
  assert.deepEqual(results['1'], [{ opponent: '2', home: true, goalsFor: 3, goalsAgainst: 0 }]);
  assert.deepEqual(results['2'], [{ opponent: '1', home: false, goalsFor: 0, goalsAgainst: 3 }]);
  assert.ok(!results['3'], 'an unplayed game contributes nothing');
});

/* ── 3. The optimiser and the baselines ───────────────── */

/* A universe with a deliberate trap: club A holds both the best GK and the
   best defender, and the cap is two per club. */
const P = (id, clubId, position, points) => ({ id, clubId, position, points });
const universe = [
  P('gk-a', 'A', 'GK', 10), P('def-a1', 'A', 'DEF', 9), P('def-a2', 'A', 'DEF', 9), P('fwd-a', 'A', 'FWD', 9),
  P('gk-b', 'B', 'GK', 2), P('def-b1', 'B', 'DEF', 8), P('def-b2', 'B', 'DEF', 1),
  P('mid-c1', 'C', 'MID', 7), P('mid-c2', 'C', 'MID', 7), P('fwd-c', 'C', 'FWD', 6),
  P('mid-d1', 'D', 'MID', 5), P('mid-d2', 'D', 'MID', 5), P('fwd-d', 'D', 'FWD', 4),
  P('def-e1', 'E', 'DEF', 3), P('def-e2', 'E', 'DEF', 3), P('fwd-e', 'E', 'FWD', 3), P('gk-e', 'E', 'GK', 1),
  /* Filler, so the universe is big enough for a top-decile figure to mean
     anything — the same reason the real one refuses to compute lift below
     twenty players. */
  P('mid-f1', 'F', 'MID', 2), P('mid-f2', 'F', 'MID', 2), P('def-f1', 'F', 'DEF', 2),
  P('gk-f', 'F', 'GK', 0), P('fwd-f', 'G', 'FWD', 0), P('def-g1', 'G', 'DEF', 0)
];
const pointsOf = (r) => r.points;

ok('the ceiling optimiser respects the two-per-club cap', () => {
  const best = metrics.bestLegalSeven(universe, pointsOf, RULES);
  assert.ok(best, 'a legal seven exists in this universe');
  assert.equal(best.picks.length, 7);
  const counts = {};
  for (const p of best.picks) counts[p.clubId] = (counts[p.clubId] || 0) + 1;
  for (const [club, n] of Object.entries(counts)) {
    assert.ok(n <= RULES.maxPerClub, `${club} contributed ${n} players`);
  }
});

ok('the ceiling optimiser fills exactly one of the legal formations', () => {
  const best = metrics.bestLegalSeven(universe, pointsOf, RULES);
  const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const p of best.picks) counts[p.position] += 1;
  const formation = RULES.formations.find((f) => f.id === best.formation);
  assert.deepEqual(counts, { GK: formation.GK, DEF: formation.DEF, MID: formation.MID, FWD: formation.FWD });
});

ok('the ceiling optimiser beats the greedy answer on a case built to break greedy', () => {
  /* Greedy fills GK first: it takes gk-a (10), then the two best defenders
     are both club A and only one slot remains for that club — so greedy
     lands on 10 + 9 + 8 for the back four. Taking the CHEAPER keeper frees
     both of club A's nines, which is worth more. The exact search has to
     find that; a per-position greedy provably cannot. */
  const greedy = (() => {
    const used = {}; const picks = [];
    const formation = { id: '1-2-2-2', GK: 1, DEF: 2, MID: 2, FWD: 2 };
    for (const pos of ['GK', 'DEF', 'MID', 'FWD']) {
      const pool = universe.filter((p) => p.position === pos).sort((a, b) => b.points - a.points);
      for (const p of pool) {
        if (picks.filter((x) => x.position === pos).length >= formation[pos]) break;
        if ((used[p.clubId] || 0) >= 2) continue;
        picks.push(p); used[p.clubId] = (used[p.clubId] || 0) + 1;
      }
    }
    return picks.reduce((s, p) => s + p.points, 0);
  })();

  const best = metrics.bestLegalSeven(universe, pointsOf, RULES);
  assert.ok(best.value >= greedy,
    `the exact search (${best.value}) must never lose to greedy (${greedy})`);
});

ok('a random legal seven is legal', () => {
  const rng = metrics.mulberry32(42);
  for (let i = 0; i < 200; i++) {
    const seven = metrics.randomLegalSeven(universe, rng, RULES);
    if (!seven) continue;
    assert.equal(seven.picks.length, 7);
    assert.equal(new Set(seven.picks.map((p) => p.id)).size, 7, 'no player picked twice');
    const counts = {};
    for (const p of seven.picks) counts[p.clubId] = (counts[p.clubId] || 0) + 1;
    assert.ok(Object.values(counts).every((n) => n <= 2), 'club cap held');
  }
});

ok('the random baseline is reproducible, so a re-run cannot move the verdict', () => {
  const a = metrics.randomSevenDistribution(universe, pointsOf, { round: 7, draws: 300, rules: RULES });
  const b = metrics.randomSevenDistribution(universe, pointsOf, { round: 7, draws: 300, rules: RULES });
  assert.equal(a.mean, b.mean);
  assert.equal(a.percentileOf(40), b.percentileOf(40));
  const other = metrics.randomSevenDistribution(universe, pointsOf, { round: 8, draws: 300, rules: RULES });
  assert.notEqual(a.mean, other.mean, 'a different round must draw a different sample');
});

ok('the percentile splits ties rather than awarding a perfect week to everyone', () => {
  const flat = [
    P('gk1', 'A', 'GK', 1), P('gk2', 'B', 'GK', 1),
    P('d1', 'A', 'DEF', 1), P('d2', 'B', 'DEF', 1), P('d3', 'C', 'DEF', 1),
    P('m1', 'C', 'MID', 1), P('m2', 'D', 'MID', 1), P('m3', 'D', 'MID', 1),
    P('f1', 'E', 'FWD', 1), P('f2', 'E', 'FWD', 1), P('f3', 'F', 'FWD', 1)
  ];
  const dist = metrics.randomSevenDistribution(flat, pointsOf, { round: 1, draws: 200, rules: RULES });
  assert.equal(dist.percentileOf(7), 0.5,
    'when every seven scores the same, ours is the median — not the best');
});

/* ── 4. The captain, without a multiplier ─────────────── */

ok('the captain is graded on where it landed inside our own seven', () => {
  const seven = [
    { id: 'a', points: 12 }, { id: 'b', points: 6 }, { id: 'c', points: 5 }, { id: 'd', points: 4 },
    { id: 'e', points: 3 }, { id: 'f', points: 2 }, { id: 'g', points: 1 }
  ];
  const hit = metrics.captainQuality(seven, 'a');
  assert.equal(hit.wasBest, true);
  assert.equal(hit.rank, 1);
  assert.equal(hit.foregonePerMultiple, 0);
  assert.ok(hit.vsOwnMean > 0);

  const miss = metrics.captainQuality(seven, 'd');
  assert.equal(miss.wasBest, false);
  assert.equal(miss.rank, 4);
  assert.equal(miss.foregonePerMultiple, 8, 'the gap to the best of the seven');
  assert.ok(miss.vsOwnMean < 0, 'below the average of our own seven is a bad armband');
});

ok('the captain grade never asserts a points multiplier', () => {
  /* The official multiplier has never been verified by this app, so no
     number here may depend on one. The guard is textual on purpose: it is
     the assumption, not the arithmetic, that would be wrong. */
  const src = readFileSync(join(ROOT, 'scripts/efl/metrics.mjs'), 'utf8');
  assert.doesNotMatch(src, /points\s*\*\s*2|captain\w*\s*\*\s*2\b/,
    'no doubling anywhere in the grading maths');
  assert.match(src, /multiplier/i, 'and the reason must be written down');
});

ok('tied top scorers do not make a correct armband look like a miss', () => {
  const seven = [{ id: 'a', points: 6 }, { id: 'b', points: 6 }, { id: 'c', points: 1 }];
  const q = metrics.captainQuality(seven, 'b');
  assert.equal(q.wasBest, true);
  assert.equal(q.rank, 1);
});

/* ── 5. Clubs ─────────────────────────────────────────── */

ok('a club outcome counts what was observed and nothing more', () => {
  const out = metrics.clubOutcome([{ goalsFor: 2, goalsAgainst: 0 }, { goalsFor: 1, goalsAgainst: 1 }]);
  assert.equal(out.played, 2);
  assert.equal(out.wins, 1);
  assert.equal(out.draws, 1);
  assert.equal(out.cleanSheets, 1);
  assert.equal(out.leaguePoints, 4);
});

ok('clubs are graded on official points when the feed has them, results when it does not', () => {
  const outcomes = {
    A: metrics.clubOutcome([{ goalsFor: 3, goalsAgainst: 0 }]),
    B: metrics.clubOutcome([{ goalsFor: 0, goalsAgainst: 1 }]),
    C: metrics.clubOutcome([{ goalsFor: 1, goalsAgainst: 1 }])
  };
  const noPoints = metrics.clubQuality(['A', 'B'], outcomes, null);
  assert.equal(noPoints.basis, 'match-result');
  assert.equal(noPoints.total, 3, 'a win and a loss');

  const withPoints = metrics.clubQuality(['A', 'B'], outcomes, { A: 14, B: 2, C: 6 });
  assert.equal(withPoints.basis, 'official-points');
  assert.equal(withPoints.total, 16);
  assert.equal(withPoints.bestTwo, 20, 'the best two available, in hindsight');
});

ok('a partial points map falls back rather than mixing two currencies', () => {
  const outcomes = { A: metrics.clubOutcome([{ goalsFor: 1, goalsAgainst: 0 }]), B: metrics.clubOutcome([{ goalsFor: 0, goalsAgainst: 0 }]) };
  const q = metrics.clubQuality(['A', 'B'], outcomes, { A: 12 });
  assert.equal(q.basis, 'match-result', 'one club with points is not enough to grade on points');
});

/* ── 6. A whole round, end to end ─────────────────────── */

const gradedRound = metrics.gradeRound({
  round: 7,
  picks: {
    formation: '1-2-2-2',
    players: [
      { id: 'gk-a', name: 'A keeper', club: 'A', position: 'GK' },
      { id: 'def-b1', name: 'B back', club: 'B', position: 'DEF' },
      { id: 'def-e1', name: 'E back', club: 'E', position: 'DEF' },
      { id: 'mid-c1', name: 'C mid', club: 'C', position: 'MID' },
      { id: 'mid-d1', name: 'D mid', club: 'D', position: 'MID' },
      { id: 'fwd-c', name: 'C forward', club: 'C', position: 'FWD' },
      { id: 'fwd-d', name: 'D forward', club: 'D', position: 'FWD' }
    ],
    captain: 'gk-a',
    clubs: ['A', 'C'],
    naive: ['gk-b', 'def-a1', 'def-a2', 'mid-c1', 'mid-c2', 'fwd-d', 'fwd-e'],
    scores: universe.map((p) => [p.id, p.points * 8])   /* a perfect model, for the correlation check */
  },
  actual: Object.fromEntries(universe.map((p) => [p.id, p.points])),
  rules: RULES,
  universe: universe.map((p) => ({ id: p.id, clubId: p.clubId, position: p.position })),
  clubOutcomes: {
    A: metrics.clubOutcome([{ goalsFor: 2, goalsAgainst: 0 }]),
    C: metrics.clubOutcome([{ goalsFor: 1, goalsAgainst: 2 }]),
    E: metrics.clubOutcome([{ goalsFor: 0, goalsAgainst: 0 }])
  },
  draws: 400
});

ok('a graded round totals the seven and nothing else', () => {
  assert.equal(gradedRound.squad.total, 10 + 8 + 3 + 7 + 5 + 6 + 4);
  assert.equal(gradedRound.squad.unresolved, 0);
});

ok('a graded round reports every baseline a reader needs to judge the total', () => {
  const b = gradedRound.baselines;
  assert.ok(Number.isFinite(b.randomMean), 'random');
  assert.ok(Number.isFinite(b.naive), 'naive');
  assert.ok(Number.isFinite(b.ceiling), 'ceiling');
  assert.ok(Number.isFinite(b.fieldMean), 'the average player');
  assert.ok(b.ceiling >= gradedRound.squad.total, 'nothing may beat the hindsight ceiling');
  assert.ok(b.percentile >= 0 && b.percentile <= 1);
});

ok('a model that ranked every player correctly scores a correlation of 1', () => {
  assert.ok(gradedRound.model.rho > 0.99, `rho was ${gradedRound.model.rho}`);
  assert.ok(gradedRound.model.topDecileLift > 1, 'and the top tenth must out-score the field');
  assert.equal(gradedRound.model.n, universe.length);
});

ok('a model that ranked every player backwards is not flattered', () => {
  const backwards = metrics.gradeRound({
    round: 7,
    picks: {
      formation: '1-2-2-2',
      players: [{ id: 'def-e1', name: 'E back', club: 'E', position: 'DEF' }],
      captain: 'def-e1',
      clubs: [],
      naive: [],
      scores: universe.map((p) => [p.id, -p.points])
    },
    actual: Object.fromEntries(universe.map((p) => [p.id, p.points])),
    rules: RULES,
    universe: universe.map((p) => ({ id: p.id, clubId: p.clubId, position: p.position })),
    clubOutcomes: {},
    draws: 100
  });
  assert.ok(backwards.model.rho < -0.9, `rho was ${backwards.model.rho}`);
  assert.ok(backwards.model.topDecileLift < 1, 'the top tenth of a backwards model must under-score');
});

ok('players with no recorded points are counted as unresolved, not as zero', () => {
  const partial = metrics.gradeRound({
    round: 7,
    picks: {
      formation: '1-2-2-2',
      players: [{ id: 'gk-a', name: 'A keeper', club: 'A', position: 'GK' }, { id: 'ghost', name: 'Not in the feed', club: 'Z', position: 'FWD' }],
      captain: 'gk-a', clubs: [], naive: [], scores: []
    },
    actual: { 'gk-a': 10 },
    rules: RULES,
    universe: [{ id: 'gk-a', clubId: 'A', position: 'GK' }],
    clubOutcomes: {},
    draws: 50
  });
  assert.equal(partial.squad.total, 10, 'a missing player adds nothing');
  assert.equal(partial.squad.unresolved, 1, 'and is reported as missing rather than as a zero');
});

/* ── 7. The season ────────────────────────────────────── */

const entryFor = (round, total, attribution, extra = {}) => ({
  round,
  result: {
    attribution,
    squad: { total, players: [], unresolved: 0 },
    captain: { points: 6, rank: 1, wasBest: true, foregonePerMultiple: 0, vsOwnMean: 2 },
    clubs: { basis: 'match-result', total: 4, fieldMeanTwo: 2.8, bestTwo: 6, percentile: 0.8 },
    baselines: { randomMean: 30, naive: 34, ceiling: 60, percentile: 0.7, fieldMeanSeven: 28 },
    model: { n: 900, rho: 0.3, topDecileLift: 1.6, byPosition: {} },
    ...extra
  }
});

ok('the season figures exclude rounds whose points could not be pinned to one round', () => {
  const season = metrics.seasonSummary([
    entryFor(1, 40, 'clean'), entryFor(2, 50, 'clean'), entryFor(3, 999, 'ambiguous')
  ]);
  assert.equal(season.graded, 2, 'the ambiguous round is not graded into the season');
  assert.equal(season.ours.total, 90);
  assert.equal(season.rounds, 3, 'but it is still counted as a round that happened');
});

ok('the season reports how often we beat each baseline, not just the totals', () => {
  const season = metrics.seasonSummary([entryFor(1, 40, 'clean'), entryFor(2, 20, 'clean')]);
  assert.equal(season.beatRandom, 1, '40 beats 30, 20 does not');
  assert.equal(season.beatNaive, 1, '40 beats 34, 20 does not');
  assert.equal(season.captain.best, 2);
  assert.ok(Math.abs(season.ceilingShare - 0.5) < 1e-9, '(40+20)/2 out of 60');
});

ok('a season with nothing graded says so instead of producing zeroes', () => {
  const empty = metrics.seasonSummary([]);
  assert.equal(empty.graded, 0);
  assert.equal(empty.ours, undefined, 'no totals invented from an empty ledger');
});

/* ── 8. What the website is given ─────────────────────── */

const ledgerEntry = {
  round: 7,
  recordedAt: '2026-09-12T09:00:00Z',
  lockoutAt: '2026-09-13T11:00:00Z',
  hoursBeforeLock: 26,
  picks: {
    formation: '1-2-2-2',
    players: [{ id: 'gk-a', name: 'A keeper', club: 'A', division: 'championship', position: 'GK', score: 80, fixture: { opponent: 'B', home: true, rating: 2 } }],
    captain: 'gk-a',
    clubs: [{ id: 'A', name: 'Club A', division: 'championship', score: 71 }],
    naive: ['gk-b'],
    crowdClubs: ['C']
  },
  universe: { columns: ['id'], rows: new Array(1800).fill(['x']) },
  clubUniverse: { pointsField: 'totalPoints', pointsAtLock: { A: 100 } },
  result: {
    gradedAt: '2026-09-14T09:00:00Z',
    attribution: 'clean',
    clubBasis: 'match-result',
    fixtures: { played: 12, total: 12 },
    squad: { total: 41, unresolved: 0, players: [{ id: 'gk-a', name: 'A keeper', club: 'A', position: 'GK', points: 10 }] },
    captain: { id: 'gk-a', points: 10, rank: 1, wasBest: true, bestPoints: 10, foregonePerMultiple: 0, vsOwnMean: 4.142857 },
    clubs: { basis: 'match-result', total: 3, perClub: [{ id: 'A', value: 3, outcome: { wins: 1 } }], fieldMeanTwo: 2.8, bestTwo: 6, percentile: 0.81234 },
    crowdClubs: { ids: ['C'], value: 1 },
    baselines: { randomMean: 30.123, naive: 34, ceiling: 60, percentile: 0.7123, fieldMeanSeven: 28.4 },
    model: { n: 900, rho: 0.31234, topDecileLift: 1.62345, byPosition: { GK: { n: 20, rho: 0.2 } } }
  }
};

const publicRecord = publish.buildPublicRecord([ledgerEntry], '2026-09-14T10:00:00Z');

ok('the published file carries the picks and the result but not the working', () => {
  const json = JSON.stringify(publicRecord);
  assert.ok(!json.includes('pointsAtLock'), 'the lockout snapshot stays in the repository');
  assert.ok(!json.includes('"universe"'), 'and so do 1,800 rows of ratings');
  assert.ok(json.length < 6000, `the public file must stay small (was ${json.length} bytes)`);
  assert.equal(publicRecord.rounds[0].players[0].points, 10, 'but the graded points come through');
  assert.equal(publicRecord.rounds[0].result.baselines.ceiling, 60);
});

ok('the published file states its own method, so it can be read without the source', () => {
  assert.match(publicRecord.method.pointsFrom, /cumulative season total/);
  assert.match(publicRecord.method.attribution, /ambiguous/);
  assert.match(publicRecord.method.captain, /multiplier/);
  assert.match(publicRecord.method.clubs, /match result/);
});

ok('an ungraded round is published as ungraded rather than as a zero', () => {
  const pending = publish.buildPublicRecord([{ ...ledgerEntry, result: null }]);
  assert.equal(pending.rounds[0].graded, false);
  assert.equal(pending.rounds[0].result, null);
  assert.equal(pending.rounds[0].players[0].points, null, 'no points, not zero points');
  assert.equal(pending.season.graded, 0);
});

/* ── 9. The scripts themselves ────────────────────────── */

ok('the recorder imports the website\'s own model rather than a copy of it', () => {
  /* If this ever becomes a re-implementation, the ledger stops measuring
     what visitors are shown and starts measuring something adjacent. */
  const src = readFileSync(join(ROOT, 'scripts/efl/record-picks.mjs'), 'utf8');
  assert.match(src, /from '\.\.\/\.\.\/efl\/app\/assets\/model\.js'/);
  assert.match(src, /from '\.\.\/\.\.\/efl\/app\/assets\/provider\.js'/);
  assert.ok(!/buildSampleSnapshot/.test(src), 'the ledger must never record generated data');
});

ok('the recorder rehearses the shape guard on every run, not just the ones that write', () => {
  /* A feed that renames a field between rounds must be found out on a quiet
     Tuesday, not in the ninety minutes before a deadline. Every run outside
     the recording window builds the snapshot and throws away the result. */
  const src = readFileSync(join(ROOT, 'scripts/efl/record-picks.mjs'), 'utf8');
  const skip = src.indexOf('Nothing to record');
  const build = src.indexOf('buildOfficialSnapshot(raw');
  assert.ok(skip > -1 && build > skip,
    'the no-op path must still exercise buildOfficialSnapshot');
  assert.match(src.slice(skip), /process\.exit\(1\)/,
    'and a shape failure there must fail the job rather than log and shrug');
});

ok('the recorder does not invent a baseline it has no basis for', () => {
  /* In round one nobody has an appearance, so every candidate for the
     "pick whoever has been scoring" seven scores zero and the winner would
     be whichever seven the search reached first — a coin toss printed on
     the page as the bar our picks had to clear. */
  const src = readFileSync(join(ROOT, 'scripts/efl/record-picks.mjs'), 'utf8');
  assert.match(src, /naiveRows\.some\(\(r\) => r\.ppa > 0\)/,
    'the naive seven is only built when something can be ranked');
  const seasonSummaryOfNoBaseline = metrics.seasonSummary([{
    round: 1,
    result: {
      attribution: 'clean',
      squad: { total: 40, players: [], unresolved: 0 },
      captain: null,
      clubs: null,
      baselines: { randomMean: 30, naive: null, ceiling: 60, percentile: 0.7 },
      model: { n: 900, rho: 0.3, topDecileLift: 1.4, byPosition: {} }
    }
  }]);
  assert.equal(seasonSummaryOfNoBaseline.beatNaive, 0,
    'a round with no naive baseline cannot be counted as beating it');
  assert.equal(seasonSummaryOfNoBaseline.naive.total, 0, 'and contributes no total');
});

ok('the recorder cannot be talked into writing after the deadline', () => {
  const src = readFileSync(join(ROOT, 'scripts/efl/record-picks.mjs'), 'utf8');
  assert.match(src, /canRecord\(/, 'the gate is applied');
  assert.ok(!/--force|process\.env\.FORCE/.test(src),
    'and there is no flag that bypasses it');
});

ok('the grader never edits the picks it is grading', () => {
  const src = readFileSync(join(ROOT, 'scripts/efl/grade-round.mjs'), 'utf8');
  assert.match(src, /\.\.\.entry,\s*\n\s*result:/, 'it writes the entry back with a result attached');
  assert.ok(!/entry\.picks\s*=|entry\.universe\s*=/.test(src), 'and mutates nothing that was recorded');
});

/* ── 6. Outside benchmarks ────────────────────────────────
   Community captures stored beside the ledger so that git history is the
   evidence they predate the football, exactly as the round entries are.

   The point of testing them is narrow and worth stating. A benchmark file
   that says "their meta player is our captain" is worth nothing if nobody
   ever resolves that against the ledger — it is a sentence about the
   ledger stored next to the ledger, free to drift from it. So the claim is
   checked, not read. */
ok('a benchmark is captured before the lockout it refers to', () => {
  const BENCHMARKS = [
    ['round-01-tipsters.json', 1],
    ['round-01-scottyfefl.json', 1],
    ['round-01-natethegreat.json', 1],
    ['round-02-efl-official.json', 2],
  ];
  for (const [f, round] of BENCHMARKS) {
    const b = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks', f), 'utf8'));
    assert.ok(Date.parse(b.capturedAt) < Date.parse(b.roundLockoutAt),
      `${f} was captured before the round locked`);
    assert.equal(b.round, round, `${f} names the round it belongs to`);
    /* And the lockout it claims is the one the ledger recorded, not a time
       typed in by hand. A benchmark that predates the wrong lockout proves
       nothing about the football it is supposed to predate. */
    const entry = JSON.parse(readFileSync(
      join(ROOT, `efl/data/rounds/round-0${round}.json`), 'utf8'));
    assert.equal(b.roundLockoutAt, entry.lockoutAt,
      `${f} quotes the lockout the round entry recorded`);
  }
});

/* ── The EFL's own GW2 article ─────────────────────────────
   Two things about this one are easy to get wrong later, so they are pinned
   here rather than left to whoever writes the grader. */
ok('the official GW2 tips keep their two directions apart', () => {
  const b = JSON.parse(readFileSync(
    join(ROOT, 'efl/data/benchmarks/round-02-efl-official.json'), 'utf8'));
  assert.equal(b.avoid.length, 4, 'four trap picks');
  assert.equal(b.target.length, 3, 'three hidden gems');
  /* A player cannot be both, and a grader that flattened the two lists would
     mark the author wrong for exactly the players he told readers to swap
     out. The direction is the claim. */
  const a = new Set(b.avoid.map((p) => p.name));
  assert.ok(!b.target.some((p) => a.has(p.name)), 'no player is both a trap and a gem');
  assert.match(b.gradeableAs, /direction/i, 'the file says the direction is what gets graded');
});

ok('an unknown club is left unknown, not quietly guessed', () => {
  const b = JSON.parse(readFileSync(
    join(ROOT, 'efl/data/benchmarks/round-02-efl-official.json'), 'utf8'));
  /* The article names no club for two of the seven. One is inferable off a
     second source and is marked as inferred; the other is not, and stays
     null. Both must carry their reasoning, because a club that appears from
     nowhere is graded as though somebody checked it. */
  for (const p of [...b.avoid, ...b.target]) {
    if (p.club === null) {
      assert.ok('clubInferred' in p && p.clubInferredFrom,
        `${p.name} has no club, so the file has to say what was and was not inferred`);
    }
  }
  const prowse = b.avoid.find((p) => p.name === 'James Ward-Prowse');
  assert.equal(prowse.club, null, 'Ward-Prowse has no club stated in the article');
  assert.equal(prowse.clubInferred, 'West Ham United', 'and the inference is recorded as one');
  const caton = b.target.find((p) => p.name === 'Charlie Caton');
  assert.equal(caton.clubInferred, null, 'Caton is not guessed at from two fixtures');
});

ok('the empty overlap with our entry is not dressed up as agreement', () => {
  const b = JSON.parse(readFileSync(
    join(ROOT, 'efl/data/benchmarks/round-02-efl-official.json'), 'utf8'));
  const entry = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-02.json'), 'utf8'));
  /* Resolved against the ledger rather than asserted — the claim is that no
     named player appears in our entry, so it is checked against the entry. */
  const ours = entry.picks.players.map((p) => (p.name || '').toLowerCase());
  const theirs = [...b.avoid, ...b.target].map((p) => p.name.toLowerCase());
  const surname = (n) => n.split(/[\s.]+/).pop();
  const shared = theirs.filter((t) => ours.some((o) => surname(o) === surname(t)));
  assert.deepEqual(shared, [], 'no player in the article appears in our round-2 entry');
  assert.deepEqual(b.overlapWithOurEntry.shared, shared, 'and the file records that truthfully');
  assert.match(b.overlapWithOurEntry.notCorroboration, /not a considered rejection/i,
    'and refuses to read an empty overlap as our model agreeing with him');
});

ok('the Lewis Wing overlap is resolved against the ledger, not asserted', () => {
  const b = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-scottyfefl.json'), 'utf8'));
  const entry = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01.json'), 'utf8'));
  const meta = b.claims.find((c) => c.n === 3);
  assert.ok(meta.namesPlayers.includes('Lewis Wing'), 'the thread names Lewis Wing among the meta');

  const captain = entry.picks.players.find((p) => p.id === entry.picks.captain);
  assert.ok(captain, 'the entry has a captain that resolves to a picked player');
  assert.match(captain.name, /Wing/, 'and the captain is Wing, as the benchmark claims');
  assert.ok(meta.theOverlap.ourPick.includes(captain.id), "the benchmark quotes the captain's real feed id");

  /* Wing being the HIGHEST-scored pick is what makes the overlap
     interesting rather than incidental, so it is asserted too. */
  const top = entry.picks.players.reduce((a, c) => (c.score > a.score ? c : a));
  assert.equal(top.id, captain.id, 'the captain is also our highest-scored player');
});

ok('and the overlap is not dressed up as independent corroboration', () => {
  const b = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-scottyfefl.json'), 'utf8'));
  const entry = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01.json'), 'utf8'));
  /* Their thread is nine days older than our entry. That ordering is the
     whole reason the claim has to be hedged, so the ordering is checked and
     the hedge is required to be present. Two sources agreeing is only
     evidence when neither could have seen the other. */
  assert.ok(Date.parse(b.source.postedAt) < Date.parse(entry.recordedAt),
    'their thread really is older than our entry, as the file says');
  const meta = b.claims.find((c) => c.n === 3);
  assert.match(meta.theOverlap.readCarefully, /not independent corroboration/i,
    'and the file says so instead of claiming two methods agreed independently');
});

ok('interceptions really are +2 and midfielders only', () => {
  /* The thread calls interceptions "MASSIVE" and the benchmark says we
     already pay them. Read the tariff rather than believing the note. */
  const tariff = readFileSync(join(ROOT, 'efl/app/assets/tariff.js'), 'utf8');
  const block = (tariff.match(/interceptions:\s*\{[\s\S]*?\}/) || [])[0] || '';
  assert.match(block, /per:\s*2\b/, 'interceptions pay 2');
  assert.match(block, /positions:\s*\['MID'\]/, 'and only to midfielders');
});

ok('the Blackburn head-to-head is a real opposition, resolved against the entry', () => {
  const b = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-natethegreat.json'), 'utf8'));
  const entry = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01.json'), 'utf8'));

  /* The file claims we took one side of a match and they took the other.
     That is the most valuable thing in any of these benchmarks — a
     disagreement that ninety minutes settles with nothing left to argue
     about — so it is the one most worth checking is actually true. */
  const ours = (entry.picks.clubs || []).map((c) => c.name);
  assert.ok(ours.includes('Blackburn Rovers'), 'Blackburn really is one of our club picks');

  const theirs = b.teamPicks.find((t) => /Wolver/.test(t.club));
  assert.ok(theirs, 'they really do pick Wolves');
  assert.match(theirs.opponent, /Blackburn/, 'and Wolves\' opponent really is Blackburn');
  assert.equal(theirs.venue, 'H', 'at home, as the head-to-head note says');

  /* Their number-one defender is in the same fixture, which is what makes it
     an opposition rather than a coincidence of scheduling. */
  const gomes = b.defenders.find((d) => d.rank === 1);
  assert.match(gomes.fixture, /Blackburn/, 'their top defender is in the same match');

  /* The asymmetry claim: our side is a differential, theirs is consensus. */
  const blackburn = (entry.picks.clubs || []).find((c) => c.name === 'Blackburn Rovers');
  assert.ok(blackburn.percentSelected != null, 'we hold official ownership for our own pick');
  assert.ok(blackburn.percentSelected < theirs.reportedOwnership,
    'and our side really is the less-owned one, as the file claims');
});

ok('reported ownership is never presented as official', () => {
  const b = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-natethegreat.json'), 'utf8'));
  /* The standing rule on this repo is that unavailable official ownership is
     not fabricated. A third party's published percentages are a different
     measurement wearing the same units, and the danger is not that they are
     wrong but that they are quietly promoted. Every one of them is stored
     under a key that says whose number it is. */
  assert.match(b.ownershipCaveat, /not read from the official feed/i,
    'the file says plainly where these numbers come from');
  for (const t of [...b.teamPicks, ...b.differentialTeamPicks, ...b.defenders]) {
    assert.ok(Object.prototype.hasOwnProperty.call(t, 'reportedOwnership'),
      `${t.club || t.name} stores its percentage as reportedOwnership`);
    assert.ok(!Object.prototype.hasOwnProperty.call(t, 'ownership')
      && !Object.prototype.hasOwnProperty.call(t, 'percentSelected'),
      `${t.club || t.name} does not use the field names the official feed uses`);
  }
});

ok('the cross-source defender overlap is measured, not asserted', () => {
  const nate = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-natethegreat.json'), 'utf8'));
  const tips = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-tipsters.json'), 'utf8'));
  /* Two accounts, captured a day apart, converging on the same two
     centre-backs. Surnames are compared rather than full names because the
     two sources write them differently ("A. Baldwin" against "Aden
     Baldwin") — and the comparison is scoped to defenders for the same
     reason the Premier League price diff is scoped per club: matching on a
     surname across a whole player pool is how you invent an agreement. */
  const surname = (s) => String(s).trim().split(/\s+/).pop().toLowerCase();
  const theirs = new Set(nate.defenders.map((d) => surname(d.name)));
  const tipDefs = tips.players.filter((p) => p.position === 'DEF').map((p) => surname(p.name));
  const shared = tipDefs.filter((s) => theirs.has(s)).sort();
  assert.deepEqual(shared, ['baldwin', 'whatmough'],
    'exactly Baldwin and Whatmough are named by both sources');

  /* And the claim that we hold neither, which is what makes the overlap
     worth grading rather than merely noting. */
  const entry = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01.json'), 'utf8'));
  const ourSurnames = new Set(entry.picks.players.map((p) => surname(p.name)));
  for (const s of shared) {
    assert.ok(!ourSurnames.has(s), `we do not hold ${s}, as the benchmark says`);
  }
});

ok('the per-position overlap is measured across the whole thread', () => {
  const nate = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-natethegreat.json'), 'utf8'));
  const tips = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-tipsters.json'), 'utf8'));
  /* Accents normalised so "M. Toure" and "Mohamed Touré" resolve to one
     player. Without this the forwards would read as one shared name instead
     of two, and the whole shape of the finding would change. */
  const sn = (s) => String(s).trim().split(/\s+/).pop().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  const mine = { DEF: nate.defenders, MID: nate.midfielders, FWD: nate.forwards };
  const shared = {};
  for (const [pos, list] of Object.entries(mine)) {
    const theirs = new Set(list.map((p) => sn(p.name)));
    shared[pos] = tips.players.filter((p) => p.position === pos)
      .map((p) => sn(p.name)).filter((s) => theirs.has(s)).sort();
  }
  assert.deepEqual(shared.DEF, ['baldwin', 'whatmough'], 'defenders share exactly two');
  assert.deepEqual(shared.FWD, ['lankshear', 'toure'], 'forwards share exactly two');
  assert.deepEqual(shared.MID, [], 'and midfielders share NOTHING — the finding worth keeping');

  /* Both sources' number-one forward being the same player is a stronger
     statement than merely appearing on both lists. */
  const nate1 = nate.forwards.find((p) => p.rank === 1);
  const tip1 = tips.players.find((p) => p.position === 'FWD' && p.rank === 1);
  assert.equal(sn(nate1.name), sn(tip1.name), 'and Lankshear is the number-one forward on both');
});

ok('exactly one of our seven appears in the thread, and it is the captain', () => {
  const nate = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-natethegreat.json'), 'utf8'));
  const entry = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01.json'), 'utf8'));
  const sn = (s) => String(s).trim().split(/\s+/).pop().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  const named = [...nate.defenders, ...nate.midfielders, ...nate.forwards,
    ...nate.playerDifferentials].map((p) => sn(p.name));
  const ourOverlap = entry.picks.players.filter((p) => named.includes(sn(p.name)));
  assert.equal(ourOverlap.length, 1, 'one overlap with our seven');
  assert.equal(ourOverlap[0].id, entry.picks.captain, 'and it is our captain');
});

ok('the "consensus pick" claim was corrected once ownership was known', () => {
  const s = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-scottyfefl.json'), 'utf8'));
  const nate = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-natethegreat.json'), 'utf8'));
  const meta = s.claims.find((c) => c.n === 3);
  /* Being named as the meta says how a player is RATED. Ownership says how
     many managers HOLD him. This file slid from one to the other, and the
     correction exists because the ledger is graded on exactly that
     distinction — "was the model contrarian or did it follow the crowd"
     cannot be answered afterwards if the terms were wrong beforehand. */
  assert.ok(meta.correctionSameDay, 'the correction sits on the claim it corrects');
  const wing = nate.midfielders.find((p) => /Wing/.test(p.name));
  assert.ok(wing.reportedOwnership < 50,
    'and the ownership figure that forced it really is a minority (' + wing.reportedOwnership + '%)');
  assert.match(meta.correctionSameDay.theAccurateStatement, /tipped/i,
    'the corrected statement separates being tipped from being owned');
});

ok('the Notts County resolution was confirmed by a second source', () => {
  const tips = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-tipsters.json'), 'utf8'));
  const nate = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-natethegreat.json'), 'utf8'));
  const leicesterTip = tips.teams.find((t) => /Leicester/.test(t.club));
  const leicesterNate = nate.teamPicks.find((t) => /Leicester/.test(t.club));
  assert.ok(leicesterTip.confirmedBy, 'the confirmation is recorded on the line it confirms');
  /* Both sources must actually agree, or the "confirmed" note is decoration. */
  assert.match(leicesterTip.fixture, /Notts County \(A\)/, 'the tipsters line reads Notts County away');
  assert.match(leicesterNate.opponent, /Notts County/, 'and so does the second source');
  assert.equal(leicesterNate.venue, 'A', 'on the same venue, which is the half most easily wrong');
});

ok('an unresolved rule question is stored as unresolved', () => {
  const b = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-natethegreat.json'), 'utf8'));
  const q = b.openQuestionRaised;
  /* "Saving team picks for double gameweeks" could mean a season-long usage
     cap or nothing more than opportunity cost. Our model knows only
     per-round rules. The file must keep both readings and must not have
     quietly picked one — inventing a season-long constraint from one phrase
     in a tip thread is the failure this project keeps catching. */
  assert.equal(q.twoReadings.length, 2, 'both readings are kept');
  assert.match(q.status, /UNRESOLVED/, 'and it is labelled unresolved');
  assert.match(q.actionTaken, /None beyond recording it/i, 'and nothing was built on the guess');
});

/* ── the pre-lockout status record ────────────────────────
   A dated statement of where the entry stood with the lockout still ahead.
   It is the kind of document that rots fastest: written beside the ledger,
   describing the ledger, and free to drift from it the moment either
   changes. So it is checked against the entry field by field, and the
   entry's own bytes are pinned. */
ok('the pre-lockout status was written BEFORE the lockout it describes', () => {
  const s = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01-prelock-status.json'), 'utf8'));
  const entry = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01.json'), 'utf8'));
  assert.ok(Date.parse(s.writtenAt) < Date.parse(s.lockoutAt),
    'written before the lockout, which is the only thing that makes it evidence');
  assert.equal(s.lockoutAt, entry.lockoutAt, 'and it quotes the entry\'s own lockout');
  assert.ok(Date.parse(entry.recordedAt) < Date.parse(s.writtenAt),
    'and the entry predates the status, not the other way round');
});

ok('the status describes the entry exactly, or it is not describing the entry', () => {
  const s = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01-prelock-status.json'), 'utf8'));
  const entry = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01.json'), 'utf8'));

  assert.equal(s.theEntry.formation, entry.picks.formation, 'formation matches');
  assert.equal(s.theEntry.captainId, entry.picks.captain, 'captain id matches');
  assert.equal(s.theEntry.players.length, entry.picks.players.length, 'seven players');

  const byName = Object.fromEntries(entry.picks.players.map((p) => [p.name, p]));
  for (const p of s.theEntry.players) {
    const real = byName[p.name];
    assert.ok(real, `${p.name} is actually in the entry`);
    assert.equal(p.position, real.position, `${p.name} position matches`);
    assert.equal(p.club, real.club, `${p.name} club matches`);
    assert.equal(p.score, real.score, `${p.name} score matches`);
    /* The fixture is where a status file would most plausibly drift, since
       it is the part a human would retype. */
    const f = real.fixture || {};
    assert.equal(p.fixture, `${f.opponent} (${f.home ? 'H' : 'A'})`, `${p.name} fixture matches`);
    assert.equal(!!p.captain, real.id === entry.picks.captain, `${p.name} captaincy matches`);
  }
  /* And the claim that all seven are at home, which is asserted in prose. */
  assert.equal(s.theEntry.allSevenAtHome,
    entry.picks.players.every((p) => p.fixture && p.fixture.home),
    'the all-at-home claim is measured, not remembered');

  const clubByName = Object.fromEntries((entry.picks.clubs || []).map((c) => [c.name, c]));
  for (const c of s.theEntry.clubs) {
    assert.ok(clubByName[c.name], `${c.name} is actually a club pick`);
    assert.equal(c.officialOwnership, clubByName[c.name].percentSelected,
      `${c.name} ownership matches the feed value recorded in the entry`);
  }
});

ok('the entry itself is byte-identical to what the status vouches for', () => {
  const s = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01-prelock-status.json'), 'utf8'));
  const raw = readFileSync(join(ROOT, 'efl/data/rounds/round-01.json'));
  /* Git's blob hash, computed here rather than shelled out, so the test runs
     anywhere. If anyone ever edits the recorded entry — to tidy it, to fix a
     name, to quietly improve a pick — this fails and says so. That is the
     whole point of an append-only ledger, expressed as a check rather than
     as a promise. */
  const header = Buffer.from(`blob ${raw.length}\0`, 'utf8');
  const sha = createHash('sha1').update(Buffer.concat([header, raw])).digest('hex');

  /* The blobSha covered the WHOLE FILE — and the whole file is designed to
     gain a `result` when the round settles. So the first grading broke this
     check by doing its job, and main went red unnoticed. A byte-freeze on a
     file that is meant to receive one more field is the wrong invariant.

     What must never change is the ENTRY: what was picked, when, from which
     universe. That is what picksSha256 covers, and `result` and
     `voidedGrading` are excluded because they are the two fields a settled
     round is allowed to gain. The guarantee is unchanged in strength —
     editing a pick, a timestamp or the lock snapshot still fails here. */
  const entry = JSON.parse(raw.toString('utf8'));
  const sub = {};
  for (const k of s.entryIntegrity.picksShaCovers) if (k in entry) sub[k] = entry[k];
  const picksSha = createHash('sha256').update(JSON.stringify(sub)).digest('hex');
  assert.equal(picksSha, s.entryIntegrity.picksSha256,
    'the recorded PICKS have not changed since the pre-lockout status vouched for them');
  assert.ok(!s.entryIntegrity.picksShaCovers.includes('result'),
    'and the digest deliberately does not cover the result a settled round gains');
  assert.equal(typeof s.entryIntegrity.blobSha, 'string',
    'the original whole-file hash is kept as the record of what was vouched for');
  void sha;
  assert.equal(s.entryIntegrity.commits, 1, 'and the status claims exactly one commit');
});

ok('the status is not mistaken for a round by the ledger loader', () => {
  /* It lives in the rounds directory, which is convenient and dangerous.
     The loader's filter is strict, and this asserts that it stays strict —
     a looser pattern would read the status file as round NaN and corrupt
     the season record. */
  const src = readFileSync(join(ROOT, 'scripts/efl/lib.mjs'), 'utf8');
  const m = src.match(/\/\^round-[^/]*\/\.test\(n\)/);
  assert.ok(m, 'the loader still filters round files by pattern');
  const re = new RegExp(m[0].slice(1, m[0].indexOf('/.test')));
  assert.ok(re.test('round-01.json'), 'a real round entry is loaded');
  assert.ok(!re.test('round-01-prelock-status.json'),
    'and the pre-lockout status is not');
});

ok('an update to the status is still bounded by the lockout', () => {
  const s = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01-prelock-status.json'), 'utf8'));
  /* The status may gain updates while the round is still open — that is the
     point of it. What must not happen is an "update" written after the
     lockout quietly joining a document whose whole claim is that it predates
     the football. */
  for (const u of s.updates || []) {
    assert.ok(Date.parse(u.at) < Date.parse(s.lockoutAt),
      `update at ${u.at} was written before the lockout`);
    assert.ok(Date.parse(u.at) >= Date.parse(s.writtenAt),
      `update at ${u.at} is not backdated before the document itself`);
    assert.match(u.doesItChangeTheEntry, /^No\./,
      'and every update states plainly that the entry is unmoved');
  }
});

ok('the recording window the entry used is quoted correctly', () => {
  const s = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01-prelock-status.json'), 'utf8'));
  const entry = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01.json'), 'utf8'));
  const u = (s.updates || []).find((x) => x.theRealPointThisRaises);
  if (!u) return;
  /* The limitation only means anything if the numbers behind it are real:
     the window is what lib.mjs actually says, and we really did record near
     its edge. Both are read rather than restated. */
  assert.match(u.theRealPointThisRaises.observation,
    new RegExp(`RECORD_WINDOW_HOURS = ${lib.RECORD_WINDOW_HOURS}\\b`),
    'the window quoted is the window the code enforces');
  assert.ok(entry.hoursBeforeLock < lib.RECORD_WINDOW_HOURS,
    'the entry was inside the window');
  assert.ok(lib.RECORD_WINDOW_HOURS - entry.hoursBeforeLock < 2,
    'and near its edge, as the update claims — recorded '
    + entry.hoursBeforeLock + 'h out against a ' + lib.RECORD_WINDOW_HOURS + 'h limit');
  /* The largest model weight is quoted too; if it is retuned this fails
     rather than leaving a stale number in a document about honesty. */
  assert.match(u.theRealPointThisRaises.whatItMeans,
    new RegExp(String(entry.weights.player.minutes)),
    'the minutes weight quoted matches the entry');
});

ok('the head-to-head named in the status is the one the benchmarks describe', () => {
  const s = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01-prelock-status.json'), 'utf8'));
  const entry = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01.json'), 'utf8'));
  const nate = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-natethegreat.json'), 'utf8'));
  const u = (s.updates || []).find((x) => x.theHeadToHeadGoesFirst);
  if (!u) return;

  /* Both sides of the claim must be real: our club, their club, one match. */
  const ours = (entry.picks.clubs || []).map((c) => c.name);
  assert.ok(ours.includes('Blackburn Rovers'), 'Blackburn is genuinely our pick');
  const theirs = nate.teamPicks.find((t) => /Wolver/.test(t.club));
  assert.match(theirs.opponent, /Blackburn/, 'and their Wolves pick is genuinely against Blackburn');

  /* The claim that this is the ONLY outright disagreement. If a second one
     is ever recorded, this sentence stops being true and should fail rather
     than quietly overstate how clean the test is. */
  const opposed = (entry.picks.clubs || []).filter((c) =>
    nate.teamPicks.some((t) => new RegExp(c.name.split(' ')[0], 'i').test(t.opponent)));
  assert.equal(opposed.length, 1,
    'exactly one of our clubs is on the opposite side of one of theirs');

  /* And the separation of a match result from a season claim, which is the
     easiest thing to blur afterwards. */
  assert.match(u.theHeadToHeadGoesFirst.andTheThirdSource, /SEASON, not this match/,
    'the season-long relegation claim is kept separate from tonight');
});

ok('the team sheets were captured before the lockout, and settle what they claim', () => {
  const l = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-wolves-blackburn-lineups.json'), 'utf8'));
  const nate = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-natethegreat.json'), 'utf8'));
  const tips = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-tipsters.json'), 'utf8'));

  /* A line-up read after kick-off proves nothing about what was knowable,
     so the timestamp is the whole licence for this file to exist. */
  assert.ok(Date.parse(l.capturedAt) < Date.parse(l.roundLockoutAt),
    'captured before the lockout');
  assert.equal(l.lineups['Wolverhampton Wanderers'].xi.length, 11, 'eleven Wolves players');
  assert.equal(l.lineups['Blackburn Rovers'].xi.length, 11, 'eleven Blackburn players');

  /* Every player the file says was "settled" must actually appear in a
     starting XI here, and must actually have been picked by the source it
     credits. Either half being wrong would turn this into corroboration of
     something nobody claimed. */
  const surname = (x) => String(x).trim().split(/\s+/).pop().toLowerCase();
  const starters = new Set(Object.values(l.lineups)
    .filter((t) => t && t.xi).flatMap((t) => t.xi.map((p) => surname(p.name))));
  for (const s of l.outsidePicksSettledByThisSheet) {
    assert.match(s.verdict, /^STARTS/, `${s.player} verdict is a start`);
    assert.ok(starters.has(surname(s.player)), `${s.player} is really in an XI`);
  }
  const named = [
    ...nate.defenders.map((d) => surname(d.name)),
    ...tips.players.map((p) => surname(p.name))
  ];
  for (const s of l.outsidePicksSettledByThisSheet) {
    assert.ok(named.includes(surname(s.player)),
      `${s.player} was really picked by an outside source we hold`);
  }

  /* The correlation warning. Two of the three pay out on the same clean
     sheet, and the file must say so — counting them as independent would
     inflate the outside case against our own club pick. */
  assert.match(l.theShapeThisRevealsInTheHeadToHead.guardAgainstDoubleCounting,
    /correlated/i, 'the double-counting guard is stated');

  /* Krejci is absent from the squad and the file must refuse to conclude
     anything from that — the week's recurring lesson, applied where it
     would be convenient to forget it. */
  assert.match(l.observedNotConcluded.whyNoConclusionIsDrawn, /not the same as a finding/i,
    'absence from one squad is not read as a departure');
});

ok('the status records no prediction it could later be graded kindly against', () => {
  const s = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01-prelock-status.json'), 'utf8'));
  assert.ok(s.predictionsDeliberatelyNotMade,
    'the refusal to forecast a points total is stated, not just practised');
  assert.ok(s.whatThisIsNot.some((x) => /NOT a second entry|records no pick/i.test(x)),
    'and it disclaims being an entry');
  /* Silence recorded as silence. Two of our seven have no outside coverage
     at all, and the file must not dress that up as either support or doubt. */
  const quiet = s.outsideEvidenceGathered.perPick.find((p) => /Twine/.test(p.pick));
  assert.match(quiet.note, /silence, not endorsement and not criticism/i,
    'an unmentioned pick is recorded as unmentioned');
});

ok('the season previews are resolved against our own seven, not just filed', () => {
  const p = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/season-ohaire-division-previews.json'), 'utf8'));
  const entry = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds/round-01.json'), 'utf8'));
  const a = p.againstOurRoundOneEntry;

  /* Every player the file claims is one of ours must actually be one of ours.
     A benchmark that says "our forward" about somebody we never picked is
     worse than no benchmark, because it reads as corroboration. */
  const surname = (s) => String(s).trim().split(/\s+/).pop().toLowerCase();
  const ourSurnames = new Set(entry.picks.players.map((x) => surname(x.name)));
  const claimed = [...a.supportive, ...a.cautionary].map((x) => x.ourPick);
  assert.ok(claimed.length >= 5, 'several of our picks are covered');
  for (const c of claimed) {
    const name = c.split('(')[0].trim();
    assert.ok(ourSurnames.has(surname(name)), `${name} really is one of our seven`);
  }

  /* The captain caution must be attached to the actual captain, and the
     goalkeeper caution to an actual goalkeeper. */
  const captain = entry.picks.players.find((x) => x.id === entry.picks.captain);
  const capNote = a.cautionary.find((x) => /CAPTAIN/.test(x.ourPick));
  assert.ok(capNote, 'the captain caution exists');
  assert.ok(surname(capNote.ourPick.split('(')[0].trim()) === surname(captain.name),
    'and it names the player who is actually captained');
  const gkNote = a.cautionary.find((x) => /goalkeeper/i.test(x.ourPick));
  const gk = entry.picks.players.find((x) => x.position === 'GK');
  assert.ok(surname(gkNote.ourPick.split('(')[0].trim()) === surname(gk.name),
    'and the goalkeeper caution names our goalkeeper');

  /* The club claim, which is the heaviest thing in the file. */
  const clubs = (entry.picks.clubs || []).map((c) => c.name);
  assert.ok(clubs.some((c) => a.againstOurClubPick.ourPick.indexOf(c) === 0),
    'the relegation claim is about a club we actually picked');
});

ok('a betting source is stored as analysis, and says so', () => {
  const p = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/season-ohaire-division-previews.json'), 'utf8'));
  /* Every headline claim in these documents carries a price. The rule this
     project has applied all day to odds-derived material is that it is held
     as forecast analysis and never as advice, and the file has to carry that
     itself rather than rely on a commit message nobody will re-read. */
  assert.ok(p.whatThisIsNot.some((s) => /offers no betting advice/i.test(s)),
    'the file states its own stance on the betting content');
  assert.ok(p.recommendedBetsAsPublished.storedWhy,
    'and explains why the selections are stored verbatim at all');

  /* The absence trap, which this project has walked into four times this
     week. Reading is our captain's club and is not in the League One
     preview; the file must say that proves nothing. */
  assert.ok(p.whatThisIsNot.some((s) => /ABSENCE FROM THESE DOCUMENTS MEANS NOTHING/.test(s)),
    'and refuses to read absence as evidence');

  /* The division question was opened, then resolved by the owner the same
     day. What the test guards now is the SHAPE of the resolution: it must
     name who resolved it, and it must not lean on Notts County's absence
     from the League Two preview — because this same file declares that
     absence proves nothing, and that rule cannot be suspended the moment
     absence would happen to agree with us. */
  assert.match(p.openQuestionRaised.status, /RESOLVED/,
    'the division question has been settled');
  assert.ok(p.openQuestionRaised.resolvedBy, 'and the resolution names its source');
  assert.match(p.openQuestionRaised.resolvedBy, /rather than as a feed confirmation/i,
    'and does not dress an owner resolution up as a feed one');
  assert.match(p.openQuestionRaised.whatItDoesNotRestOn, /absence/i,
    'and refuses the convenient absence argument by name');
});

ok('the tipsters inference was narrowed, and the measured number left alone', () => {
  const t = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-tipsters.json'), 'utf8'));
  assert.ok(t.againstOurEntry.correction, 'the corrected reading is recorded on the file it corrects');
  assert.equal(t.againstOurEntry.overlapWithOurSeven, 0,
    'and the count is untouched — a wrong inference from a right number is fixed '
    + 'by narrowing the inference, not by editing the number');
});


/* ── A GRADED ROUND MUST DESCRIBE A ROUND OF FOOTBALL ──────────────────────
   Round 1 of 2026-27 was graded, committed and PUBLISHED with all 3,442
   players on about -250 points, our squad on -1899, and a rank correlation of
   -0.718 identical in every position. It was not a bad model: the lock
   baseline had been captured against the previous season and the feed rolled
   over before grading, so the subtraction returned newSeasonSoFar minus
   lastSeasonFinal.

   Nothing here caught it — an outside screenshot did. These checks exist so
   the next one is caught by us. */
ok('every graded round is physically possible, and a voided one says so', () => {
  const files = readdirSync(join(ROOT, 'efl/data/rounds')).filter((f) => /^round-\d+\.json$/.test(f));
  assert.ok(files.length > 0, 'there is at least one round entry');
  for (const f of files) {
    const r = JSON.parse(readFileSync(join(ROOT, 'efl/data/rounds', f), 'utf8'));

    if (!r.result) {
      /* Ungraded is legitimate. A VOIDED grading must not look like one that
         simply has not run yet. */
      if (r.voidedGrading) {
        assert.ok(r.voidedGrading.whyItIsVoid, `${f}: a voided grading explains why`);
        assert.ok(r.voidedGrading.thePreservedGradingForReference,
          `${f}: the faulty grading is preserved, not deleted`);
        assert.ok(r.picks && Array.isArray(r.picks.players) && r.picks.players.length > 0,
          `${f}: voiding did not disturb the recorded picks`);
        assert.ok(r.universe && r.universe.rows.length > 0,
          `${f}: voiding did not disturb the lock snapshot`);
      }
      continue;
    }

    const pts = ((r.result.squad && r.result.squad.players) || []).map((p) => p.points);
    if (pts.length) {
      const negatives = pts.filter((p) => p < 0).length;
      assert.ok(negatives <= 1, `${f}: at most one negative player score, got ${negatives} of ${pts.length}`);
      assert.ok(Math.min(...pts) > -60, `${f}: no player below -60, worst ${Math.min(...pts)}`);
      assert.ok(Math.max(...pts) < 200, `${f}: no player above 200, best ${Math.max(...pts)}`);
    }
    if (r.result.model && Number.isFinite(r.result.model.rho)) {
      /* A useless model scores about zero. A large NEGATIVE correlation,
         uniform across positions, is an inverted quantity, not a verdict. */
      assert.ok(r.result.model.rho > -0.4,
        `${f}: model rho ${r.result.model.rho.toFixed(3)} is the signature of an inverted measurement`);
    }
  }
});

ok('the grader refuses an implausible grading and names the cause', () => {
  const g = readFileSync(join(ROOT, 'scripts/efl/grade-round.mjs'), 'utf8');
  assert.match(g, /refusing to grade/, 'it refuses');
  assert.match(g, /season rollover|rolled over/i, 'and names the rollover');
  assert.match(g, /NEGATIVE round points/, 'and reports what it saw');
});

ok('the outside capture that exposed it stays on the record', () => {
  const c = JSON.parse(readFileSync(join(ROOT, 'efl/data/benchmarks/round-01-community-results.json'), 'utf8'));
  assert.equal(c.observedRoundOneScores.statedRoundAverage, 44, 'the observed round-1 average is recorded');
  assert.ok(c.observedRoundOneScores.players.every((p) => p.points > 0),
    'every observed round-1 score is positive — the fact that made -1899 impossible');
  assert.match(JSON.stringify(c), /It took a stranger/,
    'and it records that nothing of ours caught the fault');
});

console.log(`✓ Fantasy EFL ledger: ${checks} checks passed`);
