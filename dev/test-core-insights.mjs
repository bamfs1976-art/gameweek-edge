/*
 * Offline test for the FPL Core Insights aggregator's pure core
 * (netlify/functions/core-insights.js). Proves CSV parsing, per-player
 * season aggregation (goals prevented, non-penalty xG, per-90s) and season
 * selection — no network, no Supabase.
 *
 * Run: node dev/test-core-insights.mjs   (wired into npm test)
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { parseCsv, aggregate, deriveSeasonLabel, seasonCandidates } =
  require(join(ROOT, 'netlify', 'functions', 'core-insights.js'));

let failures = 0, passes = 0;
const ok = (c, label) => { if (c) passes++; else { failures++; console.error('  ✗ ' + label); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('• core-insights: CSV parse + aggregate');

/* ── CSV parser ─────────────────────────────────────────── */
const csv = 'player_id,minutes_played,goals_prevented,"quoted"\n7,90,0.5,"a,b"\n7,45,-0.2,c\n';
const rows = parseCsv(csv);
ok(rows.length === 2, 'parses two data rows');
ok(rows[0].player_id === '7' && rows[0].minutes_played === '90', 'maps header to cells');
ok(rows[0].quoted === 'a,b', 'handles quoted comma field');

/* ── aggregation: two keepers over two gameweeks ────────── */
/* Player 7 (keeper): GW1 full game preventing +0.5, GW2 half game -0.2.
   Player 9 (outfield): one game, 1 goal from 0.9 xG incl. a scored penalty. */
const matchRows = [
  { player_id: '7', minutes_played: '90', goals_prevented: '0.5', xgot_faced: '2.0', saves: '4', goals_conceded: '1', xg: '0', xgot: '0', big_chances_missed: '0', chances_created: '0', touches_opposition_box: '0', penalties_scored: '0', penalties_missed: '0' },
  { player_id: '7', minutes_played: '45', goals_prevented: '-0.2', xgot_faced: '1.0', saves: '1', goals_conceded: '1', xg: '0', xgot: '0', big_chances_missed: '0', chances_created: '0', touches_opposition_box: '0', penalties_scored: '0', penalties_missed: '0' },
  { player_id: '9', minutes_played: '90', goals_prevented: '0', xgot_faced: '0', saves: '0', goals_conceded: '0', xg: '0.90', xgot: '0.80', big_chances_missed: '1', chances_created: '3', touches_opposition_box: '7', penalties_scored: '1', penalties_missed: '0' },
  { player_id: '', minutes_played: '10', xg: '5' },   // junk row: no id → ignored
];
const out = aggregate('2025-2026', matchRows);
const byId = Object.fromEntries(out.map((r) => [r.element, r]));

ok(out.length === 2, 'ignores rows without a player id');

const k = byId[7];
ok(k && k.games === 2, 'keeper: two games with minutes');
ok(k.minutes === 135, 'keeper: minutes summed');
ok(near(k.goals_prevented, 0.3), 'keeper: goals prevented summed (0.5 - 0.2)');
ok(near(k.goals_prevented_per_90, 0.2), 'keeper: goals prevented per 90 (0.3 * 90 / 135)');
ok(k.saves === 5 && k.goals_conceded === 2, 'keeper: saves and conceded summed');

const o = byId[9];
ok(o && o.games === 1, 'outfielder: one game');
/* np_xg = 0.90 - 0.79 * 1 penalty = 0.11 */
ok(near(o.np_xg, 0.11, 1e-9), 'outfielder: non-penalty xG strips the penalty');
ok(near(o.np_xg_per_90, 0.11, 1e-9), 'outfielder: np xG per 90 over a full game');
ok(o.big_chances_missed === 1 && o.chances_created === 3 && o.touches_opp_box === 7, 'outfielder: involvement summed');
ok(o.xgot === 0.8, 'outfielder: xGOT summed');
ok(o.defcon_starts === 0 && o.defcon_hit_rate == null, 'defcon null without a position map');

/* ── defensive-contribution hit rate ────────────────────── */
console.log('• core-insights: defensive-contribution hit rate');
const { positionMap } = require(join(ROOT, 'netlify', 'functions', 'core-insights.js'));
const positions = positionMap('player_id,position\n5,Defender\n6,Midfielder\n7,Goalkeeper\n');
ok(positions[5] === 'Defender' && positions[6] === 'Midfielder', 'positionMap parses positions');

const dcRow = (id, mins, cl, bl, intc, tk, rec) => ({
  player_id: String(id), minutes_played: String(mins),
  clearances: String(cl), blocks: String(bl), interceptions: String(intc), tackles: String(tk), recoveries: String(rec),
});
const dcRows = [
  /* Defender 5 (threshold 10 CBIT): GW1 clears (5+2+2+2=11), GW2 misses (2+1+1+1=5),
     GW3 clears (10) but only 45 mins → not a "start", ignored. */
  dcRow(5, 90, 5, 2, 2, 2, 9),
  dcRow(5, 90, 2, 1, 1, 1, 9),
  dcRow(5, 45, 10, 0, 0, 0, 0),
  /* Midfielder 6 (threshold 12 CBIRT): CBIT 8 + recoveries 5 = 13 → clears. */
  dcRow(6, 90, 3, 1, 2, 2, 5),
  /* Keeper 7: high CBI but GK has no defcon category → ignored. */
  dcRow(7, 90, 20, 0, 0, 0, 0),
];
const dc = Object.fromEntries(aggregate('2025-2026', dcRows, positions).map((r) => [r.element, r]));
const d5 = dc[5];
ok(d5.defcon_starts === 2, 'defender: only >=60-min matches count as starts (bench game excluded)');
ok(d5.defcon_hits === 1, 'defender: one of two starts clears the CBIT threshold');
ok(near(d5.defcon_hit_rate, 0.5), 'defender: hit rate = 1/2');
ok(d5.defcon_actions === 16 && near(d5.defcon_per_start, 8), 'defender: CBIT actions per start (11+5)/2');
ok(dc[6].defcon_hits === 1 && near(dc[6].defcon_hit_rate, 1), 'midfielder: CBIRT (incl. recoveries) clears 12');
ok(dc[7].defcon_starts === 0 && dc[7].defcon_hit_rate == null, 'goalkeeper: no defensive-contribution category');

/* The feed also publishes its own `defensive_contributions` column, and
   reading it instead of recomputing is the obvious simplification. Measured
   over 2025-26 GW9-11 it is unusable: 35% of 60+ minute outfielders carry a
   published zero while their component columns show real actions. Taking
   those at face value would deflate every hit rate this file feeds.

   So the components win, always — and this pins it, because the failure mode
   of "simplifying" to the published column is silent: hit rates would just
   drift down and every defensive read in the app would get quietly more
   pessimistic. */
const contradicted = [
  /* A defender who plainly cleared the bar (5+2+2+2 = 11 CBIT) while the
     published aggregate claims nothing happened. */
  { ...dcRow(5, 90, 5, 2, 2, 2, 0), defensive_contributions: '0' },
  /* And one where the published figure is populated but disagrees. */
  { ...dcRow(5, 90, 4, 3, 2, 2, 0), defensive_contributions: '99' },
];
const cd = Object.fromEntries(aggregate('2025-2026', contradicted, positions).map((r) => [r.element, r]));
ok(cd[5].defcon_starts === 2, 'both appearances still count as starts');
ok(cd[5].defcon_hits === 2, 'a published zero does not erase a start that cleared the threshold');
ok(cd[5].defcon_actions === 22, 'actions come from the components (11 + 11), never the aggregate column');
ok(cd[5].defcon_actions !== 99 && cd[5].defcon_actions !== 0,
  'and a contradictory published value is ignored in both directions');

/* ── season selection ───────────────────────────────────── */
console.log('• core-insights: season selection');
ok(deriveSeasonLabel(new Date('2026-07-24T00:00:00Z')) === '2026-2027', 'July belongs to the new season');
ok(deriveSeasonLabel(new Date('2026-01-10T00:00:00Z')) === '2025-2026', 'January belongs to the running season');
ok(deriveSeasonLabel(new Date('2025-08-01T00:00:00Z')) === '2025-2026', 'August starts the new season');
const cands = seasonCandidates(new Date('2026-07-24T00:00:00Z'));
ok(cands[0] === '2026-2027' && cands[1] === '2025-2026', 'falls back to the previous season');

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
