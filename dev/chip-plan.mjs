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
  if (p.provisional) notes.push('provisional — far out');
  console.log('  ' + pad(key, 14) + pad('GW' + p.gw, 6) + notes.join(' · '));
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
