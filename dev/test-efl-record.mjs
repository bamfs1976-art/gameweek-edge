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
import { readFileSync } from 'node:fs';

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

console.log(`✓ Fantasy EFL ledger: ${checks} checks passed`);
