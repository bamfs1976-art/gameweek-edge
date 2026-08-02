/*
 * Grade our gameweek projections against a rival's published ones.
 *
 *   node scripts/compare-projections.mjs
 *   node scripts/compare-projections.mjs --score
 *   node scripts/compare-projections.mjs --file data/projections/<other>.json
 *   FPL_API=http://127.0.0.1:8700/api/fpl node scripts/compare-projections.mjs
 *
 * Why this exists.
 *
 * Every FPL account publishes projections. Almost nobody publishes them in a
 * form that can be marked afterwards, and nobody marks them. That gap is the
 * product: our numbers are already published and graded, so the honest move is
 * to grade them against somebody else's on the same players, in the same
 * window, decided by the same actuals — and to publish the result whichever
 * way it falls.
 *
 * Two modes.
 *
 *   default   before the window is played: how far apart are the two, and on
 *             which players. Settles nothing. It is a disagreement map, and it
 *             says so.
 *   --score   after the window: both sides against what actually happened.
 *             This is the only mode that decides anything.
 *
 * WHOSE NUMBERS ARE OURS. `nativeXP` needs five played gameweeks before it
 * will return anything, so before the season starts it returns null for every
 * player and the app falls back to FPL's provisional `ep_next` — which the app
 * says on screen, and which this script says too. Reporting FPL's numbers
 * under our model's name would be the exact failure this repo's checkers exist
 * to prevent, so every row records the source that produced it and the summary
 * refuses to call a winner when the sources are mixed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spearman, mae, bias, disagreements, score, verdict,
  matchPlayer } from './projection-compare.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : null; };
const has = (n) => process.argv.indexOf('--' + n) > -1;
const FILE = arg('file') || 'data/projections/2026-27-gw1-5-marcello.json';
const API = (process.env.FPL_API || 'https://fantasy.premierleague.com/api').replace(/\/$/, '');

const rival = JSON.parse(readFileSync(join(ROOT, FILE), 'utf8'));
const WIN = rival.window || { from: 1, to: 5 };

const say = (icon, s) => console.log('  ' + icon + ' ' + s);
console.log('Rival: ' + rival.source);
console.log('Window: GW' + WIN.from + '-' + WIN.to + ' · ' + rival.players.length +
  ' ' + (rival.position || 'player') + ' projections · published ' + rival.posted + '\n');

/* Same shape guard as the briefing checker, for the same reason: a file that
   silently loses half its rows produces a confident comparison over nothing. */
if (!Array.isArray(rival.players) || rival.players.length < 10) {
  console.error('✗ SHAPE: expected at least 10 rival projections, found ' +
    (rival.players || []).length);
  process.exit(2);
}

async function fpl(path) {
  const r = await fetch(API + '/' + path);
  if (!r.ok) throw new Error(path + ' HTTP ' + r.status);
  return r.json();
}

let boot, fixtures;
try {
  [boot, fixtures] = await Promise.all([fpl('bootstrap-static/'), fpl('fixtures/')]);
} catch (e) {
  console.error('Could not reach the FPL API (' + API + '): ' + e.message);
  console.error('Nothing was compared. Re-run with network access.');
  process.exit(3);
}

const els = boot.elements || [];
const teamList = boot.teams || [];
const teams = Object.fromEntries(teamList.map((t) => [t.id, t]));
const findPlayer = (name, teamLabel) => matchPlayer(els, teamList, name, teamLabel);

/* ── our projection over the window ────────────────────────────── */
let E = null, engineErr = null;
try {
  const { loadEngine, buildIndex } = await import('./content/model.mjs');
  E = loadEngine();
  E.setRules(E.fplRules(boot));
  E._idx = buildIndex(boot, fixtures);
} catch (e) { engineErr = e && e.message; }

/* One nativeXP call per fixture in the window, summed. Summing per-fixture
   rather than multiplying one fixture by five is the whole point: a club with
   Arsenal away then Hull at home is not five average games, and the fixture
   term is where our match model actually enters the projection. */
function ourWindow(el) {
  if (!E) return { xp: null, src: 'engine unavailable' };
  const R = E.plsimRatings(E._idx, fixtures);
  const BM = (E.PLSIM.BASE_H + E.PLSIM.BASE_A) / 2;
  const played = {};
  fixtures.filter((f) => f.finished).forEach((f) => {
    played[f.team_h] = (played[f.team_h] || 0) + 1;
    played[f.team_a] = (played[f.team_a] || 0) + 1;
  });
  const mine = fixtures.filter((f) => (f.team_h === el.team || f.team_a === el.team) &&
    f.event >= WIN.from && f.event <= WIN.to);
  if (!mine.length) return { xp: null, src: 'no fixtures in window' };
  let total = 0, n = 0;
  for (const f of mine) {
    const m = E.plsimMatch(R, f.team_h, f.team_a);
    if (!m) continue;
    const home = f.team_h === el.team;
    const nf = { lam: home ? m.hx : m.ax, cs: home ? m.csH : m.csA,
      lamAvg: BM * R.att[el.team], gp: played[el.team] || 0, congest: 0 };
    const v = E.nativeXP(el, nf);
    if (v == null || !Number.isFinite(v)) return { xp: null, src: 'native model not ready' };
    total += v; n++;
  }
  return n ? { xp: total, src: 'nativeXP', games: n } : { xp: null, src: 'no modelled fixtures' };
}

/* The pre-season fallback the app itself uses, and it is labelled as FPL's
   number rather than ours wherever it appears. */
function fplFallback(el) {
  const ep = parseFloat(el.ep_next || '0');
  if (!Number.isFinite(ep) || ep <= 0) return null;
  const games = fixtures.filter((f) => (f.team_h === el.team || f.team_a === el.team) &&
    f.event >= WIN.from && f.event <= WIN.to).length;
  return games ? ep * games : null;
}

/* ── build the rows ────────────────────────────────────────────── */
const rows = [];
const unmatched = [];
const srcCount = {};
for (const p of rival.players) {
  const el = findPlayer(p.name, p.team);
  if (!el) { unmatched.push(p.name + ' (' + p.team + ')'); continue; }
  const own = ourWindow(el);
  let ours = own.xp, src = own.src;
  if (ours == null) {
    const fb = fplFallback(el);
    if (fb != null) { ours = fb; src = 'FPL ep_next (not our model)'; }
  }
  srcCount[src] = (srcCount[src] || 0) + 1;
  rows.push({ name: el.web_name, team: (teams[el.team] || {}).short_name || '?',
    id: el.id, price: (el.now_cost || 0) / 10, rivalPrice: p.price,
    rival: p.proj, ours, src, actual: null });
}

console.log('MATCHED');
say('·', rows.length + ' of ' + rival.players.length + ' rival rows matched to a real player');
if (unmatched.length) say('·', 'unmatched: ' + unmatched.join(', '));
for (const [s, n] of Object.entries(srcCount)) say('·', n + ' from ' + s);

/* The same guard the briefing checker carries, for the same reason: a run that
   matched almost nothing and then printed a tidy correlation is worse than no
   run, because it converts an uncompared file into a compared-looking one. A
   club renamed in the game, or a rival file written with different labels,
   both land here — loudly. */
const COVERAGE_FLOOR = 0.5;
const thin = rows.length < rival.players.length * COVERAGE_FLOOR;
if (thin) {
  console.log('\n  ✗ MATCHED ALMOST NOTHING — ' + rows.length + ' of ' + rival.players.length +
    '. Everything below is computed over that fraction and should not be quoted.');
  console.log('    Usually a club label in the rival file that the game does not use, or a');
  console.log('    mock/stub API without real squads. Fix the labels before reading on.');
}

/* A comparison in which our side is entirely FPL's provisional number is not a
   comparison between two models, and saying so is the point of the script. */
const ourOwn = rows.filter((r) => r.src === 'nativeXP').length;
const MIXED = ourOwn > 0 && ourOwn < rows.filter((r) => r.ours != null).length;
if (!ourOwn) {
  console.log('\n  ! Our native model produced nothing for this window. nativeXP needs five');
  console.log('    played gameweeks before it will return a number, so pre-season every row');
  console.log('    below is FPL\'s provisional ep_next — the same fallback the app shows a');
  console.log('    banner for. This run can map disagreement; it cannot grade our model.');
  if (engineErr) console.log('    (engine also failed to load: ' + engineErr + ')');
} else if (MIXED) {
  console.log('\n  ! Mixed sources: ' + ourOwn + ' rows from our model, the rest from FPL.');
  console.log('    Read the per-row source before quoting any of this.');
}

/* Their prices are checkable against the game, and a stale price means a stale
   projection — worth knowing before reading the numbers built on it. */
const priceOff = rows.filter((r) => r.rivalPrice != null && Math.abs(r.price - r.rivalPrice) >= 0.05);
console.log('\nTHEIR PRICES');
say('·', (rows.length - priceOff.length) + ' of ' + rows.length + ' match the live game');
for (const r of priceOff.slice(0, 8)) {
  say('✗', r.name + ': they say £' + r.rivalPrice.toFixed(1) + 'm, the game says £' + r.price.toFixed(1) + 'm');
}

/* ── score, or map the disagreement ────────────────────────────── */
if (has('score')) {
  const gws = [];
  for (let gw = WIN.from; gw <= WIN.to; gw++) {
    try { gws.push([gw, await fpl('event/' + gw + '/live/')]); }
    catch (e) { console.error('  ! GW' + gw + ' not available: ' + e.message); }
  }
  if (!gws.length) {
    console.error('\nNo completed gameweeks in the window. Nothing to score yet.');
    process.exit(4);
  }
  const got = {};
  for (const [, live] of gws) {
    for (const el of live.elements || []) {
      got[el.id] = (got[el.id] || 0) + ((el.stats && el.stats.total_points) || 0);
    }
  }
  for (const r of rows) if (got[r.id] != null) r.actual = got[r.id];

  const s = score(rows);
  console.log('\nSCORED against GW' + WIN.from + '-' + gws[gws.length - 1][0] + ' actuals');
  say('·', s.n + ' players with real points, ' + s.bothProjected + ' projected by both');
  if (s.ours) say('·', 'ours   MAE ' + s.ours.mae.toFixed(2) + '  bias ' +
    (s.ours.bias > 0 ? '+' : '') + s.ours.bias.toFixed(2));
  if (s.rival) say('·', 'theirs MAE ' + s.rival.mae.toFixed(2) + '  bias ' +
    (s.rival.bias > 0 ? '+' : '') + s.rival.bias.toFixed(2));
  if (s.rank) say('·', 'rank correlation with actuals — ours ' + s.rank.ours.toFixed(3) +
    ', theirs ' + s.rank.rival.toFixed(3));
  const v = verdict(s);
  console.log('\n  VERDICT: ' + v.call.toUpperCase() + ' — ' + v.why);
  if (MIXED || !ourOwn) {
    console.log('  Caveat: our side was not produced entirely by our own model on this run.');
  }
  console.log('\n  A five-week window over ' + s.bothProjected + ' forwards is one sample. It is');
  console.log('  published either way, which is the only part that makes it worth anything.');
} else {
  const both = rows.filter((r) => r.ours != null && r.rival != null);
  console.log('\nDISAGREEMENT (nothing is settled until --score after GW' + WIN.to + ')');
  if (both.length >= 3) {
    const rho = spearman(both.map((r) => r.ours), both.map((r) => r.rival));
    say('·', both.length + ' players on both sides · rank agreement ' +
      (rho == null ? 'n/a' : rho.toFixed(3)));
    say('·', 'mean absolute gap ' + mae(both.map((r) => [r.ours, r.rival])).toFixed(2) +
      ' pts · we are ' + (bias(both.map((r) => [r.ours, r.rival])) > 0 ? 'higher' : 'lower') +
      ' on average by ' + Math.abs(bias(both.map((r) => [r.ours, r.rival]))).toFixed(2));
  } else {
    say('·', 'only ' + both.length + ' players have a number on both sides');
  }
  for (const d of disagreements(both, 8)) {
    console.log('      • ' + d.name.padEnd(16) + (d.gap > 0 ? 'we are higher by ' : 'they are higher by ') +
      Math.abs(d.gap).toFixed(1) + '  (ours ' + d.ours.toFixed(1) + ', theirs ' + d.rival.toFixed(1) +
      ', ' + d.src + ')');
  }
  console.log('\n  Re-run with --score once GW' + WIN.to + ' is final.');
}

/* Exit non-zero when the comparison ran over too little to mean anything, so a
   scheduled run cannot report success on a file it could not read. */
if (thin) process.exit(4);
