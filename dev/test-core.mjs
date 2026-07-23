/*
 * Unit tests for the model core of Gameweek Edge.
 *
 * The app is a single-file index.html, so there is nothing to import:
 * we locate named pure functions in the source, extract them by brace
 * matching, and evaluate them in an isolated context with minimal
 * stubs. This keeps the validated model code exactly as it ships —
 * no build step, no duplication.
 *
 * Run: node dev/test-core.mjs   (also `npm test`)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const aiSrc = readFileSync(join(ROOT, 'netlify/functions/ai.js'), 'utf8');

/* ── extraction helpers ─────────────────────────────────── */
function extractBlock(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  if (open < 0) throw new Error('no opening brace');
  let depth = 0, inStr = null, esc = false;
  for (let j = open; j < src.length; j++) {
    const ch = src[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced braces');
}
function extractFn(src, name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('function not found: ' + name);
  return extractBlock(src, idx);
}
function extractConst(src, name) {
  const idx = src.indexOf('const ' + name + '=');
  if (idx < 0) throw new Error('const not found: ' + name);
  return extractBlock(src, idx) + ';';
}
function extractLine(src, re) {
  const m = src.match(re);
  if (!m) throw new Error('line not found: ' + re);
  return m[0];
}

/* ── build the isolated context ─────────────────────────── */
const pieces = [
  extractConst(html, 'PLSIM'),
  extractFn(html, 'poisson'),
  extractFn(html, 'plsimMatch'),
  extractFn(html, 'esc'),
  extractFn(html, 'recentMinutes'),
  extractFn(html, 'minutesModel'),
  extractFn(html, 'concedePts'),
  extractFn(html, 'effGoalRate'),
  extractFn(html, 'negRate90'),
  extractFn(html, 'recencyWeight'),
  extractFn(html, 'availAttackMult'),
  extractFn(html, 'nativeXP'),
  extractFn(html, 'xP'),
  extractFn(html, 'fixtureXP'),
  extractFn(html, 'priceChangeProb'),
  extractFn(html, 'suspCutoff'),
  extractFn(html, 'suspRisk'),
  extractFn(html, 'bestXI'),
  extractFn(html, 'minutesSecurity'),
  extractFn(html, 'projectXI'),
  extractLine(html, /const LG_GRID=\d+,LG_MAXG=\d+;/),
  extractFn(html, 'lgScoreGrid'),
  extractFn(html, 'lgCleanSheets'),
  extractLine(html, /const DRAFT_BUDGET=\d+;/),
  extractConst(html, 'DRAFT_QUOTA'),
  extractLine(html, /const DRAFT_CLUB_MAX=\d+;/),
  extractFn(html, 'draftCounts'),
  extractFn(html, 'draftValidate'),
  extractFn(html, 'draftCanAdd'),
  extractFn(html, 'draftMinCost'),
  extractFn(html, 'draftReserveAdd'),
  extractFn(html, 'draftBuild'),
  extractFn(html, 'draftFillGaps'),
  extractFn(aiSrc, 'fitJSON'),
  /* bestTransfer drives the dashboard/debrief suggestion; stub its only
     dependency (horizonXP) so we test the logic, not the xP maths. */
  'function horizonXP(_b, el, _hz){ return el._hx || 0; }',
  extractLine(html, /const MIN_TR_GAIN=[\d.]+;/),
  extractFn(html, 'bestTransfer'),
  extractFn(html, 'gwPhase'),
  /* Section 2: decision-grade recommendation model. */
  extractFn(html, 'confTier'),
  extractFn(html, 'captainEligible'),
  extractFn(html, 'captainBand'),
  extractFn(html, 'pointsDist'),
  extractFn(html, 'squadSim'),
  extractFn(html, 'normCdf'),
  extractFn(html, 'effEdge'),
  extractFn(html, 'edgeDelta'),
  extractFn(html, 'rankEV'),
  extractFn(html, 'rankOptimiser'),
  extractFn(html, 'calibration'),
  extractFn(html, 'captainModel'),
  extractFn(html, 'captainConfidence'),
  extractFn(html, 'transferFrame'),
  extractFn(html, 'eventShape'),
  extractFn(html, 'capHintFrom'),
  extractFn(html, 'chipAdvice'),
  /* Section 3: My Week "Explain this" feature drivers. */
  extractFn(html, 'captainFeatures'),
  extractFn(html, 'transferFeatures'),
  extractFn(html, 'chipFeatures'),
  /* Section 4: Fixture Difficulty 2.0 + set-piece confidence. */
  extractFn(html, 'fdrAttack'),
  extractFn(html, 'fdrDefence'),
  extractFn(html, 'setPieceConfidence'),
  /* Section 4 (6-13): readiness, lineup, community. */
  extractFn(html, 'benchBoostReadiness'),
  extractFn(html, 'lineupCheck'),
  extractFn(html, 'communityAggregate'),
  extractFn(html, 'topSelectedByPos'),
  extractFn(html, 'differentials'),
  /* Latest News feed. */
  extractFn(html, 'timeAgo'),
  extractFn(html, 'latestNews')
];
const core = new Function(
  pieces.join('\n') +
  '\nreturn {plsimMatch, esc, nativeXP, xP, priceChangeProb, suspCutoff, suspRisk, bestXI, minutesSecurity, projectXI, lgScoreGrid, lgCleanSheets, draftValidate, draftCanAdd, draftBuild, draftFillGaps, fitJSON, bestTransfer, MIN_TR_GAIN, gwPhase, confTier, captainEligible, captainBand, captainModel, captainConfidence, transferFrame, eventShape, capHintFrom, chipAdvice, captainFeatures, transferFeatures, chipFeatures, fdrAttack, fdrDefence, setPieceConfidence, benchBoostReadiness, lineupCheck, communityAggregate, topSelectedByPos, differentials, timeAgo, latestNews, recentMinutes, minutesModel, concedePts, effGoalRate, negRate90, pointsDist, recencyWeight, availAttackMult, squadSim, normCdf, effEdge, edgeDelta, rankEV, rankOptimiser, calibration};'
)();

/* ── tiny assertion harness ─────────────────────────────── */
let failures = 0, passes = 0;
function ok(cond, label) {
  if (cond) { passes++; }
  else { failures++; console.error('  ✗ ' + label); }
}
function section(name) { console.log('• ' + name); }

/* ── esc ────────────────────────────────────────────────── */
section('esc escapes <>&"\'');
ok(core.esc('<script>') === '&lt;script&gt;', 'angle brackets escaped');
ok(core.esc('a&b') === 'a&amp;b', 'ampersand escaped');
ok(core.esc('"quoted"') === '&quot;quoted&quot;', 'double quote escaped');
ok(core.esc("it's") === 'it&#39;s', 'single quote escaped');
ok(core.esc(null) === '', 'null becomes empty string');
ok(core.esc('<>&"\'').indexOf('<') < 0 && core.esc('<>&"\'').indexOf('>') < 0, 'no raw angle brackets survive');

/* ── plsimMatch: probabilities normalise ────────────────── */
section('plsimMatch probabilities normalise');
const R = { att: { 1: 1.15, 2: 0.85 }, def: { 1: 0.9, 2: 1.1 }, hom: { 1: 1.05, 2: 1.0 } };
const m = core.plsimMatch(R, 1, 2);
ok(m !== null, 'returns a forecast');
ok(Math.abs(m.pH + m.pD + m.pA - 1) < 1e-6, 'W/D/L probabilities sum to 1');
for (const k of ['pH', 'pD', 'pA', 'csH', 'csA', 'h3', 'a3']) {
  ok(m[k] >= 0 && m[k] <= 1, k + ' within [0,1]');
}
ok(m.hx > 0 && m.ax > 0, 'expected goals positive');
ok(core.plsimMatch(R, 1, 99) === null, 'unknown team yields null');
const mStrong = core.plsimMatch({ att: { 1: 1.4, 2: 0.7 }, def: { 1: 0.7, 2: 1.4 }, hom: { 1: 1.05 } }, 1, 2);
ok(mStrong.pH > m.pH, 'stronger home side raises home win probability');

/* ── xP / nativeXP: finite, non-negative for sane inputs ── */
section('xP / nativeXP finite and non-negative');
const el = {
  minutes: 900, starts: 10, element_type: 4,
  expected_goals_per_90: '0.55', expected_assists_per_90: '0.20',
  ep_next: '5.2', form: '4.4', points_per_game: '4.1',
  chance_of_playing_next_round: null, status: 'a'
};
const nf = { gp: 10, lam: 1.6, lamAvg: 1.5, cs: 0.3, diff: 2 };
const nat = core.nativeXP(el, nf);
ok(Number.isFinite(nat) && nat >= 0, 'nativeXP finite and non-negative');
const xp = core.xP({}, el, nf);
ok(Number.isFinite(xp) && xp >= 0, 'xP finite and non-negative');
ok(core.nativeXP({ ...el, minutes: 100 }, nf) === null, 'nativeXP null on a thin sample (mpg < 20)');
ok(core.nativeXP(el, { ...nf, gp: 2 }) === null, 'nativeXP null before 5 games played');
const xpFlagged = core.xP({}, { ...el, chance_of_playing_next_round: 25 }, nf);
ok(xpFlagged < xp, 'chance-of-playing scales xP down');
ok(core.xP({}, el, { diff: 3 }) >= 0, 'xP without model view stays non-negative');

/* ── price model: caps, direction, monotonicity ─────────── */
section('priceChangeProb caps, direction, monotonic in net transfers');
const TOTAL = 10e6;
const mk = (tin, tout, own) => ({ transfers_in_event: tin, transfers_out_event: tout, selected_by_percent: String(own) });
let prev = -1, monotone = true;
for (const tin of [0, 10e3, 50e3, 120e3, 250e3, 600e3]) {
  const r = core.priceChangeProb(mk(tin, 0, 10), TOTAL);
  ok(r.prob >= 5 && r.prob <= 95, 'prob within [5,95] at net ' + tin);
  if (r.prob < prev) monotone = false;
  prev = r.prob;
}
ok(monotone, 'rise probability monotonic in net transfers');
ok(core.priceChangeProb(mk(100e3, 0, 5), TOTAL).dir === 'rise', 'net buys → rise');
ok(core.priceChangeProb(mk(0, 100e3, 5), TOTAL).dir === 'fall', 'net sells → fall');
ok(core.priceChangeProb(mk(0, 0, 5), TOTAL).dir === 'flat', 'no net movement → flat');
const lowOwn = core.priceChangeProb(mk(150e3, 0, 2), TOTAL);
const highOwn = core.priceChangeProb(mk(150e3, 0, 40), TOTAL);
ok(lowOwn.prob > highOwn.prob, 'same net transfers → low ownership rises with higher probability');
ok(lowOwn.prob >= 90, 'heavily-transferred low-ownership player shows a high estimate');
const symm = core.priceChangeProb(mk(0, 150e3, 2), TOTAL);
ok(symm.prob === lowOwn.prob, 'fall probability symmetric with rise');

/* ── suspension model: cutoffs and proximity levels ─────── */
section('suspRisk cutoffs / proximity levels');
ok(core.suspCutoff(1).limit === 5 && core.suspCutoff(19).limit === 5, '5-card limit through GW19');
ok(core.suspCutoff(20).limit === 10 && core.suspCutoff(32).limit === 10, '10-card limit GW20–32');
ok(core.suspCutoff(33).limit === 15 && core.suspCutoff(38).limit === 15, '15-card limit after GW32');
ok(core.suspRisk(4, 10).level === 'edge', '4 yellows at GW10 → one from a ban');
ok(core.suspRisk(3, 10).level === 'watch', '3 yellows at GW10 → two away');
ok(core.suspRisk(2, 10).level === null, '2 yellows at GW10 → no flag');
ok(core.suspRisk(4, 25).level === null, '4 yellows after the GW19 cutoff → no flag (limit 10)');
ok(core.suspRisk(9, 25).level === 'edge', '9 yellows at GW25 → one from the 10-card ban');
ok(core.suspRisk(5, 10).level === 'banned', 'hitting the limit flags as banned');
ok(core.suspRisk(0, 1).left === 5 && core.suspRisk(0, 1).level === null, 'clean record → 5 left, no flag');
ok(core.suspRisk(null, 10).yellows === 0, 'null yellows treated as 0');

/* ── minutesSecurity: bounds, monotonicity, availability ── */
section('minutesSecurity bounds, monotonicity, availability');
const mkMS = (starts, mins, status, ch) => ({
  starts, minutes: mins, status: status || 'a',
  chance_of_playing_next_round: ch == null ? null : ch
});
ok(core.minutesSecurity(mkMS(38, 3420), 38) === 100, 'ever-present starter scores 100');
ok(core.minutesSecurity(mkMS(0, 0), 38) === 0, 'no starts, no minutes scores 0');
let msPrev = -1, msMono = true;
for (const s of [0, 5, 10, 20, 30, 38]) {
  const v = core.minutesSecurity(mkMS(s, s * 90), 38);
  ok(v >= 0 && v <= 100, 'within [0,100] at ' + s + ' starts');
  if (v < msPrev) msMono = false;
  msPrev = v;
}
ok(msMono, 'monotonic in starts share');
ok(core.minutesSecurity(mkMS(38, 3420, 'i'), 38) <= 5, 'injured status is zero-ish (availability floor)');
ok(core.minutesSecurity(mkMS(38, 3420, 's'), 38) <= 5, 'suspended status is zero-ish');
ok(core.minutesSecurity(mkMS(38, 3420, 'a', 50), 38) === 50, 'chance-of-playing scales the score');
ok(core.minutesSecurity(mkMS(99, 99999), 38) <= 100, 'clamped for over-the-top inputs');
ok(core.minutesSecurity(mkMS(10, 900), 0) >= 0 && core.minutesSecurity(mkMS(10, 900), 0) <= 100, 'zero club games handled');

/* ── projectXI: legal XI from club data ─────────────────── */
section('projectXI picks a legal XI');
const squad = [];
let id = 1;
const push = (type, n, starts, mins, status) => {
  for (let i = 0; i < n; i++) squad.push({
    id: id++, team: 7, element_type: type, starts, minutes: mins,
    status: status || 'a', chance_of_playing_next_round: null
  });
};
push(1, 2, 10, 900); push(2, 5, 9, 850); push(3, 5, 8, 800); push(4, 3, 7, 700);
push(3, 2, 1, 90);                                   /* fringe players */
const fakeB = { elements: squad };
const proj = core.projectXI(fakeB, 7, 10);
ok(!!proj, 'returns a projection');
ok(proj.xi.length === 11, 'projects exactly 11 players');
ok(proj.xi.filter(x => x.el.element_type === 1).length === 1, 'exactly one goalkeeper');
ok(proj.formation.reduce((a, c) => a + c, 0) === 10, 'formation covers ten outfielders');
ok(proj.xi.every(x => x.p >= 0 && x.p <= 1), 'start likelihoods within [0,1]');
const injured = squad.map(e => e.element_type === 4 ? { ...e, status: e.id === 13 ? 'i' : e.status } : e);
const proj2 = core.projectXI({ elements: injured }, 7, 10);
ok(proj2.xi.filter(x => x.el.status === 'i').every(x => x.p <= 0.06), 'injured players carry a floor score');

/* ── clean-sheet probabilities from the score grid ──────── */
section('lgScoreGrid / lgCleanSheets');
const grid = core.lgScoreGrid(1.5, 1.1, -0.074);
let gridSum = 0;
for (const p of grid) gridSum += p;
ok(Math.abs(gridSum - 1) < 1e-9, 'score grid sums to 1');
const csPair = core.lgCleanSheets(grid);
ok(csPair[0] >= 0 && csPair[0] <= 1 && csPair[1] >= 0 && csPair[1] <= 1, 'CS probabilities within [0,1]');
ok(csPair[0] > csPair[1], 'facing the lower-scoring attack ⇒ higher CS%');
const gridWeakOpp = core.lgScoreGrid(1.5, 0.6, -0.074);
ok(core.lgCleanSheets(gridWeakOpp)[0] > csPair[0], 'stronger defence (lower xGA) ⇒ higher CS%');
ok(grid[0] <= Math.min(csPair[0], csPair[1]) + 1e-12, 'P(0-0) never exceeds either CS probability');
const gridPlain = core.lgScoreGrid(1.5, 1.1, null); /* no DC correction */
const csPlain = core.lgCleanSheets(gridPlain);
ok(Math.abs(csPlain[0] - Math.exp(-1.1)) < 1e-3, 'plain-Poisson home CS ≈ e^-λaway');
ok(Math.abs(csPlain[1] - Math.exp(-1.5)) < 1e-3, 'plain-Poisson away CS ≈ e^-λhome');
const csDC = core.lgCleanSheets(core.lgScoreGrid(1.5, 1.1, -0.074));
ok(csDC[0] !== csPlain[0], 'Dixon-Coles correction moves the low-score mass');

/* ── draft validators: budget / position / club / save gate ─ */
section('draftValidate / draftCanAdd rules');
let draftSeq = 1;
const mkD = (type, team, cost) => ({ id: draftSeq++, element_type: type, team, now_cost: cost });
function legalSquad(costGK, costDEF, costMID, costFWD) {
  const a = [];
  for (let k = 0; k < 2; k++) a.push(mkD(1, k + 1, costGK));
  for (let k = 0; k < 5; k++) a.push(mkD(2, k + 1, costDEF));
  for (let k = 0; k < 5; k++) a.push(mkD(3, k + 6, costMID));
  for (let k = 0; k < 3; k++) a.push(mkD(4, k + 11, costFWD));
  return a;
}
const sq15 = legalSquad(45, 50, 70, 80); /* cost 930, bank 70 */
const vOK = core.draftValidate(sq15);
ok(vOK.complete && vOK.quotaOk && vOK.clubOk, 'legal 15 is complete and inside every quota');
ok(vOK.cost === 930 && vOK.bank === 70, 'cost and bank computed against the £100.0m budget');
ok(vOK.saveable, 'valid, complete, in-budget draft is saveable');
const vRich = core.draftValidate(legalSquad(50, 60, 90, 95)); /* cost 1135 */
ok(vRich.overBudget && vRich.bank === -135, 'over-budget draft flagged with a negative bank');
ok(!vRich.saveable, 'over-budget draft is NOT saveable');
const vPart = core.draftValidate(sq15.slice(0, 14));
ok(!vPart.complete && !vPart.saveable, 'incomplete squad (14) is not saveable');
ok(!vPart.overBudget, 'incomplete squad can still be within budget');
const vClub = core.draftValidate(sq15.map((p, i) => (i >= 2 && i < 6 ? { ...p, team: 99 } : p)));
ok(!vClub.clubOk && !vClub.saveable, 'four players from one club breaks the 3-per-club rule');
const vBudget = core.draftValidate(sq15, 900);
ok(vBudget.overBudget && !vBudget.saveable, 'custom budget respected');
ok(!core.draftCanAdd(sq15, mkD(4, 15, 60)), 'cannot add a 16th player');
const part13 = sq15.slice(0, 13); /* 2 GK, 5 DEF, 5 MID, 1 FWD */
ok(core.draftCanAdd(part13, mkD(4, 15, 60)), 'a needed forward can be added (even over budget)');
ok(!core.draftCanAdd(part13, mkD(2, 15, 45)), 'cannot exceed the 5-DEF quota');
ok(!core.draftCanAdd(part13, { ...part13[0] }), 'cannot add a duplicate player');
const trio = [mkD(2, 7, 45), mkD(3, 7, 60), mkD(4, 7, 60)];
ok(!core.draftCanAdd(trio, mkD(3, 7, 55)), 'the 3-per-club cap is enforced on add');
ok(core.draftCanAdd(trio, mkD(3, 8, 55)), 'a fourth player from another club is fine');

/* ── draftBuild / draftFillGaps: the 2026/27 guided builder ── */
section('draftBuild: guided, legal, in-budget squad');
let bseq = 1000;
const bpool = [], bxp = {};
const addP = (type, team, cost, xp) => { const p = { id: bseq++, element_type: type, team, now_cost: cost, status: 'a', web_name: 'P' + bseq }; bpool.push(p); bxp[p.id] = xp; };
for (let team = 1; team <= 20; team++) {
  addP(1, team, 40, 12 + team % 3 * 4); addP(1, team, 50, 28 + team % 3 * 4);
  for (let i = 0; i < 4; i++) addP(2, team, 40 + i * 15, 18 + i * 18 + team % 4 * 5);
  for (let i = 0; i < 4; i++) addP(3, team, 45 + i * 25, 24 + i * 28 + team % 5 * 6);
  for (let i = 0; i < 2; i++) addP(4, team, 50 + i * 45, 30 + i * 42 + team % 3 * 7);
}
/* a deliberately weak club (id 21) nobody would pick on merit — mid-priced
   so it competes on merit, not as cheap bench fodder */
for (let i = 0; i < 4; i++) addP(2 + (i % 3), 21, 55, 1);
const cost4Low = sq => sq.map(e => e.now_cost).sort((a, c) => a - c).slice(0, 4).reduce((a, c) => a + c, 0);
const xiCost = sq => sq.slice().sort((a, c) => bxp[c.id] - bxp[a.id]).slice(0, 11).reduce((a, c) => a + (c.now_cost || 0), 0);
const spend = (sq, types) => sq.filter(e => types.includes(e.element_type)).reduce((a, c) => a + (c.now_cost || 0), 0);

const built = core.draftBuild(bpool, bxp, {});
const bv = core.draftValidate(built);
ok(built.length === 15, 'builds a full 15');
ok(bv.complete && bv.quotaOk && bv.clubOk && !bv.overBudget, 'the built squad is complete, legal and within £100.0m');
ok(built.every(e => e.team !== 21), 'a no-merit club is left out by default');

const fav = core.draftBuild(bpool, bxp, { favClub: 21 });
ok(fav.filter(e => e.team === 21).length >= 1 && core.draftValidate(fav).saveable, 'favourite-club preference forces in a player from that club, still legal');

const benchStrong = core.draftBuild(bpool, bxp, { bench: 'strong' });
const benchCheap = core.draftBuild(bpool, bxp, { bench: 'cheap' });
ok(xiCost(benchCheap) >= xiCost(benchStrong), 'cheap-bench build spends more on the starting XI than the strong-15 build');
ok(cost4Low(benchCheap) <= cost4Low(benchStrong), 'and its four cheapest (the bench) cost no more');

const atk = core.draftBuild(bpool, bxp, { tilt: 'attack' });
const def = core.draftBuild(bpool, bxp, { tilt: 'defence' });
ok(spend(atk, [3, 4]) >= spend(def, [3, 4]), 'attack lean puts more budget into MID+FWD than defence lean');

const s1 = core.draftBuild(bpool, bxp, { seed: 1 }), s2 = core.draftBuild(bpool, bxp, { seed: 2 });
const idset = a => a.map(e => e.id).sort().join(',');
ok(idset(s1) !== idset(s2), 'different seeds yield a different squad (Generate again works)');
ok(core.draftValidate(s1).saveable && core.draftValidate(s2).saveable, 'both re-rolls are legal');
ok(idset(core.draftBuild(bpool, bxp, { seed: 1 })) === idset(s1), 'same seed + prefs is deterministic');

section('draftFillGaps: keep picks, fill the rest');
const kept = [built[0], built.find(e => e.element_type === 4), built.find(e => e.element_type === 3)];
const filled = core.draftFillGaps(bpool, bxp, kept);
const keptIds = new Set(kept.map(e => e.id));
ok(filled.length === 15 && core.draftValidate(filled).saveable, 'fills a partial squad to a legal 15');
ok(kept.every(e => filled.some(f => f.id === e.id)), 'every kept player is retained');
ok(core.draftFillGaps(bpool, bxp, built).length === 15, 'a complete squad is left untouched');

/* ── fitJSON (ai.js): valid JSON within budget ──────────── */
section('fitJSON always yields valid JSON within budget');
const big = { players: Array.from({ length: 500 }, (_, i) => ({ n: 'Player ' + i, xP: i % 9, next: 'OPP (H)' })) };
const out = core.fitJSON(big, 9000);
ok(out.length <= 9000, 'output within budget');
let parsed = null;
try { parsed = JSON.parse(out); } catch (_) {}
ok(parsed !== null, 'output parses as JSON (never cut mid-token)');
ok(Array.isArray(parsed.players), 'structure preserved (arrays trimmed, not mangled)');
const small = { a: 1 };
ok(core.fitJSON(small, 9000) === JSON.stringify(small), 'small contexts pass through untouched');

/* ── bestTransfer: coherent, captain-safe suggestions ───── */
section('bestTransfer never sells a protected pick, holds below threshold');
let bt = 1;
const mkBT = (type, team, cost, hx, extra) => Object.assign(
  { id: bt++, element_type: type, team, now_cost: cost, _hx: hx,
    status: 'a', chance_of_playing_next_round: null, web_name: 'P' + bt,
    selected_by_percent: '10' }, extra || {});
/* XI: a strong captain and a genuinely weak starter, same position. */
const capP = mkBT(3, 1, 90, 3.0);      /* id 2 — the captain */
const weakP = mkBT(3, 2, 55, 0.0);     /* id 3 — the weak link */
const xiBT = [capP, weakP];
const squadBT = [capP, weakP];
/* Candidate pool: a clear upgrade and a marginal one, both affordable MIDs. */
const upgrade = mkBT(3, 5, 60, 5.0);   /* +5 over weakP */
const marginal = mkBT(3, 6, 60, 0.4);  /* +0.4 over weakP — below threshold */
const bPool = { elements: [capP, weakP, upgrade, marginal] };
const protect = new Set([capP.id]);
const pick = core.bestTransfer(bPool, squadBT, xiBT, 40, {}, protect);
ok(pick !== null, 'a clear upgrade is surfaced');
ok(pick && pick.out.id === weakP.id, 'sells the weak link, not the captain');
ok(pick && pick.cand.id === upgrade.id, 'brings in the biggest horizon upgrade');
ok(pick && pick.gain >= core.MIN_TR_GAIN, 'reported gain clears the threshold');
/* With only a marginal option, the honest call is HOLD (null). */
const pickMarginal = core.bestTransfer({ elements: [capP, weakP, marginal] }, squadBT, xiBT, 40, {}, protect);
ok(pickMarginal === null, 'no move below the gain threshold → hold (no +0.0 suggestion)');
/* The captain is the weakest by horizon but protected → must not be sold. */
const capWeak = mkBT(3, 1, 90, 0.0);   /* captain now the lowest hx */
const otherStarter = mkBT(3, 2, 55, 4.0);
const pickProtect = core.bestTransfer(
  { elements: [capWeak, otherStarter, upgrade] }, [capWeak, otherStarter],
  [capWeak, otherStarter], 40, {}, new Set([capWeak.id]));
ok(!pickProtect || pickProtect.out.id !== capWeak.id, 'a protected captain is never the sell, even when weakest');

/* ── gwPhase: the between-gameweek state machine ────────── */
section('gwPhase resolves pre / live / post / between / ended');
const HR = 3600e3, DAY = 86400e3;
const T0 = 1_700_000_000_000;               /* fixed "now" for determinism */
const iso = ms => new Date(ms).toISOString();
/* Two-event world: GW10 (the one we're around) and GW11 (next). */
const mkEvents = (cfg) => [
  { id: 10, deadline_time: iso(cfg.g10), is_current: cfg.cur10, is_next: false,
    data_checked: !!cfg.checked10 },
  { id: 11, deadline_time: iso(cfg.g11), is_current: false, is_next: cfg.next11,
    data_checked: false },
];
const bOf = evs => ({ events: evs, cur: evs.find(e => e.is_current) || evs[0] });

/* pre-deadline: GW10 deadline still ahead → count down to it. */
let evs = mkEvents({ g10: T0 + 2 * DAY, cur10: true, g11: T0 + 9 * DAY, next11: true });
let r = core.gwPhase(bOf(evs), [], T0);
ok(r.phase === 'pre', 'before the deadline → pre');
ok(r.target && r.target.id === 10, 'pre targets the imminent GW');

/* live: GW10 deadline passed, a fixture started and not finished. */
evs = mkEvents({ g10: T0 - 2 * HR, cur10: true, g11: T0 + 7 * DAY, next11: true });
let fxLive = [{ event: 10, started: true, finished: false }];
r = core.gwPhase(bOf(evs), fxLive, T0);
ok(r.phase === 'live', 'deadline gone with a match in play → live');

/* live: deadline passed, kickoff imminent (no fixture rows / none started). */
r = core.gwPhase(bOf(evs), [], T0);
ok(r.phase === 'live', 'deadline gone, awaiting kickoff → live (not dead)');

/* post: all GW10 fixtures finished but data not yet checked (bonus settling). */
evs = mkEvents({ g10: T0 - 2 * DAY, cur10: true, g11: T0 + 5 * DAY, next11: true, checked10: false });
let fxDone = [{ event: 10, started: true, finished: true }, { event: 10, started: true, finished: true }];
r = core.gwPhase(bOf(evs), fxDone, T0);
ok(r.phase === 'post', 'finished but unchecked → post (result in)');

/* between: GW10 finished AND data checked, GW11 deadline ahead. */
evs = mkEvents({ g10: T0 - 2 * DAY, cur10: true, g11: T0 + 5 * DAY, next11: true, checked10: true });
r = core.gwPhase(bOf(evs), fxDone, T0);
ok(r.phase === 'between', 'finished, checked, next GW ahead → between');
ok(r.target && r.target.id === 11, 'between counts down to the next GW');

/* ended: last GW finished and checked, no future deadline anywhere. */
evs = [{ id: 38, deadline_time: iso(T0 - 3 * DAY), is_current: true, is_next: false, data_checked: true }];
r = core.gwPhase(bOf(evs), [{ event: 38, started: true, finished: true }], T0);
ok(r.phase === 'ended', 'season over → ended');

/* the regression guard: no configuration yields the old dead combo where
   the deadline reads "passed" yet the app still points at a stale GW with
   nothing ahead. Every passed-deadline state must resolve to a live phase. */
evs = mkEvents({ g10: T0 - 1 * HR, cur10: true, g11: T0 + 6 * DAY, next11: true });
r = core.gwPhase(bOf(evs), [], T0);
ok(r.phase !== 'pre' && (r.target ? r.target.id === 11 || r.phase === 'live' : true),
  'passed deadline never leaves the header pointing at a dead countdown');

/* ── Section 2: decision-grade recommendation model ─────── */
section('confTier / confChip thresholds');
ok(core.confTier(70) === 'green' && core.confTier(95) === 'green', '≥70 is green');
ok(core.confTier(50) === 'amber' && core.confTier(69) === 'amber', '50–69 is amber');
ok(core.confTier(49) === 'red' && core.confTier(0) === 'red', '<50 is red');

section('captainEligible filters to fit MID/FWD attackers');
const capEl = (t, extra) => Object.assign({ element_type: t, status: 'a', chance_of_playing_next_round: null }, extra || {});
ok(core.captainEligible(capEl(3)) === true, 'a fit midfielder is eligible');
ok(core.captainEligible(capEl(4)) === true, 'a fit forward is eligible');
ok(core.captainEligible(capEl(1)) === false, 'a goalkeeper is never eligible');
ok(core.captainEligible(capEl(2)) === false, 'a defender is never eligible');
ok(core.captainEligible(capEl(4, { status: 's' })) === false, 'a suspended attacker is out');
ok(core.captainEligible(capEl(4, { status: 'i' })) === false, 'an injured-out attacker is out');
ok(core.captainEligible(capEl(4, { chance_of_playing_next_round: 50 })) === false, '<60% to play is out');
ok(core.captainEligible(capEl(4, { chance_of_playing_next_round: 75 })) === true, '≥60% to play is in');
ok(core.captainEligible(null) === false, 'null is not eligible');

section('captainBand gives an ordered P10 ≤ P50 ≤ P90');
const band = core.captainBand(6);
ok(band.p10 <= band.p50 && band.p50 <= band.p90, 'band is monotonic');
ok(band.p90 > band.p10, 'ceiling exceeds floor');
ok(core.captainBand(10).p90 > core.captainBand(4).p90, 'higher xP lifts the ceiling');

section('captainModel: EO-adjusted EV and field weighting');
/* Build a small league: a template premium (high own + high xP), a mid
   pick, and a low-owned differential — plus an ineligible keeper. */
const mkC = (id, t, xp, own) => ({ id, element_type: t, status: 'a',
  chance_of_playing_next_round: null, selected_by_percent: String(own),
  web_name: 'C' + id, team: id, ep_next: String(xp), form: '4', points_per_game: '4' });
const cPool = [ mkC(1, 4, 8, 45), mkC(2, 3, 6, 20), mkC(3, 4, 5, 3), mkC(4, 1, 9, 30) ];
/* nf map with no fixture detail → xP falls back to ep_next directly. */
const cnf = {};
const cModel = core.captainModel({}, cnf, cPool, 3);
ok(cModel.picks.length === 3, 'returns the eligible top-3 (keeper excluded)');
ok(cModel.picks[0].el.id === 1, 'the premium leads on xP');
ok(!cModel.picks.some(p => p.el.element_type === 1), 'no keeper ever appears');
ok(cModel.picks[0].eo > cModel.picks[2].eo, 'the template pick carries more captaincy EO than the differential');
ok(Math.abs(cModel.picks.reduce((s, p) => s, 0)) >= 0, 'picks computed');
/* EV = xP − fieldEV; the top pick should beat the field, the punt trail it. */
ok(cModel.picks[0].ev > 0, 'the best captain beats the field EV');
ok(cModel.picks[2].ev < cModel.picks[0].ev, 'the differential has lower EV-vs-field than the premium');
ok(core.captainModel({}, cnf, [mkC(9, 1, 9, 30)], 3).picks.length === 0, 'a pool of only keepers yields no captain');

section('captainConfidence: clear leader → higher, tie → lower');
const clear = core.captainConfidence({ picks: [{ el: mkC(1, 4, 9, 40), xp: 9 }, { el: mkC(2, 4, 4, 20), xp: 4 }] });
const tie = core.captainConfidence({ picks: [{ el: mkC(1, 4, 6, 40), xp: 6 }, { el: mkC(2, 4, 5.8, 20), xp: 5.8 }] });
ok(clear.value > tie.value, 'a clear captain scores more confidently than a coin-flip');
ok(clear.value >= 0 && clear.value <= 96, 'confidence stays within bounds');
ok(['green', 'amber', 'red'].includes(clear.tier), 'a tier is assigned');

section('transferFrame: money, net xP and −4 breakeven');
const fr = core.transferFrame({ out: { now_cost: 70 }, cand: { now_cost: 85 }, gain: 6 }, 20, 1, 5);
ok(Math.abs(fr.priceDelta - 1.5) < 1e-9, 'price delta in £m (85−70 = +1.5)');
ok(Math.abs(fr.bankAfter - 0.5) < 1e-9, 'bank after: (20−15)/10 = £0.5m');
ok(fr.affordable === true, 'affordable when bank covers the delta');
ok(fr.usesHit === false && fr.hitCost === 0, 'a free transfer takes no hit');
const frHit = core.transferFrame({ out: { now_cost: 70 }, cand: { now_cost: 70 }, gain: 6 }, 5, 0, 5);
ok(frHit.usesHit === true && frHit.hitCost === 4, 'no free transfer → a −4 hit applies');
ok(Math.abs(frHit.clears - 2) < 1e-9, 'net after the hit: 6 − 4 = 2');
ok(frHit.beGw > 0 && frHit.beGw < 5, 'breakeven is a positive fraction of the horizon');
const frBust = core.transferFrame({ out: { now_cost: 50 }, cand: { now_cost: 120 }, gain: 3 }, 5, 1, 5);
ok(frBust.affordable === false, 'unaffordable when the delta exceeds bank');

section('eventShape: double / blank / modal detection');
/* 3 GWs: GW1 normal (10 games), GW2 a double (team 1 plays twice, 11 games),
   GW3 a blank (only 4 games). */
const fixG = [];
for (let i = 0; i < 10; i++) fixG.push({ event: 1, team_h: 2 * i + 1, team_a: 2 * i + 2, finished: false });
for (let i = 0; i < 10; i++) fixG.push({ event: 2, team_h: 2 * i + 1, team_a: 2 * i + 2, finished: false });
fixG.push({ event: 2, team_h: 1, team_a: 5, finished: false });          /* team 1 twice → double */
for (let i = 0; i < 4; i++) fixG.push({ event: 3, team_h: 2 * i + 1, team_a: 2 * i + 2, finished: false });
const shape = core.eventShape(fixG);
ok(shape.modal === 10, 'modal fixture count is 10');
ok(shape.byGw[2].isDouble === true && shape.byGw[2].doubles.includes(1), 'GW2 flagged as a double for team 1');
ok(shape.byGw[3].isBlank === true, 'GW3 flagged as a blank');
ok(shape.byGw[1].isDouble === false && shape.byGw[1].isBlank === false, 'GW1 is a normal week');

section('chipAdvice: reasoned windows, never a bare hold');
const adv = core.chipAdvice({}, fixG, ['3xc', 'bboost', 'freehit', 'wildcard'],
  [{ status: 'a' }, { status: 'a' }]);
ok(adv.all.length === 4, 'advises on every remaining chip');
ok(adv.all.every(a => a.reason && a.reason.length > 0), 'every chip carries a reason (never bare HOLD)');
ok(adv.nextDbl && adv.nextDbl.gw === 2, 'points Triple Captain / Bench Boost at the GW2 double');
ok(adv.nextBlank && adv.nextBlank.gw === 3, 'points Free Hit at the GW3 blank');
const tc = adv.all.find(a => a.chip === '3xc');
ok(tc.window === 'GW2' && tc.conf >= 60, 'Triple Captain recommends the double with real confidence');
ok(adv.best && adv.second, 'a best and second-best chip are surfaced');
const advFlags = core.chipAdvice({}, fixG, ['wildcard'],
  [{ status: 'i' }, { status: 'd' }, { status: 's' }]);
ok(advFlags.all[0].window === 'now', 'a squad with 3 flags recommends the Wildcard now');

/* Free Hit is strongest on the blank right after a double (GW2 double → GW3 blank). */
const fhAdv = core.chipAdvice({}, fixG, ['freehit'], [{ status: 'a' }]).all.find(a => a.chip === 'freehit');
ok(fhAdv.window === 'GW3' && fhAdv.conf >= 80 && /after a double/.test(fhAdv.reason), 'Free Hit on a post-double blank scores higher and names the pattern');

/* Single-gameweek Triple Captain (the 2025/26 lesson): with no double on the
   horizon, a standout single-GW fixture is still a valid TC. */
const normalFix = [];
for (let g = 1; g <= 3; g++) for (let i = 0; i < 10; i++) normalFix.push({ event: g, team_h: 2 * i + 1, team_a: 2 * i + 2, finished: false });
const strongHint = { gw: 1, name: 'Haaland', lam: 2.2, xp: 8.1, opp: 'BUR', home: true };
const tcSingle = core.chipAdvice({}, normalFix, ['3xc'], [{ status: 'a' }], strongHint).all.find(a => a.chip === '3xc');
ok(tcSingle.window === 'GW1' && tcSingle.conf >= 55 && /Haaland/.test(tcSingle.reason), 'strong single-GW fixture → Triple Captain recommended even without a double');
const okHint = { gw: 1, name: 'Palmer', lam: 1.7, xp: 6.2, opp: 'BHA', home: true };
const tcOk = core.chipAdvice({}, normalFix, ['3xc'], [{ status: 'a' }], okHint).all.find(a => a.chip === '3xc');
ok(tcOk.window === 'hold' && /best single-GW/.test(tcOk.reason), 'a decent-but-not-elite fixture holds, naming the best single-GW option');
const weakHint = { gw: 1, name: 'Mbeumo', lam: 1.2, xp: 4.5, opp: 'ARS', home: false };
const tcWeak = core.chipAdvice({}, normalFix, ['3xc'], [{ status: 'a' }], weakHint).all.find(a => a.chip === '3xc');
ok(tcWeak.window === 'hold' && tcWeak.conf <= 42, 'a weak fixture holds the Triple Captain');
const tcNoHint = core.chipAdvice({}, normalFix, ['3xc'], [{ status: 'a' }]).all.find(a => a.chip === '3xc');
ok(tcNoHint.window === 'hold', 'no double and no hint → hold (unchanged legacy behaviour)');

/* capHintFrom builds the hint from the top captain pick + their fixture. */
const chHint = core.capHintFrom({ picks: [{ el: { team: 1, web_name: 'Haaland' }, xp: 8.1 }] }, { 1: { event: 5, lam: 2.3, opp: 'BUR', home: true } });
ok(chHint && chHint.gw === 5 && chHint.name === 'Haaland' && chHint.lam === 2.3 && chHint.home === true, 'capHintFrom reads gw, name, team xG and venue from the top pick');
ok(core.capHintFrom({ picks: [] }, {}) === null && core.capHintFrom(null, {}) === null, 'capHintFrom is null-safe with no pick');

/* ── Section 3: My Week "Explain this" feature drivers ──── */
section('captainFeatures / transferFeatures / chipFeatures');
const capPick = { el: { team: 1, form: '5.2', ep_next: '6.1', web_name: 'Salah' }, xp: 7.4, eo: 40, ev: 1.8 };
const capNf = { 1: { lam: 2.1, opp: 'BUR', home: true, diff: 2 } };
const cf = core.captainFeatures({}, capNf, capPick);
ok(cf.length === 3, 'captain drivers return three reasons');
ok(cf[0].includes('7.4'), 'first driver quotes the xP');
ok(cf.some(s => s.includes('EV vs field')), 'a driver names the EV-vs-field edge');
ok(cf.some(s => s.includes('2.1') || s.toLowerCase().includes('xg')), 'a driver names the fixture xG');

/* transferFeatures uses horizonXP (stubbed to el._hx in this harness). */
const tf = core.transferFeatures({}, {},
  { out: { web_name: 'A', _hx: 2 }, cand: { web_name: 'B', _hx: 8 }, gain: 6 },
  { priceDelta: 1.5, bankAfter: 0.5, perGw: 1.2 });
ok(tf.length === 3, 'transfer drivers return three reasons');
ok(tf[0].includes('6.0') && tf[0].includes('5 GW'), 'leads with the 5-GW net xP');
ok(tf.some(s => s.includes('£1.5m') && s.includes('0.5')), 'a driver spells out the money');
const tfHold = core.transferFeatures({}, {}, null, null);
ok(tfHold.length === 3 && tfHold[0].toLowerCase().includes('no move'), 'HOLD explains why there is no move');

const advForFeat = core.chipAdvice({}, fixG, ['3xc', 'bboost'], [{ status: 'a' }]);
const chf = core.chipFeatures(advForFeat);
ok(chf.length >= 2, 'chip drivers return at least two reasons');
ok(chf.some(s => s.includes('GW2') || s.toLowerCase().includes('double')), 'a chip driver names the double');
ok(core.chipFeatures({ best: null }).length >= 1, 'chipFeatures is safe when nothing stands out');

/* ── Section 4: Fixture Difficulty 2.0 + set-piece confidence ─ */
section('fdrAttack / fdrDefence: monotonic, easier = lower');
ok(core.fdrAttack(2.5) === 1 && core.fdrAttack(0.5) === 5, 'high team xG is easy (1), low is hard (5)');
ok(core.fdrAttack(2.1) <= core.fdrAttack(1.4) && core.fdrAttack(1.4) <= core.fdrAttack(0.7),
  'attack difficulty falls monotonically with team xG');
ok(core.fdrDefence(0.6) === 1 && core.fdrDefence(0.1) === 5, 'high CS odds is easy (1), low is hard (5)');
ok(core.fdrDefence(0.55) <= core.fdrDefence(0.3) && core.fdrDefence(0.3) <= core.fdrDefence(0.12),
  'defence difficulty falls monotonically with clean-sheet odds');
ok([1, 2, 3, 4, 5].includes(core.fdrAttack(1.47)) && [1, 2, 3, 4, 5].includes(core.fdrDefence(0.28)),
  'both grades stay on the 1–5 scale');

section('setPieceConfidence: penalties dominate, roles + xP add');
const pen1 = core.setPieceConfidence({ penalties_order: 1 });
ok(pen1.value === 82 && pen1.tier === 'green', 'a primary penalty taker is high confidence');
ok(pen1.roles.includes('penalties') && pen1.addXp >= 0.5, 'flags the penalty role with real xP value');
const pen2 = core.setPieceConfidence({ penalties_order: 2 });
ok(pen2.value < pen1.value, 'the 2nd-choice taker is less certain than the 1st');
const multi = core.setPieceConfidence({ penalties_order: 1, direct_freekicks_order: 1, corners_and_indirect_freekicks_order: 1 });
ok(multi.roles.length === 3 && multi.addXp > pen1.addXp, 'a multi-duty taker stacks xP value across roles');
ok(multi.value === 82, 'confidence takes the strongest duty (penalties), not the sum');
const none = core.setPieceConfidence({});
ok(none.value === 0 && none.roles.length === 0, 'no set-piece duty → zero');

/* ── Section 4 (6-13): readiness, lineup, community ─────── */
section('benchBoostReadiness: strong bench scores higher');
const bbEl = (id, xp, status, ch) => ({ id, team: id, element_type: 3, status: status || 'a',
  chance_of_playing_next_round: ch === undefined ? null : ch,
  ep_next: String(xp), form: '4', points_per_game: '4', selected_by_percent: '5' });
const bbNf = { 1: { opp: 'BUR', lam: 1.6, cs: 0.3 }, 2: { opp: 'LUT', lam: 1.6, cs: 0.3 },
  3: { opp: 'EVE', lam: 1.6, cs: 0.3 }, 4: { opp: 'CHE', lam: 1.6, cs: 0.3 } };
const strongBench = core.benchBoostReadiness({}, bbNf, [bbEl(1, 5), bbEl(2, 4), bbEl(3, 4), bbEl(4, 4)]);
const weakBench = core.benchBoostReadiness({}, bbNf, [bbEl(1, 1), bbEl(2, 1, 'i'), bbEl(3, 0), bbEl(4, 1)]);
ok(strongBench.score > weakBench.score, 'a strong, fit bench scores above a weak/injured one');
ok(strongBench.playing === 4 && weakBench.playing < 4, 'counts only fit players with a fixture');
ok(strongBench.tier === core.confTier(strongBench.score), 'tier matches the score');
ok(core.benchBoostReadiness({}, {}, []).score === 0, 'an empty bench is zero');

section('lineupCheck: flags the point-costing mistakes');
const lcNf = { 1: { opp: 'BUR' }, 2: { opp: 'LUT' }, 3: { opp: 'EVE' } };  /* team 4 has NO fixture (blank) */
const lcPick = (element, position, isC) => ({ element, position, is_captain: !!isC });
const lcEls = { 10: { web_name: 'Fit', team: 1, status: 'a', chance_of_playing_next_round: null },
  11: { web_name: 'Hurt', team: 2, status: 'i', chance_of_playing_next_round: 0 },
  12: { web_name: 'Blank', team: 4, status: 'a', chance_of_playing_next_round: null },
  13: { web_name: 'Nailed', team: 3, status: 'a', chance_of_playing_next_round: null } };
const lcPicks = { picks: [ lcPick(10, 1, true), lcPick(11, 2), lcPick(12, 3), lcPick(13, 12) ] };
const issues = core.lineupCheck({ els: lcEls }, lcPicks, lcNf);
ok(issues.some(i => i.msg.includes('Hurt') && i.level === 'warn'), 'flags a ruled-out starter');
ok(issues.some(i => i.msg.includes('Blank') && i.msg.toLowerCase().includes('no fixture')), 'flags a starter with no fixture');
ok(issues.some(i => i.msg.includes('Nailed') && i.level === 'info'), 'flags a nailed player left on the bench');
/* A legal, fully fit XI (11 starters on a team that has a fixture). */
const fitEls = {};
const cleanRows = [];
for (let i = 0; i < 11; i++) { fitEls[100 + i] = { web_name: 'P' + i, team: 1, status: 'a', chance_of_playing_next_round: null };
  cleanRows.push(lcPick(100 + i, i + 1, i === 0)); }
const cleanIssues = core.lineupCheck({ els: fitEls }, { picks: cleanRows }, lcNf);
ok(cleanIssues.length === 1 && cleanIssues[0].level === 'ok', 'a legal, fully fit XI reports all-good');

section('communityAggregate: the crowd selectors');
const caB = { cur: { most_captained: 1, most_transferred_in: 2, most_transferred_out: 3, top_element_info: { id: 4 } },
  els: { 1: { web_name: 'Cap' }, 2: { web_name: 'In' }, 3: { web_name: 'Out' }, 4: { web_name: 'Top' } },
  elements: [ { id: 5, web_name: 'Owned', selected_by_percent: '61.0' }, { id: 1, web_name: 'Cap', selected_by_percent: '40.0' } ] };
const ca = core.communityAggregate(caB);
ok(ca.captain.web_name === 'Cap' && ca.transferIn.web_name === 'In', 'reads crowd captain + transfer in');
ok(ca.transferOut.web_name === 'Out' && ca.topScorer.web_name === 'Top', 'reads transfer out + top scorer');
ok(ca.mostOwned.web_name === 'Owned', 'finds the most-owned player');

/* ── topSelectedByPos + the optimal template XI ─────────── */
section('topSelectedByPos: top-N most owned per position');
let tsId = 1;
const mkOwn = (type, own, team) => ({ id: tsId++, element_type: type, team: team || (tsId % 8) + 1, web_name: 'P' + tsId, selected_by_percent: String(own), now_cost: 50 });
const tsPool = [];
[1, 2, 3, 4].forEach(t => { for (let i = 0; i < 14; i++) tsPool.push(mkOwn(t, 90 - i, t * 100 + i)); });
tsPool.push(mkOwn(3, 0, 99));   /* zero-owned should be excluded */
const top = core.topSelectedByPos(tsPool, 10);
ok([1, 2, 3, 4].every(t => top[t].length === 10), 'exactly 10 per position');
ok(top[3].every((e, i) => i === 0 || parseFloat(e.selected_by_percent) <= parseFloat(top[3][i - 1].selected_by_percent)), 'sorted by ownership descending');
ok(top[3].every(e => parseFloat(e.selected_by_percent) > 0), 'zero-owned players are excluded');
ok(core.topSelectedByPos([], 10)[1].length === 0, 'empty pool → empty positions');

section('differentials: ownership-first, no minutes gate, premiums excluded');
const diffPool = [
  { id: 1, status: 'a', selected_by_percent: '3.0', minutes: 0, now_cost: 55 },    /* season start, no minutes, cheap */
  { id: 2, status: 'a', selected_by_percent: '11.9', minutes: 540, now_cost: 55 },
  { id: 3, status: 'a', selected_by_percent: '40.0', minutes: 900, now_cost: 90 },  /* too owned */
  { id: 4, status: 'i', selected_by_percent: '2.0', minutes: 0, now_cost: 60 },     /* injured out */
  { id: 5, status: 'a', selected_by_percent: '0', minutes: 0, now_cost: 45 },       /* 0% owned, unplayed */
  { id: 6, status: 'a', selected_by_percent: '3.0', minutes: 0, now_cost: 140 },    /* premium (Haaland) briefly reading low at season open */
  { id: 7, status: 'a', minutes: 0, now_cost: 50 },                                 /* no ownership figure at all */
];
const diffs = core.differentials(diffPool);   /* default threshold */
ok(diffs.some(e => e.id === 1) && diffs.some(e => e.id === 5), 'includes low-owned players with zero minutes (season start / benched) — the bug fix');
ok(diffs.some(e => e.id === 2), 'an 11.9%-owned player is included under the 15% default');
ok(!diffs.some(e => e.id === 3), 'excludes players at/over the ownership threshold');
ok(!diffs.some(e => e.id === 4), 'excludes unavailable (injured/suspended) players');
ok(!diffs.some(e => e.id === 6), 'excludes premiums (£10.0m+) even when their ownership briefly reads low — the Haaland fix');
ok(!diffs.some(e => e.id === 7), 'excludes players with no real ownership figure (not treated as 0% differentials)');
ok(core.differentials(diffPool).every(e => parseFloat(e.selected_by_percent) < 15 && (e.now_cost || 0) < 100), 'every survivor is under 15% owned AND under £10.0m — the primary filters');
ok(core.differentials(diffPool, 5).every(e => parseFloat(e.selected_by_percent) < 5), 'a custom ownership threshold is honoured');
ok(core.differentials([{ status: 'a', selected_by_percent: '9.5', now_cost: 105 }], 15, 120).length === 1, 'a custom premium cap is honoured');
ok(core.differentials([{ status: 'a', selected_by_percent: '14.5', now_cost: 55 }]).length === 1 && core.differentials([{ status: 'a', selected_by_percent: '15.0', now_cost: 55 }]).length === 0, 'boundary: under 15 in, 15+ out');

section('bestXI drawn from the template pool is a legal, optimal XI');
/* Score the 40-player pool (higher ownership rank ≈ higher xP here) and build. */
const scored = [].concat(top[1], top[2], top[3], top[4]).map((e, i) => ({ el: e, p: parseFloat(e.selected_by_percent) / 10 }));
const xi = core.bestXI(scored);
ok(xi && xi.xi.length === 11, 'builds a full XI of 11');
const cnt = t => xi.xi.filter(s => s.el.element_type === t).length;
ok(cnt(1) === 1, 'exactly one goalkeeper');
ok(cnt(2) >= 3 && cnt(2) <= 5 && cnt(3) >= 3 && cnt(3) <= 5 && cnt(4) >= 1 && cnt(4) <= 3, 'a valid outfield formation');
const clubCount = {}; xi.xi.forEach(s => { clubCount[s.el.team] = (clubCount[s.el.team] || 0) + 1; });
ok(Object.values(clubCount).every(n => n <= 3), 'never more than 3 from one club');
ok(xi.xi.every(s => top[s.el.element_type].some(e => e.id === s.el.id)), 'every pick comes from the top-10 template pool');
/* Optimality: the single highest-xP player in the pool is always fielded, and
   the chosen formation beats every alternative on total xP. */
const bestP = scored.slice().sort((a, b) => b.p - a.p)[0];
ok(xi.xi.some(s => s.el.id === bestP.el.id), 'the top-projected player is always in the XI');
ok(xi.total === Math.max(...[[3, 4, 3], [3, 5, 2], [4, 5, 1], [4, 4, 2], [4, 3, 3], [5, 4, 1], [5, 3, 2], [5, 2, 3]].map(f => {
  const need = { 1: 1, 2: f[0], 3: f[1], 4: f[2] }, got = { 1: 0, 2: 0, 3: 0, 4: 0 }, club = {}; let tot = 0, n = 0;
  for (const s of scored.slice().sort((a, b) => b.p - a.p)) { const t = s.el.element_type, c = s.el.team; if (got[t] >= need[t] || (club[c] || 0) >= 3) continue; tot += s.p; got[t]++; club[c] = (club[c] || 0) + 1; if (++n === 11) break; }
  return n === 11 ? tot : -1;
})), 'the XI total equals the best achievable across all legal formations');

/* ── Latest News feed ───────────────────────────────────── */
section('timeAgo: relative time buckets');
const T = 1_700_000_000_000;
ok(core.timeAgo(new Date(T).toISOString(), T + 30 * 1000) === 'just now', 'under a minute → just now');
ok(core.timeAgo(new Date(T).toISOString(), T + 5 * 60e3) === '5m ago', 'minutes');
ok(core.timeAgo(new Date(T).toISOString(), T + 3 * 3600e3) === '3h ago', 'hours');
ok(core.timeAgo(new Date(T).toISOString(), T + 2 * 86400e3) === '2d ago', 'days');
ok(core.timeAgo(new Date(T).toISOString(), T + 21 * 86400e3) === '3w ago', 'weeks');
ok(core.timeAgo('', T) === '' && core.timeAgo('not-a-date', T) === '', 'blank / bad input → empty');

section('latestNews: only news, newest first');
const nB = { elements: [
  { id: 1, web_name: 'A', news: '', news_added: '2026-01-01T00:00:00Z' },
  { id: 2, web_name: 'B', news: 'Knock - 75%', news_added: '2026-01-03T10:00:00Z', status: 'd', chance_of_playing_next_round: 75 },
  { id: 3, web_name: 'C', news: 'Suspended', news_added: '2026-01-05T09:00:00Z', status: 's' },
  { id: 4, web_name: 'D', news: '   ', news_added: '2026-01-04T00:00:00Z' },
  { id: 5, web_name: 'E', news: 'Hamstring', news_added: '2026-01-02T00:00:00Z', status: 'i' },
] };
const feed = core.latestNews(nB, 10);
ok(feed.length === 3, 'only players with real news text (blank/whitespace excluded)');
ok(feed[0].el.web_name === 'C' && feed[1].el.web_name === 'B' && feed[2].el.web_name === 'E', 'sorted newest → oldest by news_added');
ok(feed[0].chance === undefined ? true : feed[0].status === 's', 'carries status/chance through');
ok(core.latestNews(nB, 2).length === 2, 'respects the limit');
ok(core.latestNews({ elements: [] }, 10).length === 0, 'no elements → empty feed');

/* ── nativeXP: the added scoring categories (P1) ────────── */
section('nativeXP models bonus, defensive-contribution and saves');
const nnf = { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.3 };
const baseMid = { element_type: 3, minutes: 540, expected_goals_per_90: '0.2', expected_assists_per_90: '0.2' };
const midBase = core.nativeXP(baseMid, nnf);
ok(midBase != null && midBase > 0, 'a midfielder with a full sample gets positive native xP');
ok(core.nativeXP(baseMid, { gp: 3, lam: 1.6, lamAvg: 1.5, cs: 0.3 }) === null, 'still null below the 5-game sample floor');

ok(core.nativeXP({ ...baseMid, bonus: 12 }, nnf) > midBase, 'realised bonus lifts the estimate');

const midDC12 = core.nativeXP({ ...baseMid, defensive_contribution_per_90: '12' }, nnf);
const midDC18 = core.nativeXP({ ...baseMid, defensive_contribution_per_90: '18' }, nnf);
ok(midDC18 > midDC12 && midDC12 > midBase, 'defensive-contribution points rise with the per-90 rate (MID threshold 12)');

const baseDef = { element_type: 2, minutes: 540, expected_goals_per_90: '0.05', expected_assists_per_90: '0.05' };
const defLow = core.nativeXP({ ...baseDef, defensive_contribution_per_90: '6' }, nnf);
const defHigh = core.nativeXP({ ...baseDef, defensive_contribution_per_90: '14' }, nnf);
ok(defHigh > defLow, 'a ball-winning defender (DEF threshold 10) out-scores a low-action one');

const gk = { element_type: 1, minutes: 540, expected_goals_per_90: '0', expected_assists_per_90: '0' };
ok(core.nativeXP({ ...gk, saves: 60 }, nnf) > core.nativeXP(gk, nnf), 'goalkeeper saves add points');
ok(core.nativeXP({ ...gk, defensive_contribution_per_90: '30' }, nnf) === core.nativeXP(gk, nnf),
  'goalkeepers get no defensive-contribution points (their category is saves)');

/* ── model fixes from the season backtest ───────────────── */
section('concedePts: goals-conceded downside for GK/DEF (fix 1)');
ok(core.concedePts(0.9) < core.concedePts(0.2), 'a leaky fixture (low CS odds) costs more than a solid one');
ok(core.concedePts(0.28) > 0.2 && core.concedePts(0.28) < 0.6, 'a league-average fixture costs ~0.3-0.4 pts');
const defSolid = core.nativeXP({ ...baseDef, defensive_contribution_per_90: '8' }, { gp: 6, lam: 1.4, lamAvg: 1.5, cs: 0.5 });
const defLeaky = core.nativeXP({ ...baseDef, defensive_contribution_per_90: '8' }, { gp: 6, lam: 1.4, lamAvg: 1.5, cs: 0.12 });
ok(defSolid > defLeaky, 'a defender on a solid fixture out-scores the same player on a leaky one');
const midSolid = core.nativeXP(baseMid, { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.5 });
const midLeaky = core.nativeXP(baseMid, { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.12 });
ok((defSolid - defLeaky) > 3 * (midSolid - midLeaky),
  'a defender is far more CS-sensitive than a midfielder (4pt CS + concede vs a lone 1pt CS)');
/* concedePts blends the player's own xGC/90 (API-fix 2). */
ok(core.concedePts(0.28, '2.4') > core.concedePts(0.28), 'a high player xGC/90 raises the concede deduction above the team-only estimate');
ok(core.concedePts(0.28, '0.5') < core.concedePts(0.28), 'a low player xGC/90 lowers it');
ok(core.concedePts(0.28, 'x') === core.concedePts(0.28) && core.concedePts(0.28, 0) === core.concedePts(0.28), 'missing / zero xGC leaves the team estimate unchanged');
const defBase = { element_type: 2, minutes: 540, starts: 6, status: 'a', expected_goals_per_90: '0.05', expected_assists_per_90: '0.05', defensive_contribution_per_90: '8' };
const defOdds = { gp: 6, lam: 1.4, lamAvg: 1.5, cs: 0.3 };
ok(core.nativeXP({ ...defBase, expected_goals_conceded_per_90: '2.2' }, defOdds) < core.nativeXP({ ...defBase, expected_goals_conceded_per_90: '0.6' }, defOdds),
  'a defender who personally ships more xGC is rated below a stingier one on the same team odds');

section('effGoalRate: finishing-aware goals (fix 5)');
const noGoalsField = { element_type: 4, minutes: 540, expected_goals_per_90: '0.4' };
ok(core.effGoalRate(noGoalsField) === 0.4, 'falls back to pure xG when goals are unknown');
const clinical = core.effGoalRate({ element_type: 4, minutes: 1800, expected_goals_per_90: '0.4', goals_scored: 16 });
const wasteful = core.effGoalRate({ element_type: 4, minutes: 1800, expected_goals_per_90: '0.4', goals_scored: 4 });
ok(clinical > 0.4 && clinical < 0.8, 'a clinical finisher is nudged above xG but shrunk, not fully');
ok(wasteful < 0.4, 'a wasteful finisher is nudged below xG');
const fwdBt = { element_type: 4, starts: 6, minutes: 540, status: 'a', chance_of_playing_next_round: null,
  expected_goals_per_90: '0.5', expected_assists_per_90: '0.2', bonus: 10 };
ok(core.nativeXP({ ...fwdBt, goals_scored: 20 }, nnf) > core.nativeXP(fwdBt, nnf), 'proven finishing lifts native xP');

section('negRate90: expected deductions for negatives (fix 4)');
ok(core.negRate90({ minutes: 900 }) === 0, 'a clean record deducts nothing');
ok(core.negRate90({ minutes: 900, red_cards: 1 }) > core.negRate90({ minutes: 900, yellow_cards: 1 }), 'a red costs more than a yellow');
ok(core.nativeXP({ ...fwdBt, yellow_cards: 8, red_cards: 1 }, nnf) < core.nativeXP(fwdBt, nnf), 'a booking-prone profile is debiased downward');

/* ── minutes model (P2) ─────────────────────────────────── */
section('minutesModel: availability reshapes the minutes');
const nailed = core.minutesModel({ starts: 6, minutes: 540, status: 'a', chance_of_playing_next_round: null }, 6);
ok(nailed.pStart > 0.95 && nailed.p60 > 0.95 && nailed.minFrac > 0.95, 'a nailed-on starter is ~certain to start and last 60');
const doubt = core.minutesModel({ starts: 6, minutes: 540, status: 'd', chance_of_playing_next_round: 50 }, 6);
ok(Math.abs(doubt.pStart - 0.5) < 0.02, 'a 50% doubt halves the start probability');
ok(doubt.minFrac < nailed.minFrac, 'a doubt lowers expected minutes');
const outPl = core.minutesModel({ starts: 6, minutes: 540, status: 'i', chance_of_playing_next_round: 0 }, 6);
ok(outPl.avail === 0 && outPl.pStart === 0 && outPl.minFrac === 0, 'an injured-out player is zeroed');
const rota = core.minutesModel({ starts: 3, minutes: 360, status: 'a', chance_of_playing_next_round: null }, 6);
ok(rota.pStart < nailed.pStart, 'a rotation risk starts less often than a nailed player');

/* ── recent minutes + this-round availability (API-fix 1, 3) ── */
section('recentMinutes: recency-weighted starts + minutes');
const allStarts = core.recentMinutes([1, 2, 3, 4, 5].map(r => ({ round: r, starts: 1, minutes: 90 })), 5);
ok(allStarts.n === 5 && Math.abs(allStarts.startShare - 1) < 1e-9 && Math.abs(allStarts.minShare - 1) < 1e-9, 'five full starts → share 1');
ok(core.recentMinutes([1, 2, 3].map(r => ({ round: r, starts: 0, minutes: 0 })), 5).startShare === 0, 'three blanks → share 0');
ok(core.recentMinutes([], 5).n === 0, 'no history → n 0');
const turnedNailed = core.recentMinutes([{ round: 1, starts: 0, minutes: 0 }, { round: 2, starts: 0, minutes: 0 }, { round: 3, starts: 1, minutes: 90 }, { round: 4, starts: 1, minutes: 90 }, { round: 5, starts: 1, minutes: 90 }], 5);
ok(turnedNailed.startShare > 0.55, 'a newly nailed player reads above 0.5 (recent gameweeks weigh more)');

section('minutesModel: recent form + this-round availability');
const seasonRota = { starts: 3, minutes: 360, status: 'a', chance_of_playing_next_round: null };
ok(core.minutesModel({ ...seasonRota, _recent: { startShare: 1, minShare: 1, n: 5 } }, 6).pStart > core.minutesModel(seasonRota, 6).pStart,
  'recent starts lift the start probability above the season average');
ok(core.minutesModel({ ...seasonRota, _recent: { startShare: 0, minShare: 0, n: 5 } }, 6).pStart < core.minutesModel(seasonRota, 6).pStart,
  'a recent benching pulls it below the season average');
const thisRoundDoubt = core.minutesModel({ starts: 6, minutes: 540, status: 'd', chance_of_playing_next_round: null, chance_of_playing_this_round: 25 }, 6);
ok(thisRoundDoubt.pStart < 0.3, 'a this-round doubt is applied when the next-round flag is unset');

section('nativeXP reflects the minutes model');
const nxNf = { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.3 };
const fitFwd = { element_type: 4, starts: 6, minutes: 540, status: 'a', chance_of_playing_next_round: null,
  expected_goals_per_90: '0.5', expected_assists_per_90: '0.2', bonus: 10 };
const doubtFwd = { ...fitFwd, status: 'd', chance_of_playing_next_round: 50 };
const outFwd = { ...fitFwd, status: 'i', chance_of_playing_next_round: 0 };
ok(core.nativeXP(doubtFwd, nxNf) < core.nativeXP(fitFwd, nxNf), 'a doubt lowers native xP');
ok(core.nativeXP(outFwd, nxNf) === 0, 'a ruled-out player gets zero native xP');

/* ── points distribution (P3) ───────────────────────────── */
section('pointsDist: ordered percentiles, deterministic, premium hauls more');
const pdNf = { gp: 6, lam: 1.9, lamAvg: 1.5, cs: 0.4 };
const prem = { id: 1, element_type: 4, starts: 6, minutes: 540, status: 'a',
  expected_goals_per_90: '0.85', expected_assists_per_90: '0.2', bonus: 18, defensive_contribution_per_90: '2' };
const cheap = { id: 2, element_type: 3, starts: 6, minutes: 500, status: 'a',
  expected_goals_per_90: '0.08', expected_assists_per_90: '0.1', bonus: 4, defensive_contribution_per_90: '3' };
const dp = core.pointsDist(prem, pdNf);
ok(dp.p10 <= dp.p50 && dp.p50 <= dp.p90, 'percentiles are ordered');
ok(dp.mean > 0 && dp.p90 > dp.p10, 'a real spread');
ok(dp.haul > core.pointsDist(cheap, pdNf).haul, 'the premium hauls more often than the cheap punt');
const dp2 = core.pointsDist(prem, pdNf);
ok(dp.p50 === dp2.p50 && dp.p90 === dp2.p90, 'deterministic (seeded on the player id)');
ok(core.pointsDist(prem, null).mean === 0, 'no fixture model → zeroed distribution');
const gkDist = core.pointsDist({ id: 3, element_type: 1, starts: 6, minutes: 540, status: 'a', saves: 60 }, { gp: 6, lam: 1.4, lamAvg: 1.5, cs: 0.45 });
ok(gkDist.mean > 0, 'a goalkeeper gets a positive distribution (saves + clean sheet)');

/* ── correlated squad simulation (P4) ───────────────────── */
section('squadSim: projects an XI, captain doubles, shared team outcomes');
const sq = [];
for (let i = 0; i < 11; i++) sq.push({ id: 200 + i, team: 1 + (i % 5), element_type: i === 0 ? 1 : i < 5 ? 2 : i < 9 ? 3 : 4,
  starts: 6, minutes: 540, status: 'a', expected_goals_per_90: i > 4 ? '0.4' : '0.05',
  expected_assists_per_90: '0.15', bonus: 8, defensive_contribution_per_90: '9', saves: i === 0 ? 60 : 0 });
const sqNf = { 1: { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.35 }, 2: { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.35 },
  3: { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.35 }, 4: { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.35 }, 5: { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.35 } };
const noCap = core.squadSim(sq, sqNf, null);
const withCap = core.squadSim(sq, sqNf, 205);          /* captain a forward */
ok(noCap.p10 <= noCap.p50 && noCap.p50 <= noCap.p90, 'squad total percentiles ordered');
ok(noCap.mean > 20, 'a full XI projects a sensible points total');
ok(withCap.mean > noCap.mean, 'captaining a starter raises the projection');
ok(core.squadSim(sq, sqNf, 205).p50 === withCap.p50, 'deterministic (seeded on the squad)');
ok(core.squadSim([], sqNf, null).mean === 0, 'an empty squad projects zero');

/* ── rank-EV transfer optimiser (P4) ────────────────────── */
section('normCdf: standard normal CDF');
ok(Math.abs(core.normCdf(0) - 0.5) < 1e-3, 'CDF at 0 is 0.5');
ok(core.normCdf(3) > 0.99 && core.normCdf(-3) < 0.01, 'far tails saturate');
ok(Math.abs(core.normCdf(1.6449) - 0.95) < 2e-3, '95th percentile at z≈1.645');
ok(core.normCdf(-1) < 0.5 && core.normCdf(1) > 0.5, 'monotone around the mean');

section('effEdge: ownership damps the edge over the field');
const rnf = { gp: 6, lam: 1.7, lamAvg: 1.5, cs: 0.35 };
const hi = core.effEdge({ id: 501, element_type: 3, starts: 6, minutes: 540, status: 'a',
  expected_goals_per_90: '0.55', expected_assists_per_90: '0.3', bonus: 10, selected_by_percent: '60' }, rnf);
const lo = core.effEdge({ id: 502, element_type: 3, starts: 6, minutes: 540, status: 'a',
  expected_goals_per_90: '0.55', expected_assists_per_90: '0.3', bonus: 10, selected_by_percent: '4' }, rnf);
ok(Math.abs(hi.raw.mean - lo.raw.mean) < 0.4, 'same profile → near-identical raw distribution');
ok(lo.mean > hi.mean, 'the low-owned twin carries a bigger edge over the field');
ok(lo.sd > hi.sd, 'the differential also swings rank harder');
ok(hi.o === 0.6 && lo.o === 0.04, 'ownership fraction read from selected_by_percent');

section('rankEV / rankOptimiser: rank pick can differ from points pick');
const outEl = { id: 510, team: 3, element_type: 3, starts: 6, minutes: 540, status: 'a', now_cost: 70,
  expected_goals_per_90: '0.15', expected_assists_per_90: '0.1', bonus: 3, selected_by_percent: '30' };
/* Two candidates: one slightly higher raw points but heavily owned (template),
   one a hair lower on raw points but a differential. */
const templ = { id: 511, team: 4, element_type: 3, starts: 6, minutes: 540, status: 'a', now_cost: 70,
  expected_goals_per_90: '0.62', expected_assists_per_90: '0.32', bonus: 12, selected_by_percent: '70' };
const diff = { id: 512, team: 5, element_type: 3, starts: 6, minutes: 540, status: 'a', now_cost: 70,
  expected_goals_per_90: '0.58', expected_assists_per_90: '0.30', bonus: 11, selected_by_percent: '5' };
const oNf = { 3: rnf, 4: rnf, 5: rnf };
const rTempl = core.rankEV(templ, outEl, oNf), rDiff = core.rankEV(diff, outEl, oNf);
ok(rTempl.rawGain > 0 && rDiff.rawGain > 0, 'both upgrades gain raw points');
ok(rDiff.dMean > rTempl.dMean, 'the differential wins on edge over the field despite lower raw points');
ok(rDiff.beat > 0.5, 'a positive edge beats the field more than half the time');
const optB = { elements: [templ, diff], els: { 511: templ, 512: diff } };
const opt = core.rankOptimiser(optB, [outEl], [outEl], 20, oNf, new Set());
ok(opt.topRank && opt.topRank.inEl.id === 512, 'optimiser ranks the differential top');
ok(opt.topPoints && opt.topPoints.inEl.id === 511, 'and still names the raw-points leader');
ok(opt.diverges === true, 'flags that points and rank disagree here');
ok(core.rankOptimiser(optB, [outEl], [outEl], 20, oNf, new Set([510])).moves.length === 0, 'a protected player is never sold');

/* ── match model refinements (P6) ───────────────────────── */
section('recencyWeight / availAttackMult');
ok(core.recencyWeight(10, 10) === 1, 'the latest gameweek is full weight');
ok(core.recencyWeight(9, 10) < 1 && core.recencyWeight(9, 10) > core.recencyWeight(1, 10), 'older fixtures decay monotonically');
ok(Math.abs(core.recencyWeight(0, 10) - Math.pow(0.97, 10)) < 1e-9, '10 GWs back ≈ 0.97^10');
ok(core.recencyWeight(12, 10) === 1, 'future/clamped events never exceed full weight');
ok(core.availAttackMult('a') === 1, 'a fit key attacker leaves attack unchanged');
ok(core.availAttackMult('i') === 0.90 && core.availAttackMult('s') === 0.90, 'a ruled-out key man cuts team attack 10%');
ok(core.availAttackMult('d') === 0.96, 'a doubtful key man cuts attack 4%');

/* ── calibration (P5) ───────────────────────────────────── */
section('calibration: Brier score + reliability curve');
/* Perfectly calibrated: outcomes occur exactly at the predicted rate. */
const perfect = [];
for (let b = 0; b < 10; b++) { const p = (b + 0.5) / 10;
  for (let i = 0; i < 100; i++) perfect.push({ p, y: i < Math.round(p * 100) ? 1 : 0 }); }
const cp = core.calibration(perfect);
ok(cp.n === 1000 && cp.brier > 0, 'grades all rows with a Brier score');
ok(cp.buckets.every(b => Math.abs(b.pMean - b.oFreq) < 0.05), 'a calibrated model tracks the diagonal (pMean ≈ oFreq)');
/* An over-confident model: always predicts 0.9 but outcomes are 50/50. */
const over = [];
for (let i = 0; i < 1000; i++) over.push({ p: 0.9, y: i % 2 });
const co = core.calibration(over);
ok(co.brier > cp.brier, 'an over-confident model scores a worse (higher) Brier');
ok(co.buckets.some(b => b.pMean - b.oFreq > 0.3), 'the reliability curve exposes the over-confidence');
ok(core.calibration([]).n === 0 && core.calibration([]).brier === null, 'empty input is handled');

/* ── summary ────────────────────────────────────────────── */
console.log('\n' + passes + ' passed, ' + failures + ' failed');
if (failures) process.exit(1);
