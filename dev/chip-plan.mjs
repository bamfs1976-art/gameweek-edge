/*
 * The app's chip plan, run against the LIVE fixture list.
 *
 *   node dev/chip-plan.mjs                 # first half, from the next gameweek
 *   node dev/chip-plan.mjs --from 1        # pin the starting gameweek
 *
 * The offline tests prove the planner finds a planted answer in constructed
 * fixtures. They cannot tell you whether it says anything sensible about the
 * real season, and that is the only question a reader cares about — the
 * community publishes its chip windows openly, so the plan is checkable
 * against people who have looked at the same fixture list by eye.
 *
 * Prints the picks, the ranked alternatives behind each one, and the
 * calendar facts (breaks, midweek rounds) that moved them, so a disagreement
 * with a human can be traced to a reason rather than argued about.
 *
 * Reads the official FDR off the fixtures endpoint — the same numbers the
 * community argues with — so it needs no model bundle, only the FPL API.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildChipApi } from '../scripts/chipplan-parts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_BASE = (process.env.FPL_API || 'https://fantasy.premierleague.com/api').replace(/\/$/, '');
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : null; };

const get = async (path) => {
  const r = await fetch(`${API_BASE}/${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'gameweek-edge/chip-plan' },
    signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
};

const [boot, fixtures] = await Promise.all([get('bootstrap-static/'), get('fixtures/')]);
const API = buildChipApi(readFileSync(join(ROOT, 'index.html'), 'utf8'));

const short = {};
(boot.teams || []).forEach((t) => { short[t.id] = t.short_name; });
const upcoming = (boot.events || []).find((e) => e.is_next) ||
  (boot.events || []).find((e) => !e.finished) || { id: 1 };

const b = {
  events: boot.events, elements: boot.elements, raw: { teams: boot.teams },
  upcoming, cur: upcoming, rules: null
};
const startGw = parseInt(arg('from'), 10) || upcoming.id;

const plan = API.chipPlanFdr(b, fixtures, { startGw });
if (!plan) {
  console.log('No plan: not enough playable gameweeks in the window.');
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n── chip plan · GW${plan.window.from}–${plan.window.to} · from GW${startGw} ──`);
console.log(`league mean FDR ${plan.leagueMean.toFixed(2)} over ${plan.gws.length} playable gameweeks`);
if (plan.breakGws.length) console.log(`international breaks before: GW${plan.breakGws.join(', GW')}`);
if (plan.congestGws && plan.congestGws.length) {
  console.log('midweek-crowded: ' + plan.congestGws
    .map((g) => `GW${g}${plan.congested[g] > 1 ? ' (both sides)' : ''}`).join(', '));
}

console.log('\nPICKS');
for (const key of ['wildcard', 'benchboost', 'triplecaptain', 'freehit']) {
  const p = plan.picks[key];
  if (!p) { console.log('  ' + pad(key, 14) + '—  no candidate week'); continue; }
  const notes = [];
  if (p.blank) notes.push(`${p.blank} blanks`);
  if (p.double) notes.push(`${p.double} doubles`);
  if (p.afterBreak) notes.push(`post-break (${p.afterBreak}d)`);
  if (p.congested) notes.push(p.congested > 1 ? 'midweek both sides' : 'midweek round');
  if (p.el) notes.push(`${p.el.web_name} v ${short[p.opp] || p.opp} (FDR ${p.fdr})`);
  if (p.mean != null) notes.push(`mean FDR ${p.mean.toFixed(2)}`);
  /* How much better the chosen week actually is than an average one. This is
     the number that decides whether the pick is a finding or a coin toss, and
     leaving it out of a printout makes every pick look equally considered. */
  if (p.edge != null) notes.push(`edge ${p.edge.toFixed(2)}${p.edge < 0.15 ? ' — near-arbitrary' : ''}`);
  if (p.provisional) notes.push('provisional — far out');
  console.log('  ' + pad(key, 14) + pad('GW' + p.gw, 6) + notes.join(' · '));
}

/* The honest headline. When every gameweek in the half sits within a
   rounding error of the league mean, the difficulty-ranked chips are not
   choosing between good and bad weeks — there is nothing to choose between,
   and a confident-looking pick would be false precision. */
const means = plan.gws.map((g) => g.mean).filter((m) => m != null);
if (means.length) {
  const spread = Math.max(...means) - Math.min(...means);
  console.log(`\nFDR spread across the half: ${spread.toFixed(2)} ` +
    `(${Math.min(...means).toFixed(2)}–${Math.max(...means).toFixed(2)})`);
  if (spread < 0.35) {
    console.log('  ⚠ Essentially flat. Bench Boost and Free Hit are ranked on');
    console.log('    differences smaller than the rounding on a single fixture,');
    console.log('    so those two picks carry no real signal this half. The');
    console.log('    wildcard swing and the captain fixture do — read those.');
  }
}

console.log('\nRANKED ALTERNATIVES (what each chip wanted, before collisions)');
for (const key of ['wildcard', 'benchboost', 'triplecaptain', 'freehit']) {
  const rank = (plan.rank[key] || []).slice(0, 5);
  if (!rank.length) continue;
  const cells = rank.map((r) => {
    if (key === 'wildcard') return `GW${r.gw} (${r.turning} clubs improve)`;
    if (key === 'benchboost') return `GW${r.gw} (${r.adjusted.toFixed(2)}${r.congested ? ' ✱' : ''})`;
    if (key === 'triplecaptain') return `GW${r.gw} (${r.el ? r.el.web_name : '?'})`;
    return `GW${r.gw} (${r.mean.toFixed(2)})`;
  });
  console.log('  ' + pad(key, 14) + cells.join('  '));
}
console.log('  ✱ = marked down for midweek congestion\n');

/* ── The ownership-weighted view ──────────────────────────────────
   Everything above ranks a gameweek on raw fixture difficulty, which asks
   "when are the fixtures good?". The community argues a different question —
   "when is my squad furthest from everybody else's?" — and the answer moves,
   because a week where the MOST-OWNED clubs are stuck is a week a bespoke XI
   gains on the field even if the league's mean difficulty is ordinary.

   The app has always shown both, on separate pages. This tool showed only the
   first, so it answered the fixture question while looking like it had
   answered the chip question. That is how a disagreement with a human plan
   gets reported as our planner disagreeing, when in fact the two were not
   discussing the same thing. */
const swWindow = plan.gws.map((g) => g.gw);
const ownByTeam = {};
for (const el of boot.elements || []) {
  const own = parseFloat(el.selected_by_percent);
  if (Number.isFinite(own)) ownByTeam[el.team] = (ownByTeam[el.team] || 0) + own;
}
/* Official FDR per club per gameweek. A club with no fixture that week gets
   6 — worse than the worst real fixture — which is what the app does, and is
   right: a blank is not an easy week, it is no week. */
const diffByTeam = {};
for (const f of fixtures || []) {
  if (!f || !swWindow.includes(f.event)) continue;
  (diffByTeam[f.team_h] = diffByTeam[f.team_h] || {})[f.event] = f.team_h_difficulty;
  (diffByTeam[f.team_a] = diffByTeam[f.team_a] || {})[f.event] = f.team_a_difficulty;
}
const runs = (boot.teams || []).map((t) => ({
  team: t.id, name: t.short_name, own: ownByTeam[t.id] || 0,
  diff: swWindow.map((g) => (diffByTeam[t.id] || {})[g] ?? 6)
}));
const sw = API.chipSwings(runs, Math.min(5, Math.max(1, swWindow.length - 3)), 6);

console.log('OWNERSHIP-WEIGHTED SWING (the other question: when is the field stuck?)');
const totalOwn = runs.reduce((a, r) => a + r.own, 0);
if (sw.fh) {
  console.log(`  freehit       GW${swWindow[sw.fh.idx]}  weighted difficulty ` +
    `${sw.fh.score.toFixed(2)} vs ${sw.fh.base.toFixed(2)} average` +
    `${sw.fh.clear ? '' : ' — does NOT clear the 12% margin, so the app would not show it'}`);
}
if (sw.wc) {
  console.log(`  wildcard      GW${swWindow[sw.wc.idx]}  difficulty shed by reshaping ` +
    `≈ ${sw.wc.gain.toFixed(0)}${sw.wc.gain > 2 ? '' : ' — under the threshold the app shows'}`);
}
/* The caveat has to be printed, not remembered. Ownership in August is a
   record of who drafted what before a ball was kicked; the plans this is
   being read against are about December, by which time the field has moved.
   A weighting that stale is an input worth seeing and not worth trusting. */
const top = runs.slice().sort((a, c) => c.own - a.own).slice(0, 5)
  .map((r) => `${r.name} ${(r.own / totalOwn * 100).toFixed(1)}%`).join(', ');
console.log(`  weighting: ${top} (share of all ownership, today)`);
console.log('  ⚠ Ownership is TODAY\'S. Read against a plan for December it is the');
console.log('    weakest input here — the field will have moved by then, and this');
console.log('    cannot see that. The fixtures above are fixed; this is not.\n');
