/*
 * Build the dataset for any video in the series.
 *
 * Like log-predictions.js, the model is EXTRACTED from index.html at runtime
 * rather than reimplemented, so the plan in the video is the same plan the
 * app shows. A second copy of rotationChain here would drift within a month.
 *
 * Writes scripts/recap/{kind}.json.
 *
 * Run: node scripts/recap/fetch-video.mjs --kind rotation
 *      node scripts/recap/fetch-video.mjs --kind setpieces|oop|lean|chips
 *      node scripts/recap/fetch-video.mjs --kind rotation --pos 2 --max 50 --weeks 10
 *      node scripts/recap/fetch-video.mjs --kind lean --base http://127.0.0.1:8700/api/fpl
 *          (any FPL-shaped source — used to verify offline against the mock)
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('base', 'https://fantasy.premierleague.com/api');
const KIND = arg('kind', 'rotation');
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
/* Some names exist at top level AND shadowed inside a function; anchor to the
   line start so we lift the one the app's top-level code actually sees. */
const topConst = (n) => { const i = html.indexOf('\nconst ' + n + '=') + 1; return html.slice(i, html.indexOf('\n', i)); };

const M = new Function('const MEM={};\n' + [
  blockConst('PLSIM'), blockConst('PLSIM_ALIAS'),
  (html.match(/const PLSIM_PROMOTED=\[[\d.,]+\];/) || [''])[0],
  lineConst('ELO_SCALE'), lineConst('ELO_ATT'), lineConst('ELO_DEF'), lineConst('ELO_CLAMP'),
  fn('eloMean'), fn('eloPrior'), fn('plsimPrior'),
  fn('poisson'), fn('plsimMatch'), fn('recencyWeight'), fn('availAttackMult'), fn('plsimRatings'),
  fn('fdrDefence'), fn('fdrAttack'),
  lineConst('ROT_SWITCH'), fn('rotationChain'),
  lineConst('LEAN_EDGE'), fn('clubLean'),
  lineConst('OOP_MIN_MINUTES'), lineConst('OOP_PCTL'), lineConst('OOP_STRONG_PCTL'),
  lineConst('OOP_MID_PCTL'), lineConst('OOP_MID_STRONG_PCTL'),
  lineConst('OOP_LOW_PCTL'), lineConst('OOP_MIN_POOL'),
  fn('oopThreat'), fn('oopQuantile'), fn('oopBenchmarks'), fn('oopFlag'),
  lineConst('SP_DUTIES'), fn('setPieceByClub'), fn('setPieceClubRows'),
  lineConst('CHIP_HALF_END'), lineConst('MIN_CLUBS_FOR_XI'), lineConst('INTL_GAP_DAYS'),
  lineConst('WC_BREAK_BONUS'), lineConst('BREAK_BASE_DAYS'), lineConst('WC_BREAK_BONUS_LONG'),
  fn('breakSeverity'), fn('breakScale'),
  lineConst('WC_EARLY_PENALTY'), lineConst('BB_EARLY_PENALTY'), lineConst('TIE_FDR'),
  lineConst('CHIP_SEPARATION'), lineConst('CHIP_PROVISIONAL_FROM'), lineConst('WC_HORIZON_WEEKS'),
  fn('wcHorizonFactor'), lineConst('BB_RUNIN_PENALTY'),
  fn('captainEligible'), fn('intlBreakGws'), fn('chipHalfWindow'), fn('fdrGameweeks'),
  /* minClubsForXi derives the playable-week threshold from the live rules and
     falls back to RULES; the plan only needs the XI size and the club cap. */
  'const RULES_FALLBACK=' + JSON.stringify({ xiSize: 11, teamLimit: 3 }) + ';\nlet RULES=RULES_FALLBACK;',
  fn('minClubsForXi'), 'const teamShort=(b,t)=>((b.teams[t]||{}).short_name||String(t));',
  fn('chipPlanFdr'), topConst('CHIP_LABEL'),
].join('\n') + '\nreturn {plsimRatings,plsimMatch,fdrDefence,fdrAttack,rotationChain,' +
  'clubLean,oopBenchmarks,oopFlag,setPieceClubRows,chipPlanFdr,CHIP_LABEL};')();


/* ── data ──────────────────────────────────────────────────────────────── */
const boot = await get('bootstrap-static/');
const fixtures = await get('fixtures/');
const teams = {};
boot.teams.forEach((t) => { teams[t.id] = t; });
const b = { raw: boot, teams, els: {}, elements: boot.elements, events: boot.events };
boot.elements.forEach((e) => { b.els[e.id] = e; });
const upcoming = boot.events.find((e) => !e.finished) || boot.events[0];
b.upcoming = upcoming; b.cur = boot.events.find((e) => e.is_current) || upcoming;
const startGw = upcoming ? upcoming.id : 1;
const short = (t) => (teams[t] || {}).short_name || String(t);
const money = (c) => (c / 10).toFixed(1);

const BUILD = {};

/* ── the exactly-solved budget rotation ── */
BUILD.rotation = () => {
  const gws = [];
  for (let g = startGw; g < startGw + WEEKS && g <= 38; g++) gws.push(g);
  const R = M.plsimRatings(b, fixtures);
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
      (opp[t] = opp[t] || new Array(gws.length).fill(null))[gi] = { short: short(o), home };
    });
  });
  const cands = boot.elements
    .filter((e) => e.status === 'a' && e.element_type === POS && (e.now_cost || 0) <= MAXCOST)
    .map((e) => ({ id: e.id, team: e.team, name: e.web_name, cost: e.now_cost }));
  if (!cands.length) throw new Error('no candidates under ' + MAXCOST);
  const chain = M.rotationChain(cands, diff);
  if (!chain) throw new Error('no chain could be solved');
  return {
    kind: 'rotation', gw: startGw, posLabel: POSN[POS] || 'players', budget: money(MAXCOST),
    gws, weeks: chain.n, green: chain.green, switches: chain.switches, solo: chain.switches === 0,
    timeline: chain.path.map((t, i) => ({
      gw: gws[i], team: short(t), diff: diff[t][i],
      opp: opp[t] && opp[t][i] ? opp[t][i].short : null,
      home: opp[t] && opp[t][i] ? opp[t][i].home : null,
      change: i > 0 && chain.path[i - 1] !== t })),
    blocks: chain.blocks.map((bk) => ({
      from: gws[bk.from], to: gws[bk.to], weeks: bk.weeks,
      team: short(bk.team), teamName: teams[bk.team].name,
      name: bk.player.name, cost: money(bk.player.cost) })),
  };
};

/* ── who takes what, club by club ── */
BUILD.setpieces = () => {
  const rows = M.setPieceClubRows(b, 3);
  if (rows.length < 6) throw new Error('too few clubs with a set-piece order (' + rows.length + ')');
  const nm = (l) => l.map((x) => x.el.web_name);
  const clubs = rows.map((c) => ({ team: short(c.team), teamName: (teams[c.team] || {}).name,
    pen: nm(c.pen), fk: nm(c.fk), ck: nm(c.ck) }));
  return { kind: 'setpieces', gw: startGw, clubs,
    /* Penalties are the duty worth its own scene — the others are context. */
    pens: clubs.filter((c) => c.pen.length).slice(0, 8).map((c) => ({ team: c.team, name: c.pen[0], deputy: c.pen[1] || null })),
    settled: clubs.filter((c) => c.pen.length).length,
    contested: clubs.filter((c) => c.pen.length > 1).length,
    total: rows.length };
};

/* ── paid on the wrong tariff ── */
BUILD.oop = () => {
  const marks = M.oopBenchmarks(boot.elements);
  if (!Object.keys(marks).length) throw new Error('no positional benchmarks yet — needs a season under way');
  const rows = boot.elements.map((e) => ({ e, f: M.oopFlag(e, marks) }))
    .filter((r) => r.f && r.f.level >= 2 && r.e.status === 'a')
    .sort((a, c) => c.f.threat / c.f.bench - a.f.threat / a.f.bench).slice(0, 6);
  if (rows.length < 3) throw new Error('too few clearly out-of-position players (' + rows.length + ')');
  return { kind: 'oop', gw: startGw,
    players: rows.map((r) => ({ name: r.e.web_name, team: short(r.e.team), cost: money(r.e.now_cost),
      label: r.f.label, threat: r.f.threat.toFixed(2), bench: r.f.bench.toFixed(2),
      pos: POSN[r.e.element_type], owned: r.e.selected_by_percent })) };
};

/* ── which end of each club to buy ── */
BUILD.lean = () => {
  const R = M.plsimRatings(b, fixtures);
  const rows = boot.teams.map((t) => ({ t: t.id, lean: M.clubLean(R, t.id) })).filter((r) => r.lean)
    .map((r) => Object.assign({ gap: r.lean.attPct - r.lean.defPct }, r))
    .sort((a, c) => c.gap - a.gap);
  if (rows.length < 10) throw new Error('too few rated clubs (' + rows.length + ')');
  const one = (r) => ({ team: short(r.t), teamName: (teams[r.t] || {}).name,
    att: Math.round(r.lean.attPct * 100), def: Math.round(r.lean.defPct * 100),
    lean: r.lean.lean, grade: r.lean.grade });
  return { kind: 'lean', gw: startGw,
    attack: rows.slice(0, 5).map(one), defence: rows.slice(-5).reverse().map(one),
    both: rows.filter((r) => r.lean.grade === 'both').map(one).slice(0, 4),
    n: rows.length };
};

/* ── the chip plan for the half ── */
BUILD.chips = () => {
  const plan = M.chipPlanFdr(b, fixtures);
  if (!plan || !plan.picks) throw new Error('no chip plan could be built');
  const order = ['wildcard', 'benchboost', 'triplecaptain', 'freehit'];
  const picks = order.filter((k) => plan.picks[k]).map((k) => {
    const p = plan.picks[k];
    return { key: k, label: M.CHIP_LABEL[k], gw: p.gw,
      provisional: !!p.provisional, afterBreak: p.afterBreak || 0,
      why: p.double ? p.double + ' clubs double' : p.blank ? p.blank + ' clubs blank'
        : p.turning ? p.turning + ' clubs swing'
          /* fdrGameweeks carries `opp` as a raw team id — the app maps it at
             render time, so this has to as well. */
          : p.el ? 'vs ' + short(p.opp) + (p.home ? ' (H)' : ' (A)') : 'best week in the window',
      captain: p.el ? p.el.web_name : null };
  });
  if (picks.length < 2) throw new Error('too few chips placed (' + picks.length + ')');
  return { kind: 'chips', gw: startGw,
    from: plan.window.from, to: plan.window.to, half: plan.window.half,
    picks, spread: Math.max.apply(null, picks.map((p) => p.gw)) - Math.min.apply(null, picks.map((p) => p.gw)) };
};

if (!BUILD[KIND]) { console.error('Unknown --kind ' + KIND + '. Try: ' + Object.keys(BUILD).join(', ')); process.exit(1); }
let out;
try { out = BUILD[KIND](); }
catch (e) {
  /* A video with no data is not a failure to hide — it is the honest answer
     that this subject has nothing to say yet (pre-season, mostly). */
  console.error(`Cannot build "${KIND}": ${e.message}`);
  const f0 = process.env.GITHUB_OUTPUT;
  if (f0) appendFileSync(f0, 'skip=true\n');
  process.exit(2);
}
writeFileSync(join(HERE, KIND + '.json'), JSON.stringify(out, null, 1));
const f = process.env.GITHUB_OUTPUT;
if (f) appendFileSync(f, `gw=${startGw}\nskip=false\n`);
console.log(`${KIND}.json written — GW${startGw}`);
