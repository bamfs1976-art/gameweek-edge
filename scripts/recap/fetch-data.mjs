/*
 * Build the recap dataset for the latest finished gameweek from the
 * official FPL API. Writes scripts/recap/recap.json and reports the
 * gameweek number (to $GITHUB_OUTPUT as `gw`, or `gw=none`).
 *
 * Run: node scripts/recap/fetch-data.mjs
 */
import { writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = 'https://fantasy.premierleague.com/api';
const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

async function get(path) {
  const r = await fetch(`${API}/${path}`, {
    headers: { 'User-Agent': 'gameweek-edge-recap/1.0', 'Accept': 'application/json' }
  });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

function output(gw) {
  const f = process.env.GITHUB_OUTPUT;
  if (f) appendFileSync(f, `gw=${gw}\n`);
  console.log(`gw=${gw}`);
}

const boot = await get('bootstrap-static/');
const finished = boot.events.filter(e => e.finished && e.data_checked);
const ev = finished[finished.length - 1];
if (!ev) { output('none'); process.exit(0); }
const gw = ev.id;

const [live, dream] = await Promise.all([
  get(`event/${gw}/live/`),
  get(`dream-team/${gw}/`).catch(() => ({ team: [], top_player: null }))
]);

const teams = {}; boot.teams.forEach(t => { teams[t.id] = t; });
const els = {}; boot.elements.forEach(e => { els[e.id] = e; });
const gwPts = {}; (live.elements || []).forEach(e => { gwPts[e.id] = (e.stats && e.stats.total_points) || 0; });

const short = id => (teams[id] || {}).short_name || '';
const card = (e, pts) => ({
  name: e.web_name, team: short(e.team), code: e.code,
  pos: POS[e.element_type], pts
});

/* Top 5 hauls of the gameweek (live points). */
const hauls = boot.elements
  .map(e => ({ e, p: gwPts[e.id] || 0 }))
  .sort((a, b) => b.p - a.p).slice(0, 5)
  .map(x => card(x.e, x.p));

/* Team of the Week from the official dream-team endpoint. */
const xi = (dream.team || []).map(p => els[p.element])
  .filter(Boolean).map(e => card(e, gwPts[e.id] || 0));
const dreamTotal = (dream.team || []).reduce((s, p) => s + (p.points || 0), 0);
const topEl = dream.top_player && els[dream.top_player.id];

/* Biggest price riser of the week; fall back to the most-bought player. */
const risers = boot.elements.slice().sort((a, b) => (b.cost_change_event || 0) - (a.cost_change_event || 0));
let riser;
if (risers[0] && (risers[0].cost_change_event || 0) > 0) {
  riser = { name: risers[0].web_name, val: `+£${(risers[0].cost_change_event / 10).toFixed(1)}m` };
} else {
  const bought = boot.elements.slice().sort((a, b) => (b.transfers_in_event || 0) - (a.transfers_in_event || 0))[0];
  riser = bought ? { name: bought.web_name, val: `${Math.round((bought.transfers_in_event || 0) / 1000)}k in` } : { name: '—', val: '' };
}

/* Most captained + its return, and the biggest differential haul (<10% owned). */
const capEl = els[ev.most_captained];
const captain = capEl
  ? { name: capEl.web_name, sub: `${gwPts[capEl.id] || 0} pts · ${capEl.selected_by_percent}% owned` }
  : { name: '—', sub: '' };
const diffEl = boot.elements
  .filter(e => parseFloat(e.selected_by_percent) < 10 && (gwPts[e.id] || 0) > 0)
  .sort((a, b) => (gwPts[b.id] || 0) - (gwPts[a.id] || 0))[0];
const diff = diffEl
  ? { name: diffEl.web_name, sub: `${diffEl.selected_by_percent}% owned · ${gwPts[diffEl.id] || 0} pts` }
  : { name: '—', sub: '' };

const recap = {
  gw,
  hauls,
  dream: { total: dreamTotal, top: topEl ? topEl.web_name : (hauls[0] || {}).name || '—', xi },
  numbers: {
    riser,
    captain,
    diff,
    scores: { avg: ev.average_entry_score || 0, high: ev.highest_score || 0 }
  }
};

writeFileSync(join(HERE, 'recap.json'), JSON.stringify(recap, null, 2));
console.error(`Recap built for GW${gw}: ${hauls.length} hauls, ${xi.length} in the Team of the Week.`);
output(gw);
