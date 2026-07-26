/*
 * Build the dataset for the "budget rotation" video: the exactly-solved
 * cheapest way to cover one squad slot across the opening run.
 *
 * Like log-predictions.js, the model is EXTRACTED from index.html at runtime
 * rather than reimplemented, so the plan in the video is the same plan the
 * app shows. A second copy of rotationChain here would drift within a month.
 *
 * Writes scripts/recap/rotation.json.
 *
 * Run: node scripts/recap/fetch-rotation.mjs
 *      node scripts/recap/fetch-rotation.mjs --base http://127.0.0.1:8700/api/fpl
 *          (any FPL-shaped source — used to verify offline against the mock)
 *      node scripts/recap/fetch-rotation.mjs --pos 1|2|3 --max 50 --weeks 10
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('base', 'https://fantasy.premierleague.com/api');
const POS = parseInt(arg('pos', '2'), 10);            /* 2 = defenders */
const MAXCOST = parseInt(arg('max', '50'), 10);       /* tenths of £m */
const WEEKS = parseInt(arg('weeks', '10'), 10);
const POSN = { 1: 'goalkeepers', 2: 'defenders', 3: 'midfielders', 4: 'forwards' };

async function get(path) {
  const r = await fetch(`${API}/${path}`, {
    headers: { 'User-Agent': 'gameweek-edge-recap/1.0', Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

/* ── lift the model out of index.html (same approach as the logger) ────── */
function extractBlock(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0, inStr = null, esc = false, com = 0;
  for (let j = open; j < src.length; j++) {
    const ch = src[j], nx = src[j + 1];
    if (com) { if (com === 1 && ch === '\n') com = 0; else if (com === 2 && ch === '*' && nx === '/') { com = 0; j++; } continue; }
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && nx === '/') { com = 1; j++; continue; }
    if (ch === '/' && nx === '*') { com = 2; j++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced block');
}
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const fn = (n) => extractBlock(html, html.indexOf('function ' + n + '('));
const blockConst = (n) => extractBlock(html, html.indexOf('const ' + n + '=')) + ';';
const lineConst = (n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); };

const M = new Function('const MEM={};\n' + [
  blockConst('PLSIM'), blockConst('PLSIM_ALIAS'),
  (html.match(/const PLSIM_PROMOTED=\[[\d.,]+\];/) || [''])[0],
  lineConst('ELO_SCALE'), lineConst('ELO_ATT'), lineConst('ELO_DEF'), lineConst('ELO_CLAMP'),
  fn('eloMean'), fn('eloPrior'), fn('plsimPrior'),
  fn('poisson'), fn('plsimMatch'), fn('recencyWeight'), fn('availAttackMult'), fn('plsimRatings'),
  fn('fdrDefence'), fn('fdrAttack'),
  lineConst('ROT_SWITCH'), fn('rotationChain'),
].join('\n') + '\nreturn {plsimRatings,plsimMatch,fdrDefence,fdrAttack,rotationChain};')();

/* ── data ──────────────────────────────────────────────────────────────── */
const boot = await get('bootstrap-static/');
const fixtures = await get('fixtures/');
const teams = {};
boot.teams.forEach((t) => { teams[t.id] = t; });
const b = { raw: boot, teams, els: {}, elements: boot.elements, events: boot.events };
boot.elements.forEach((e) => { b.els[e.id] = e; });

const upcoming = boot.events.find((e) => !e.finished) || boot.events[0];
const startGw = upcoming ? upcoming.id : 1;
const gws = [];
for (let g = startGw; g < startGw + WEEKS && g <= 38; g++) gws.push(g);

const R = M.plsimRatings(b, fixtures);
/* Defenders and keepers rotate on clean-sheet difficulty; outfield attackers
   on attacking difficulty — the same two lenses the planner uses. */
const attacking = POS >= 3;
const diff = {}, opp = {};
fixtures.forEach((f) => {
  if (!f.event || f.finished) return;
  const gi = gws.indexOf(f.event);
  if (gi < 0) return;
  const m = M.plsimMatch(R, f.team_h, f.team_a);
  if (!m) return;
  [[f.team_h, attacking ? m.hx : m.csH, f.team_a, true],
    [f.team_a, attacking ? m.ax : m.csA, f.team_h, false]].forEach(([t, v, o, home]) => {
    (diff[t] = diff[t] || new Array(gws.length).fill(5))[gi] = attacking ? M.fdrAttack(v) : M.fdrDefence(v);
    (opp[t] = opp[t] || new Array(gws.length).fill(null))[gi] = { short: teams[o].short_name, home };
  });
});

const cands = boot.elements
  .filter((e) => e.status === 'a' && e.element_type === POS && (e.now_cost || 0) <= MAXCOST)
  .map((e) => ({ id: e.id, team: e.team, name: e.web_name, cost: e.now_cost, code: e.code }));
if (!cands.length) { console.error('No candidates under ' + MAXCOST); process.exit(1); }

const chain = M.rotationChain(cands, diff);
if (!chain) { console.error('No chain could be solved (too few clubs or gameweeks).'); process.exit(1); }

const out = {
  kind: 'rotation',
  gw: startGw,
  season: (boot.events[0] || {}).deadline_time ? new Date(boot.events[0].deadline_time).getUTCFullYear() : null,
  posLabel: POSN[POS] || 'players',
  budget: (MAXCOST / 10).toFixed(1),
  gws,
  weeks: chain.n,
  green: chain.green,
  switches: chain.switches,
  solo: chain.switches === 0,
  /* The per-week plan the video animates: who is held, the fixture they play
     and how hard it is. */
  timeline: chain.path.map((t, i) => ({
    gw: gws[i], team: teams[t].short_name, diff: diff[t][i],
    opp: opp[t] && opp[t][i] ? opp[t][i].short : null,
    home: opp[t] && opp[t][i] ? opp[t][i].home : null,
    change: i > 0 && chain.path[i - 1] !== t,
  })),
  blocks: chain.blocks.map((bk) => ({
    from: gws[bk.from], to: gws[bk.to], weeks: bk.weeks,
    team: teams[bk.team].short_name, teamName: teams[bk.team].name,
    name: bk.player.name, cost: (bk.player.cost / 10).toFixed(1), code: bk.player.code,
  })),
};
writeFileSync(join(HERE, 'rotation.json'), JSON.stringify(out, null, 1));
const f = process.env.GITHUB_OUTPUT;
if (f) appendFileSync(f, `gw=${startGw}\nswitches=${chain.switches}\n`);
console.log(`rotation.json — GW${gws[0]}–${gws[gws.length - 1]}, ${chain.blocks.length} block(s), ` +
  `${chain.switches} switch(es), ${chain.green}/${chain.n} green`);
