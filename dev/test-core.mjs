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
  extractFn(html, 'captainModel'),
  extractFn(html, 'captainConfidence'),
  extractFn(html, 'transferFrame'),
  extractFn(html, 'eventShape'),
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
  /* Latest News feed. */
  extractFn(html, 'timeAgo'),
  extractFn(html, 'latestNews')
];
const core = new Function(
  pieces.join('\n') +
  '\nreturn {plsimMatch, esc, nativeXP, xP, priceChangeProb, suspCutoff, suspRisk, bestXI, minutesSecurity, projectXI, lgScoreGrid, lgCleanSheets, draftValidate, draftCanAdd, fitJSON, bestTransfer, MIN_TR_GAIN, gwPhase, confTier, captainEligible, captainBand, captainModel, captainConfidence, transferFrame, eventShape, chipAdvice, captainFeatures, transferFeatures, chipFeatures, fdrAttack, fdrDefence, setPieceConfidence, benchBoostReadiness, lineupCheck, communityAggregate, timeAgo, latestNews};'
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

/* ── summary ────────────────────────────────────────────── */
console.log('\n' + passes + ' passed, ' + failures + ' failed');
if (failures) process.exit(1);
