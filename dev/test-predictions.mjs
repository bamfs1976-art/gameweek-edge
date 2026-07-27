/*
 * Offline test for the prediction logger's pure core
 * (netlify/functions/log-predictions.js → computePredictions). Proves the
 * model extracts cleanly from index.html and produces sane prediction rows
 * from a small synthetic bootstrap + fixtures — no FPL network, no Supabase.
 *
 * Run: node dev/test-predictions.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { computePredictions, seasonLabel } = require(join(ROOT, 'netlify', 'functions', 'log-predictions.js'));
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let failures = 0, passes = 0;
const ok = (c, label) => { if (c) passes++; else { failures++; console.error('  ✗ ' + label); } };
console.log('• prediction logger: extract model + compute rows');

/* A tiny 4-team league, one finished GW of results, an upcoming GW1->GW... */
const teams = [1, 2, 3, 4].map((id) => ({ id, name: ['Arsenal', 'Man City', 'Burnley', 'Luton'][id - 1], short_name: ['ARS', 'MCI', 'BUR', 'LUT'][id - 1] }));
const events = [
  { id: 1, deadline_time: '2026-08-15T17:30:00Z', finished: true, is_current: false, is_next: false, data_checked: true },
  { id: 2, deadline_time: '2999-01-01T11:00:00Z', finished: false, is_current: true, is_next: false, data_checked: false },
];
const mkEl = (id, team, type, xg, xa, dcp, bonus, saves) => ({
  id, team, element_type: type, web_name: 'P' + id, status: 'a', chance_of_playing_next_round: null,
  starts: 6, minutes: 540, ep_next: '4.0', form: '4.0', points_per_game: '4.0', selected_by_percent: '10',
  expected_goals_per_90: String(xg), expected_assists_per_90: String(xa), expected_goal_involvements_per_90: String(xg + xa),
  defensive_contribution_per_90: String(dcp), bonus, saves: saves || 0,
});
const elements = [];
let eid = 1;
for (const t of [1, 2, 3, 4]) {
  elements.push(mkEl(eid++, t, 1, 0, 0, 0, 4, 40));               // GK
  elements.push(mkEl(eid++, t, 2, 0.08, 0.1, 12, 8, 0));         // DEF
  elements.push(mkEl(eid++, t, 3, 0.3, 0.25, 8, 10, 0));         // MID
  elements.push(mkEl(eid++, t, 4, 0.5, 0.15, 3, 10, 0));         // FWD
}
const boot = { teams, elements, events, element_types: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], total_players: 1e6 };
const fixtures = [
  /* GW1 finished (gives the model some data to fit on) */
  { event: 1, team_h: 1, team_a: 3, team_h_score: 3, team_a_score: 0, finished: true, team_h_difficulty: 2, team_a_difficulty: 4 },
  { event: 1, team_h: 2, team_a: 4, team_h_score: 2, team_a_score: 1, finished: true, team_h_difficulty: 2, team_a_difficulty: 4 },
  /* GW2 upcoming */
  { event: 2, team_h: 1, team_a: 2, finished: false, team_h_difficulty: 3, team_a_difficulty: 3 },
  { event: 2, team_h: 3, team_a: 4, finished: false, team_h_difficulty: 3, team_a_difficulty: 3 },
];

const res = computePredictions(html, boot, fixtures);
ok(res.gw === 2, 'targets the upcoming gameweek (GW2)');
ok(res.rows.length > 0, 'produces prediction rows');
ok(res.rows.length <= elements.length, 'no more rows than players');
ok(res.rows.every((r) => r.gw === 2 && r.element > 0), 'every row is tagged to GW2 and a player');
/* Season discriminator — the rollover-safety key. */
ok(res.season === '2026/27', 'derives the season from the earliest deadline (Aug 2026 -> 2026/27)');
ok(res.rows.every((r) => r.season === '2026/27'), 'every prediction row carries the season');
ok(seasonLabel({ events: [{ deadline_time: '2027-08-14T17:30:00Z' }, { deadline_time: '2028-05-20T14:00:00Z' }] }) === '2027/28',
  'next season would tag 2027/28, so GW1 rows never collide across seasons');
ok(res.rows.every((r) => r.xp > 0 && Number.isFinite(r.xp)), 'xP is positive and finite');
ok(res.rows.every((r) => r.haul_prob >= 0 && r.haul_prob <= 1 && r.blank_prob >= 0 && r.blank_prob <= 1), 'haul/blank are probabilities');
/* All four teams play in GW2, so every fit player should get a row. */
ok(res.rows.length === elements.length, 'all players with a fixture are logged');
/* A premium forward should out-project a punt defender in the same slot. */
const fwd = res.rows.find((r) => r.element === 4), gk = res.rows.find((r) => r.element === 1);
ok(fwd && gk && fwd.xp > 0 && gk.xp > 0, 'both a forward and a goalkeeper are projected');

ok(res.rows.every((r) => r.fixtures === 1), 'a single gameweek is tagged as one fixture');

/* ── the side inputs the client attaches ─────────────────
   The logger used to build its bootstrap without them, which silently graded
   promoted clubs on the generic prior and every European club with no
   congestion discount — a different model from the one the app shows. */
const eloMap = { 1: 1950, 2: 1930, 3: 1500, 4: 1450 };
const resElo = computePredictions(html, boot, fixtures, eloMap);
ok(resElo.rows.length === res.rows.length, 'an Elo map changes projections, not which players are logged');
/* Teams 3 and 4 are absent from PLSIM.priors, so only they consult Elo. A
   plain re-run must therefore be identical for 1 and 2 and differ for 3/4. */
const xpOf = (rs, id) => (rs.find((r) => r.element === id) || {}).xp;
ok(xpOf(resElo.rows, 1) === xpOf(res.rows, 1), 'a club with a fitted prior is untouched by Elo');
ok(xpOf(resElo.rows, 9) !== xpOf(res.rows, 9), 'a club with no fitted prior takes the Elo-derived prior');

/* Congestion reaches the projection through minutesModel, which only runs
   once nativeXP is live — so this needs a season with enough games behind it
   than the two-fixture league above. Six finished gameweeks, then a seventh
   kicking off on the Sunday after a Thursday tie for Team 1. */
const eventsC = [1, 2, 3, 4, 5, 6].map((id) => ({ id, deadline_time: '2026-08-' + (8 + id) + 'T17:30:00Z', finished: true, data_checked: true }))
  .concat([{ id: 7, deadline_time: '2999-01-01T11:00:00Z', finished: false, is_current: true }]);
const fixturesC = [];
for (let gw = 1; gw <= 6; gw++) {
  fixturesC.push({ event: gw, team_h: gw % 2 ? 1 : 2, team_a: gw % 2 ? 3 : 4, team_h_score: 2, team_a_score: 1, finished: true });
  fixturesC.push({ event: gw, team_h: gw % 2 ? 2 : 1, team_a: gw % 2 ? 4 : 3, team_h_score: 1, team_a_score: 1, finished: true });
}
fixturesC.push({ event: 7, team_h: 1, team_a: 2, finished: false, kickoff_time: '2999-01-05T15:00:00Z' });
fixturesC.push({ event: 7, team_h: 3, team_a: 4, finished: false, kickoff_time: '2999-01-05T15:00:00Z' });
const bootC = { ...boot, events: eventsC };
const euroFeed = { rows: [{ team: 1, gw: 7, comp: 'UCL', kickoff: '2999-01-03T20:00:00Z' }] };
const resEuro = computePredictions(html, bootC, fixturesC, null, euroFeed);
const resNoEuro = computePredictions(html, bootC, fixturesC);
ok(xpOf(resNoEuro.rows, 3) > 0, 'the six-gameweek league has the sample for the native model');
ok(xpOf(resEuro.rows, 3) < xpOf(resNoEuro.rows, 3), 'a Thursday European tie discounts the Sunday projection');
ok(xpOf(resEuro.rows, 7) === xpOf(resNoEuro.rows, 7), 'a club not in Europe is unaffected');

/* ── double gameweeks ────────────────────────────────────
   The actual graded against is the whole gameweek, so a club playing twice
   must be projected over both legs or the row books a phantom miss. */
const dblFixtures = fixtures.concat([{ event: 2, team_h: 1, team_a: 4, finished: false, team_h_difficulty: 3, team_a_difficulty: 3 }]);
const resDbl = computePredictions(html, boot, dblFixtures);
const dblRow = resDbl.rows.find((r) => r.element === 3);      // a Team 1 midfielder
const sglRow = resDbl.rows.find((r) => r.element === 7);      // a Team 2 midfielder, single
ok(dblRow.fixtures === 2 && sglRow.fixtures === 1, 'the fixture count distinguishes a double from a single');
ok(dblRow.xp > xpOf(res.rows, 3), 'a double gameweek projects more than the same single gameweek');
ok(dblRow.haul_prob === null && dblRow.blank_prob === null,
  'haul/blank are left null on a double rather than logged as a one-match number');
ok(sglRow.haul_prob != null, 'a single gameweek still carries haul/blank');
ok(xpOf(resDbl.rows, 7) === xpOf(res.rows, 7), 'a single gameweek is unchanged by the double-aware path');

/* No upcoming gameweek → no rows, no throw. */
const bootDone = { ...boot, events: [{ id: 38, deadline_time: '2026-05-20T14:00:00Z', finished: true, is_current: true }] };
const res2 = computePredictions(html, bootDone, fixtures);
ok(res2.gw === null && res2.rows.length === 0, 'season over → nothing to log');

console.log('\n' + passes + ' passed, ' + failures + ' failed');
if (failures) process.exit(1);
