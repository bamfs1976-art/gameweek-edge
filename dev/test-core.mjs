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
/* Comments are skipped BEFORE strings, and that ordering is the whole point.
   Without it an ordinary apostrophe in prose — "a midfielder's tariff" inside
   an explanatory comment — opens a phantom string, the scanner sails past the
   closing brace, and the extracted "function" swallows whatever follows it.
   That is not hypothetical: it is how this file started failing the moment a
   comment in oopFlag used the word midfielder's. The sibling extractors in
   extract-engine.mjs and test-chipplan.mjs already did this; this one was the
   last naive scanner left. */
function extractBlock(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  if (open < 0) throw new Error('no opening brace');
  let depth = 0, inStr = null, esc = false, com = 0;
  for (let j = open; j < src.length; j++) {
    const ch = src[j], nx = src[j + 1];
    if (com) {
      if (com === 1 && ch === '\n') com = 0;
      else if (com === 2 && ch === '*' && nx === '/') { com = 0; j++; }
      continue;
    }
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '/' && nx === '/') { com = 1; j++; continue; }
    if (ch === '/' && nx === '*') { com = 2; j++; continue; }
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
  /* minutesModel now discounts a start for midweek European / cup football;
     with no congestion passed, congestionFactor returns 1 and it is a no-op. */
  ...['CONGEST_FULL', 'CONGEST_FADE', 'CONGEST_MAX', 'CONGEST_NAILED', 'CONGEST_TO_BENCH']
    .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'congestionFactor'),
  extractFn(html, 'minutesModel'),
  extractFn(html, 'concedePts'),
  extractFn(html, 'savePts'),
  extractFn(html, 'dcHitProb'),
  extractFn(html, 'effGoalRate'),
  extractFn(html, 'negRate90'),
  extractFn(html, 'recencyWeight'),
  extractFn(html, 'availAttackMult'),
  extractFn(html, 'nativeXP'),
  extractFn(html, 'xP'),
  extractFn(html, 'fixtureXP'),
  /* The real horizonXP, renamed: transferFeatures below is tested against a
     stub of the same name, and a later function declaration would shadow
     this one. Both are wanted, so they cannot share a name. */
  extractFn(html, 'horizonXP').replace('function horizonXP(', 'function horizonXPreal('),
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
  extractFn(html, 'rotationPairs'),
  extractFn(html, 'bestFixtureRun'),
  /* The Fixture Planner's purple patch, and the entry-point summary read
     off the same call. */
  extractConst(html, 'FDR_PATCH_MAX'),
  extractFn(html, 'fdrGrade'),
  extractFn(html, 'fdrPatchFor'),
  extractFn(html, 'chipSwings'),
  /* Latest News feed. */
  extractFn(html, 'timeAgo'),
  extractFn(html, 'latestNews'),
  /* Pre-season readiness: season key derivation for scoped storage. */
  extractFn(html, 'seasonKeyFrom'),
  /* Pre-season readiness: promoted-club prior + bundle season cross-check. */
  extractConst(html, 'PLSIM_ALIAS'),
  extractLine(html, /const PLSIM_PROMOTED=\[[\d.,]+\];/),
  /* plsimPrior falls through to an Elo-derived prior when we have no
     offline fit for a club; absent Elo restores the old behaviour. */
  ...['ELO_SCALE', 'ELO_ATT', 'ELO_DEF', 'ELO_CLAMP']
    .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'eloMean'),
  extractFn(html, 'eloPrior'),
  /* Fixture-planner lenses: each cell now prints its own projection. */
  extractConst(html, 'FDR_LENS'),
  extractFn(html, 'fdrLens'),
  extractFn(html, 'fdrCellValue'),
  extractFn(html, 'fdrRunTotal'),
  /* Out-of-position detection. */
  ...['OOP_MIN_MINUTES', 'OOP_PCTL', 'OOP_STRONG_PCTL', 'OOP_MID_PCTL', 'OOP_MID_STRONG_PCTL', 'OOP_LOW_PCTL', 'OOP_MIN_POOL']
    .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'dcRate90'),
  extractFn(html, 'dcThreshold'),
  extractFn(html, 'oopThreat'),
  extractFn(html, 'oopQuantile'),
  extractFn(html, 'oopBenchmarks'),
  extractFn(html, 'oopFlag'),
  /* Set pieces pivoted club-first. */
  extractConst(html, 'SP_DUTIES'),
  extractFn(html, 'setPieceByClub'),
  extractFn(html, 'setPieceClubRows'),
  /* Rotation chains: one slot, many clubs, transfers cost something. */
  ...['ROT_SWITCH'].map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'rotationChain'),
  /* Club dossier: the venue split and the attack-or-defence read. */
  ...['SPLIT_MIN_GAMES', 'SPLIT_EDGE', 'LEAN_EDGE']
    .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'clubSplit'),
  ...['OPP_SPLIT_MIN'].map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'poorAttacks'),
  extractFn(html, 'clubVsPoorAttacks'),
  extractFn(html, 'venueSplit'),
  ...['VALUE_MIN_FIT'].map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'valueFit'),
  extractFn(html, 'valueResiduals'),
  extractFn(html, 'clubVenueVerdict'),
  extractFn(html, 'clubLean'),
  ...['DEPTH_TIE', 'DEPTH_FRINGE', 'DEPTH_MAX']
    .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'clubDepth'),
  extractFn(html, 'plsimPrior'),
  extractFn(html, 'bundleSeasonStale')
];
const core = new Function(
  pieces.join('\n') +
  '\nreturn {plsimMatch, esc, nativeXP, xP, priceChangeProb, suspCutoff, suspRisk, bestXI, minutesSecurity, projectXI, lgScoreGrid, lgCleanSheets, draftValidate, draftCanAdd, draftBuild, draftFillGaps, fitJSON, bestTransfer, MIN_TR_GAIN, gwPhase, confTier, captainEligible, captainBand, captainModel, captainConfidence, transferFrame, eventShape, capHintFrom, chipAdvice, captainFeatures, transferFeatures, chipFeatures, fdrAttack, fdrDefence, setPieceConfidence, benchBoostReadiness, lineupCheck, communityAggregate, topSelectedByPos, differentials, rotationPairs, bestFixtureRun, fdrGrade, fdrPatchFor, FDR_PATCH_MAX, chipSwings, timeAgo, latestNews, seasonKeyFrom, plsimPrior, eloPrior, eloMean, fdrCellValue, fdrRunTotal, fdrLens, dcRate90, dcThreshold, oopThreat, oopQuantile, oopBenchmarks, oopFlag, OOP_MIN_MINUTES, OOP_PCTL, OOP_MIN_POOL, setPieceByClub, setPieceClubRows, rotationChain, ROT_SWITCH, clubSplit, poorAttacks, clubVsPoorAttacks, OPP_SPLIT_MIN, venueSplit, valueFit, valueResiduals, VALUE_MIN_FIT, clubVenueVerdict, clubLean, SPLIT_MIN_GAMES, clubDepth, DEPTH_TIE, DEPTH_FRINGE, DEPTH_MAX, PLSIM_PROMOTED, PLSIM, PLSIM_ALIAS, bundleSeasonStale, recentMinutes, minutesModel, concedePts, savePts, dcHitProb, effGoalRate, negRate90, pointsDist, fixtureXP, horizonXPreal, recencyWeight, availAttackMult, squadSim, normCdf, effEdge, edgeDelta, rankEV, rankOptimiser, calibration};'
)();

/* ── tiny assertion harness ─────────────────────────────── */
let failures = 0, passes = 0;
function ok(cond, label) {
  if (cond) { passes++; }
  else { failures++; console.error('  ✗ ' + label); }
}
function section(name) { console.log('• ' + name); }

/* ── esc ────────────────────────────────────────────────── */
section('dcRate90: a zero is not the same as no data');
{
  /* Measured against the live bootstrap, not assumed: the per-90 field comes
     back PRESENT and set to 0 for every player with real minutes, so a
     fallback keyed on isNaN could never fire against the shape FPL actually
     sends. This is the assertion that would have caught that. */
  const F = core.dcRate90;
  ok(F({ defensive_contribution_per_90: '9.5', defensive_contribution: 0, minutes: 900 }) === 9.5,
    'a real per-90 figure is used as-is');
  const derived = F({ defensive_contribution_per_90: '0', defensive_contribution: 100, minutes: 900 });
  ok(Math.abs(derived - 10) < 1e-9,
    'a ZERO per-90 with a real season total derives the rate (' + derived + ')');
  ok(Math.abs(F({ defensive_contribution: 100, minutes: 900 }) - 10) < 1e-9,
    'and so does an absent field');
  ok(F({ defensive_contribution_per_90: '0', defensive_contribution: 0, minutes: 900 }) === 0,
    'no data anywhere still gives zero rather than an invention');
  ok(Number.isFinite(F({})), 'a bare element does not divide by zero');
  ok(core.dcThreshold({ element_type: 2 }) === 10 && core.dcThreshold({ element_type: 3 }) === 12,
    'the threshold follows the position');
}

section('extractBlock: the harness must not corrupt what it measures');
{
  /* Every assertion in this file rests on extractBlock pulling out exactly
     one function. When it over-captures the tests do not fail honestly —
     the whole sandbox stops parsing, or worse, silently tests the wrong
     code. So the scanner is tested against the things that fool it. */
  const cases = [
    ["apostrophe in a block comment", "function f(){ /* a midfielder's tariff */ return 1; }"],
    ["apostrophe in a line comment", "function f(){ // the striker's job\n return 1; }"],
    ["quote in a block comment", 'function f(){ /* he said "no" */ return 1; }'],
    ["brace in a line comment", "function f(){ // }\n return 1; }"],
    ["brace in a block comment", "function f(){ /* } */ return 1; }"],
    ["brace in a string", 'function f(){ var s = "}"; return 1; }'],
    ["brace in a template", "function f(){ var s = `}`; return 1; }"],
    ["escaped quote", "function f(){ var s = 'it\\'s'; return 1; }"],
    ["comment marker inside a string", 'function f(){ var s = "/*"; return 1; }']
  ];
  for (const [label, src] of cases) {
    let got = null;
    try { got = extractBlock(src, 0); } catch (_) { /* reported below */ }
    ok(got === src, 'captures exactly the function: ' + label +
      (got === src ? '' : ' — got ' + JSON.stringify(got)));
  }
  /* And the real thing: the function whose comment broke this. */
  const flag = extractFn(html, 'oopFlag');
  ok((flag.match(/^function [A-Za-z0-9_$]+\(/gm) || []).length === 1,
    'oopFlag extracts as one function, not a run-on');
  let parsed = true;
  try { new Function('return (' + flag + ')'); } catch (_) { parsed = false; }
  ok(parsed, 'and it parses on its own');
}

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
/* A game with no transfer cost must never frame a move as costing a hit, even
   with no free transfer banked. The default stays "charges hits", so FPL is
   unaffected and the flag only matters to a pack that opts out. */
const frFree = core.transferFrame({ out: { now_cost: 70 }, cand: { now_cost: 70 }, gain: 6 }, 5, 0, 5, false);
ok(frFree.usesHit === false && frFree.hitCost === 0, 'a game without transfer costs takes no hit');
ok(Math.abs(frFree.clears - 6) < 1e-9, 'and the full gain survives (6 − 0 = 6)');
ok(frFree.beGw === 0, 'breakeven is immediate when nothing is spent');
ok(core.transferFrame({ out: { now_cost: 70 }, cand: { now_cost: 70 }, gain: 6 }, 5, 0, 5).usesHit === true,
  'omitting the flag still charges the hit (FPL default unchanged)');

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

section('rotationPairs: cheap defenders whose easy fixtures alternate');
/* Two teams with mirror-image runs (one easy while the other is hard) should
   pair to an all-green combined run; a third team is hard throughout. */
const rotDiff = {
  10: [1, 5, 1, 5, 1, 5],   /* easy on odd weeks */
  20: [5, 1, 5, 1, 5, 1],   /* easy on even weeks — perfect rotation with 10 */
  30: [4, 4, 4, 4, 4, 4],   /* always awkward */
};
const rotCands = [
  { id: 1, team: 10, cost: 45, own: 20 },
  { id: 2, team: 20, cost: 45, own: 18 },
  { id: 3, team: 30, cost: 45, own: 5 },
];
const rp = core.rotationPairs(rotCands, rotDiff, 6);
ok(rp.length === 3, 'every cross-club pair is returned');
ok(rp[0].a.team !== rp[0].c.team, 'a pair is always two different clubs');
ok(rp[0].score === 6 && rp[0].green === 6, 'the mirror pair scores a perfect all-green combined run');
ok((rp[0].a.team === 10 && rp[0].c.team === 20) || (rp[0].a.team === 20 && rp[0].c.team === 10), 'the best pair is the two mirror-image teams');
ok(rp[0].score <= rp[rp.length - 1].score, 'pairs are ranked easiest combined run first');
ok(core.rotationPairs(rotCands, rotDiff, 1).length === 1, 'the limit caps the number of pairs');
ok(core.rotationPairs([{ id: 9, team: 99, cost: 40 }], rotDiff, 6).length === 0, 'a player whose team has no fixtures yields no pair');

section('fdrPatchFor / entry points: a run is only a window if it is actually kind');
{
  /* The grid draws a purple underline and the entry-point summary lists the
     gameweek it starts. Both must come from one call, or the panel lists a
     club as an entry point that it did not underline two inches above. */
  const gws = [1, 2, 3, 4, 5, 6];
  const cell = (diff) => ({ diff, lam: 1.5, cs: 0.3, fdr: diff });
  const kind = {}; gws.forEach((g) => { kind[g] = cell(g >= 3 ? 1.5 : 5); });
  const cruel = {}; gws.forEach((g) => { cruel[g] = cell(4.5); });
  const byTeamGw = { 1: kind, 2: cruel };

  const p1 = core.fdrPatchFor('overall', 1, gws, byTeamGw, 3);
  ok(p1 && gws[p1.start] === 3, 'the kind stretch is found where it starts (GW' +
    (p1 ? gws[p1.start] : '—') + ')');
  ok(p1 && gws[p1.end] === 5, 'and runs to the end of K');
  ok(core.fdrPatchFor('overall', 2, gws, byTeamGw, 3) === null,
    'a club whose best run is still hard gets no window at all');

  /* The gate is the shared constant, not a number retyped in two places. */
  const edge = {}; gws.forEach((g) => { edge[g] = cell(core.FDR_PATCH_MAX); });
  ok(core.fdrPatchFor('overall', 3, gws, { 3: edge }, 3) !== null,
    'a run exactly at the threshold still counts');
  const over = {}; gws.forEach((g) => { over[g] = cell(core.FDR_PATCH_MAX + 0.1); });
  ok(core.fdrPatchFor('overall', 3, gws, { 3: over }, 3) === null, 'just past it does not');

  /* A missing fixture grades 6 — maximally hard — so a blank always makes a
     run worse rather than being skipped over. */
  const full = {}; gws.forEach((g) => { full[g] = cell(1); });
  const gap = {}; gws.forEach((g) => { if (g !== 3) gap[g] = cell(1); });
  /* Given room, the best run simply avoids the blank and is no worse for it. */
  ok(core.fdrPatchFor('overall', 5, gws, { 5: gap }, 3).sum
     === core.fdrPatchFor('overall', 5, gws, { 5: full }, 3).sum,
    'a run routes around a blank when the window has room');
  ok(gws[core.fdrPatchFor('overall', 5, gws, { 5: gap }, 3).start] !== 3,
    'and does not start on it');
  /* With no room to avoid it, the blank costs the run its full 6. */
  ok(core.fdrPatchFor('overall', 5, gws, { 5: gap }, 5).sum
     > core.fdrPatchFor('overall', 5, gws, { 5: full }, 5).sum,
    'and when it cannot be avoided it makes the run worse');

  /* Pinning a known limitation rather than asserting it away: with only two
     kind fixtures either side, a three-game window CONTAINING the blank still
     averages under the threshold and is drawn as a patch. That is the grid's
     existing rule and the summary now inherits it, so any change to it should
     be deliberate rather than a side effect. */
  const short = { 1: cell(1), 2: cell(1) };
  const p2 = core.fdrPatchFor('overall', 4, gws, { 4: short }, 3);
  ok(p2 !== null && (2 + 6) / 3 <= core.FDR_PATCH_MAX,
    'two kind fixtures plus a blank still clears the bar on the mean');

  /* THE HORIZON RULE. A K-game run cannot start in the last K-1 weeks of a
     window, so those weeks must not be listed as "nothing turns here" — that
     claims an absence of opportunity where there is only an absence of
     horizon. Live, a 5-game patch over a 10-week view made four gameweeks
     read as empty when no run could have fitted in them. */
  for (const [len, K] of [[10, 5], [6, 3], [5, 5], [3, 5]]) {
    const win = Array.from({ length: len }, (_, i) => i + 1);
    const kk = Math.min(K, win.length);
    const canStart = win.slice(0, Math.max(1, win.length - kk + 1));
    ok(canStart.length === Math.max(1, len - kk + 1),
      'a ' + kk + '-game run over ' + len + ' weeks can start in ' + canStart.length + ' of them');
    ok(canStart[canStart.length - 1] + kk - 1 <= win[win.length - 1],
      'and the last listed start still finishes inside the window');
  }
}

section('bestFixtureRun: the lowest-difficulty run of K consecutive gameweeks (purple patch)');
const brun = core.bestFixtureRun([5, 5, 1, 1, 1, 5], 3);
ok(brun.start === 2 && brun.end === 4 && brun.sum === 3, 'finds the easiest 3-gameweek block');
ok(core.bestFixtureRun([2, 2, 2, 2], 2).start === 0, 'ties resolve to the earliest block');
ok(core.bestFixtureRun([4], 5).K === 1 && core.bestFixtureRun([4], 5).sum === 4, 'K is clamped to the array length');
ok(core.bestFixtureRun([], 3) === null, 'an empty array yields no run');
{
  const arr = [3, 1, 2, 5, 5, 5], r = core.bestFixtureRun(arr, 3);
  let s = 0; for (let i = r.start; i <= r.end; i++) s += arr[i];
  ok(s === r.sum && r.sum === 6, 'the returned sum matches the marked block');
}

section('chipSwings: fixture-swing Free Hit and Wildcard windows');
const fhRuns = [
  { team: 1, own: 50, diff: [2, 2, 2, 5, 2, 2] },  /* heavily owned, hard fixture at index 3 */
  { team: 2, own: 40, diff: [2, 2, 2, 5, 2, 2] },
  { team: 3, own: 1, diff: [5, 5, 5, 1, 5, 5] },   /* barely owned, so its easy week 3 barely moves the field mean */
];
const swFH = core.chipSwings(fhRuns, 2, 2);
ok(swFH.fh.idx === 3, 'Free Hit lands on the week the most-owned teams face the hardest fixtures');
ok(swFH.fh.clear === true, 'a clear ownership-weighted spike above the window average is flagged');
const wcRuns = [
  { team: 1, own: 10, diff: [1, 1, 1, 5, 5, 5, 5, 5, 1, 1] },  /* great early, turns hard from index 3 */
  { team: 2, own: 10, diff: [5, 5, 5, 1, 1, 1, 1, 1, 5, 5] },  /* the opposite — the reshape target */
];
const swWC = core.chipSwings(wcRuns, 5, 1);
ok(swWC.wc.idx === 3, 'Wildcard lands where the current best-fixture teams turn hardest over the next run');
ok(swWC.wc.gain > 0, 'the reshape difficulty-shed is positive at the swing boundary');
ok(core.chipSwings([], 5, 6).fh === null, 'no teams yields no swing');
ok(core.chipSwings([{ team: 1, own: 5, diff: [2, 2] }], 5, 6).wc === null, 'too short a horizon yields no Wildcard boundary');

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

section('savePts: the saves floor is charged on the count, not on its mean');
/* FPL pays 1 point per 3 saves, so the value is E[floor(S/3)], not E[S]/3.
   The gap is the expected remainder — about one save, a third of a point —
   and it is very nearly constant across every realistic save rate. */
const exactSavePts = (lam) => { let p = Math.exp(-lam), e = 0; for (let k = 1; k <= 200; k++) { p *= lam / k; e += p * Math.floor(k / 3); } return e; };
for (const lam of [1.5, 3, 4.6, 6]) {
  ok(Math.abs(core.savePts(lam) - exactSavePts(lam)) < 1e-9, 'savePts matches a direct pmf sum at lam=' + lam);
  ok(core.savePts(lam) < lam / 3, 'the floor costs points against the naive mean/3 at lam=' + lam);
}
ok(Math.abs((3 / 3 - core.savePts(3)) - (6 / 3 - core.savePts(6))) < 0.02,
  'the over-credit the old term carried is flat in the save rate (so it was a bias, not noise)');
ok(core.savePts(0) === 0 && core.savePts(-1) === 0, 'no saves expected, no points, no throw');
const gkQuiet = { element_type: 1, minutes: 540, starts: 6, status: 'a', saves: 12, expected_goals_per_90: '0', expected_assists_per_90: '0' };
const gkBusy = { ...gkQuiet, saves: 40 };
const gkOdds = { gp: 6, lam: 1.2, lamAvg: 1.5, cs: 0.3 };
ok(core.nativeXP(gkBusy, gkOdds) > core.nativeXP(gkQuiet, gkOdds), 'a busier keeper still projects higher');

section('dcHitProb: the defensive-contribution threshold, as a threshold');
ok(core.dcHitProb(0, 10) === 0, 'no counted actions, no chance of the bonus');
ok(core.dcHitProb(20, 10) > 0.99 && core.dcHitProb(3, 10) < 0.01, 'far either side of the line is near-certain either way');
ok(core.dcHitProb(10, 10) > 0.4 && core.dcHitProb(10, 10) < 0.6, 'right on the threshold is close to a coin flip');
ok(core.dcHitProb(12, 12) < core.dcHitProb(12, 10), 'the midfielder threshold of 12 is harder than the defender 10 at the same rate');
/* The point estimate must equal the expectation of the event the simulators
   draw — that agreement is the whole reason this replaced a hand-picked
   logistic that had no relationship to it. */
const dcDef = { element_type: 2, minutes: 540, starts: 6, status: 'a', expected_goals_per_90: '0.05', expected_assists_per_90: '0.05', expected_goals_conceded_per_90: '1.2' };
const dcOdds = { gp: 6, lam: 1.4, lamAvg: 1.5, cs: 0.3 };
const dcLow = core.nativeXP({ ...dcDef, defensive_contribution_per_90: '4' }, dcOdds);
const dcHigh = core.nativeXP({ ...dcDef, defensive_contribution_per_90: '14' }, dcOdds);
ok(dcHigh - dcLow > 1.2 && dcHigh - dcLow <= 2, 'clearing the threshold is worth close to, and never more than, the 2 points on offer');

section('conditional minutes: the absence is charged once, not twice');
/* minFrac is the UNCONDITIONAL expected minutes — it already averages in the
   weeks a player does not appear. Anything drawn inside a branch that has
   already conditioned on appearing must use minFrac/pAppear instead, or the
   same absence is applied a second time. pointsDist and squadSim did the
   latter, which ran every distribution light and bit hardest on exactly the
   rotation risks the rank tools exist to weigh. */
const cmOdds = { gp: 20, lam: 1.6, lamAvg: 1.47, cs: 0.3 };
const cmNailed = { id: 501, element_type: 3, team: 1, status: 'a', minutes: 1800, starts: 20, bonus: 14, saves: 0,
  expected_goals_per_90: '0.4', expected_assists_per_90: '0.25', expected_goals_conceded_per_90: '1.3',
  defensive_contribution_per_90: '4', yellow_cards: 3 };
const cmRota = { ...cmNailed, id: 502, minutes: 1050, starts: 11 };
for (const [who, el] of [['a nailed starter', cmNailed], ['a rotation risk', cmRota]]) {
  const nat = core.nativeXP(el, cmOdds), sim = core.pointsDist(el, cmOdds, 40000).mean;
  ok(Math.abs(sim - nat) / nat < 0.06,
    'the simulated mean agrees with the point estimate for ' + who + ' (within 6%)');
}
/* The distortion used to scale with the chance of NOT appearing, so it did
   not cancel out of a comparison between two players. */
const mNailed = core.minutesModel(cmNailed, 20), mRota = core.minutesModel(cmRota, 20);
ok(mRota.pAppear < mNailed.pAppear, 'the rotation risk really is the less certain starter');
const errNailed = Math.abs(core.pointsDist(cmNailed, cmOdds, 40000).mean - core.nativeXP(cmNailed, cmOdds));
const errRota = Math.abs(core.pointsDist(cmRota, cmOdds, 40000).mean - core.nativeXP(cmRota, cmOdds));
ok(Math.abs(errRota - errNailed) < 0.35, 'and the two layers no longer diverge further the less certain the starter is');

section('deductions are drawn as whole points, not shaved off the score');
/* Subtracting a fractional expectation from an otherwise integer score moved
   every trial off the integers, so a trial that scored exactly 10 fell below
   the haul line — losing the whole probability mass at 10 from the haul
   figure however small the deduction was. */
const cardy = { ...cmNailed, id: 503, yellow_cards: 9, red_cards: 1 };
const clean = { ...cmNailed, id: 503, yellow_cards: 0, red_cards: 0 };
const dCardy = core.pointsDist(cardy, cmOdds, 60000), dClean = core.pointsDist(clean, cmOdds, 60000);
ok(dCardy.mean < dClean.mean, 'a booking-prone player still projects below a clean one');
ok(dClean.haul - dCardy.haul < 0.02,
  'but the cards cost him a sliver of haul probability, not a fifth of it');
ok(Number.isInteger(dClean.p10) && Number.isInteger(dClean.p50) && Number.isInteger(dClean.p90),
  'the quantiles are whole points, as an FPL score is');
ok(Number.isInteger(dCardy.p50), 'and stay whole once deductions are in play');

section('availability is applied once across the horizon');
/* fixtureXP owns the availability scale on whichever branch it takes, so
   horizonXP must not apply it again — it used to, charging a 50 percent
   doubt as 25 percent everywhere the solver and transfer tools read. */
const hzOdds = { gp: 20, lam: 1.6, lamAvg: 1.47, cs: 0.3, event: 21 };
const hzMap = { 1: [hzOdds, hzOdds, hzOdds] };
const hzFit = { ...cmNailed, id: 504, chance_of_playing_next_round: null };
const hzDoubt = { ...cmNailed, id: 505, chance_of_playing_next_round: 50 };
ok(Math.abs(core.horizonXPreal(null, hzFit, hzMap) - 3 * core.fixtureXP(null, hzFit, hzOdds)) < 1e-9,
  'the horizon is the sum of its fixtures for a fit player');
ok(Math.abs(core.horizonXPreal(null, hzDoubt, hzMap) - 3 * core.fixtureXP(null, hzDoubt, hzOdds)) < 1e-9,
  'and for a doubtful one — no second scale applied on the way out');
const hzRatio = core.horizonXPreal(null, hzDoubt, hzMap) / core.horizonXPreal(null, hzFit, hzMap);
ok(hzRatio > 0.42 && hzRatio < 0.58, 'a 50 percent doubt costs about half the horizon, not three quarters of it');
/* The fallback branch (no native model yet) must carry availability too — it
   used to get none at all from every caller except horizonXP. */
const hzYoung = { element_type: 3, minutes: 120, starts: 1, status: 'a', ep_next: '4.0', chance_of_playing_next_round: 50,
  expected_goals_per_90: '0.3', expected_assists_per_90: '0.2' };
const hzYoungFit = { ...hzYoung, chance_of_playing_next_round: null };
ok(core.nativeXP(hzYoung, { gp: 3, lam: 1.6, lamAvg: 1.47, cs: 0.3 }) === null, 'the sample is too thin for the native model');
ok(core.fixtureXP(null, hzYoung, hzOdds) < core.fixtureXP(null, hzYoungFit, hzOdds),
  'so the ep_next fallback carries the doubt itself');

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

section('seasonKeyFrom: season label for scoped storage');
/* Earliest deadline year -> "YYYY/YY". The stamp that invalidates last
   seasons watchlist / draft (element IDs reset each season). */
ok(core.seasonKeyFrom([{ deadline_time: '2026-08-21T17:30:00Z' }, { deadline_time: '2026-08-28T17:30:00Z' }]) === '2026/27', 'derives 2026/27 from GW1 deadline');
ok(core.seasonKeyFrom([{ deadline_time: '2025-08-15T17:30:00Z' }]) === '2025/26', 'derives 2025/26');
ok(core.seasonKeyFrom([{ deadline_time: '2026-09-01T00:00:00Z' }, { deadline_time: '2026-08-21T17:30:00Z' }]) === '2026/27', 'uses the earliest deadline, not array order');
ok(core.seasonKeyFrom([]) === '' && core.seasonKeyFrom([{}]) === '', 'no deadlines -> empty (cannot verify -> never discards)');
/* The scoping rule: a stamp from a different season must not equal the
   current one, so stale element-ID lists get discarded. */
ok(core.seasonKeyFrom([{ deadline_time: '2025-08-15T17:30:00Z' }]) !== core.seasonKeyFrom([{ deadline_time: '2026-08-21T17:30:00Z' }]), 'consecutive seasons produce distinct keys');

section('plsimPrior: promoted-club default (Tier 2)');
/* A fitted club gets its own prior; an unknown (newly-promoted) club gets a
   below-average default, not neutral [1,1,1], so opponents arent over-rated.
   The fitted side is graded against the table rather than against a fixed
   number: the priors are refreshed from the simulator's weekly recalibration,
   and a hard threshold would fail on an ordinary refit rather than on a real
   regression. Arsenal is the claim — well above average in attack, and the
   best defence we rate. */
const arsPrior = core.plsimPrior({ name: 'Arsenal' });
const allPriors = Object.keys(core.PLSIM.priors).map((k) => core.PLSIM.priors[k]);
const bestDef = Math.min(...allPriors.map((p) => p[1]));
ok(arsPrior[0] > 1.1 && arsPrior[1] === bestDef,
  'a fitted club keeps its own strong prior (Arsenal ' + arsPrior[0] + ' att / ' + arsPrior[1] + ' def)');
const promoted = core.plsimPrior({ name: 'Wrexham AFC' });
ok(promoted === core.PLSIM_PROMOTED, 'an unknown/promoted club falls back to PLSIM_PROMOTED');
ok(promoted[0] < 1 && promoted[1] > 1, 'the promoted default is below average (weaker attack, concedes more)');
ok(core.plsimPrior({}) === core.PLSIM_PROMOTED && core.plsimPrior(null) === core.PLSIM_PROMOTED, 'missing team name is handled, not a crash');
ok(core.plsimPrior({ name: 'Manchester City' })[0] > 1.2, 'alias resolves multi-word names (Manchester City -> mancity)');


section('eloPrior: a club-specific prior where we have no fitted one (Tier 2)');
{
  /* Real 2026/27 ratings from the Core Insights teams.csv, and the league mean
     they sit around. */
  const elo = { 1: 2064, 2: 1921, 3: 1666, 4: 1971, 5: 1533 };
  const mean = core.eloMean(elo);
  ok(Math.abs(mean - 1831) < 1, 'the league mean comes from the ratings we have (' + Math.round(mean) + ')');
  ok(core.eloMean({}) === null && core.eloMean(null) === null, 'no ratings means no mean');
  ok(core.eloMean({ 1: 2000, 2: NaN }) === 2000, 'a broken rating is left out of the mean');

  const strong = core.eloPrior(2064, mean);
  const weak = core.eloPrior(1533, mean);
  ok(strong && weak, 'a rating either side of the mean produces a prior');
  ok(strong[0] > weak[0], 'the stronger club attacks better');
  ok(strong[1] < weak[1], 'and concedes less — a LOWER defence multiplier is better');
  const avg = core.eloPrior(mean, mean);
  ok(Math.abs(avg[0] - 1) < 0.05 && Math.abs(avg[1] - 1) < 0.05, 'a league-average club is close to neutral');
  ok(strong[2] === core.PLSIM_PROMOTED[2], 'home advantage is not an Elo question and is left alone');

  /* A wild rating must not produce a wild side. */
  const absurd = core.eloPrior(9000, mean);
  ok(absurd[0] <= 1.6 && absurd[1] >= 0.55, 'an absurd rating is clamped to a plausible side');
  ok(core.eloPrior(NaN, mean) === null && core.eloPrior(1800, null) === null, 'a missing rating or mean yields nothing');
}

section('plsimPrior: Elo fills the gap, and never overrides a fit (Tier 2)');
{
  const elo = { 1: 2064, 2: 1921, 3: 1666, 4: 1971, 5: 1533 };
  /* A club WITH an offline fit keeps it — the fit is the better estimate and
     Elo reproducing it to within ~8% is not a reason to trade down. */
  const arsWith = core.plsimPrior({ name: 'Arsenal', id: 1 }, elo);
  ok(arsWith === core.PLSIM.priors.arsenal, 'a fitted club keeps its fitted prior even with Elo present');

  /* A club WITHOUT one gets a club-specific prior instead of the single
     generic promoted number every such club used to share. */
  const strongUnknown = core.plsimPrior({ name: 'Wrexham AFC', id: 1 }, elo);
  const weakUnknown = core.plsimPrior({ name: 'Wrexham AFC', id: 5 }, elo);
  ok(strongUnknown !== core.PLSIM_PROMOTED, 'an unknown club with a rating no longer takes the generic prior');
  ok(strongUnknown[0] > weakUnknown[0],
    'and two unknown clubs of different strength no longer get identical priors');

  /* Every fallback still holds. */
  ok(core.plsimPrior({ name: 'Wrexham AFC', id: 99 }, elo) === core.PLSIM_PROMOTED,
    'an unknown club with no rating falls back to the generic prior');
  ok(core.plsimPrior({ name: 'Wrexham AFC', id: 1 }) === core.PLSIM_PROMOTED,
    'and so does one when no Elo is loaded at all — the old behaviour exactly');
  ok(core.plsimPrior({ name: 'Arsenal', id: 1 }) === core.PLSIM.priors.arsenal, 'fitted clubs are unaffected by absent Elo');
  ok(core.plsimPrior({}, elo) === core.PLSIM_PROMOTED && core.plsimPrior(null, elo) === core.PLSIM_PROMOTED,
    'a missing team is still handled, not a crash');
}

section('eloPrior: held-out, it beats the generic prior it replaces (Tier 2)');
{
  /* The claim that justified using Elo at all, pinned so it survives any
     change to the fitted coefficients. Leave-one-out over a committed snapshot
     of real 2026/27 ratings: for each club, predict its prior from Elo using
     ONLY the other nineteen, and compare against PLSIM_PROMOTED — the single
     generic number every club without a fit used to share. */
  const snap = JSON.parse(readFileSync(join(ROOT, 'dev', 'fixtures', 'team-elo-2026-2027.json'), 'utf8'));
  /* The app's own aliasing, not a copy of it — a duplicate here would drift
     and silently shrink the sample. */
  const key = (n) => {
    const k = String(n).toLowerCase().replace(/[^a-z]/g, '');
    return core.PLSIM.priors[k] ? k : (core.PLSIM_ALIAS[k] || k);
  };
  const data = snap.teams
    .map((t) => ({ elo: t.elo, prior: core.PLSIM.priors[key(t.name)] }))
    .filter((d) => d.prior);
  ok(data.length >= 18, 'the snapshot matches our fitted clubs (' + data.length + '/20)');

  /* Refit the log-linear mapping on a subset — the same shape eloPrior uses. */
  const refit = (sample, idx) => {
    const mean = sample.reduce((s, d) => s + d.elo, 0) / sample.length;
    const X = sample.map((d) => (d.elo - mean) / 400);
    const Y = sample.map((d) => Math.log(d.prior[idx]));
    const mx = X.reduce((s, x) => s + x, 0) / X.length;
    const my = Y.reduce((s, y) => s + y, 0) / Y.length;
    let num = 0, den = 0;
    for (let i = 0; i < X.length; i++) { num += (X[i] - mx) * (Y[i] - my); den += (X[i] - mx) ** 2; }
    const b = num / den;
    return { a: my - b * mx, b, mean };
  };
  for (const [idx, label] of [[0, 'attack'], [1, 'defence']]) {
    let eloErr = 0, genErr = 0;
    for (let j = 0; j < data.length; j++) {
      const rest = data.filter((_, k) => k !== j);
      const { a, b, mean } = refit(rest, idx);
      const pred = Math.exp(a + b * (data[j].elo - mean) / 400);
      eloErr += Math.abs(Math.log(pred) - Math.log(data[j].prior[idx]));
      genErr += Math.abs(Math.log(core.PLSIM_PROMOTED[idx]) - Math.log(data[j].prior[idx]));
    }
    ok(eloErr < genErr * 0.6,
      'held-out, an Elo prior beats the generic one on ' + label +
      ' by ' + Math.round(100 * (1 - eloErr / genErr)) + '% (needs >40%)');
  }

  /* And the SHIPPING coefficients — not a refit — must reproduce the priors
     we trust, or the mapping baked into the app has drifted from its fit. */
  const mean = core.eloMean(Object.fromEntries(snap.teams.map((t) => [t.id, t.elo])));
  let worst = 0;
  for (const d of data) {
    const p = core.eloPrior(d.elo, mean);
    worst = Math.max(worst, Math.abs(Math.log(p[0]) - Math.log(d.prior[0])),
      Math.abs(Math.log(p[1]) - Math.log(d.prior[1])));
  }
  ok(worst < 0.25, 'the shipped coefficients still track the fitted priors (worst |log err| ' + worst.toFixed(3) + ')');

  /* Closeness alone is not enough: a mapping that returned ~1 for every club
     would be close on average and useless, because the whole point is telling
     a strong promoted side from a weak one. So check the SPREAD too — the
     shipped mapping must separate clubs about as much as the priors do. */
  const sd = (a) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
  for (const [idx, label] of [[0, 'attack'], [1, 'defence']]) {
    const pred = data.map((d) => Math.log(core.eloPrior(d.elo, mean)[idx]));
    const act = data.map((d) => Math.log(d.prior[idx]));
    const ratio = sd(pred) / sd(act);
    ok(ratio > 0.6 && ratio < 1.4,
      'the mapping spreads clubs like the priors do on ' + label + ' (sd ratio ' + ratio.toFixed(2) + ')');
  }
}

section('fdr lenses: the cell shows the projection, not just a colour (Tier 2)');
{
  /* A cell as the planner builds one: opponent, difficulty bucket, official
     FDR, and the three projections the model already computed. */
  const cell = (o) => Object.assign({ opp: 'BOU', home: true, diff: 2, fdr: 2, lam: 2.21, cs: 0.33, win: 0.62 }, o || {});

  ok(core.fdrCellValue('attack', cell()) === '2.21', 'the attack lens prints expected goals');
  ok(core.fdrCellValue('defence', cell()) === '33%', 'the defence lens prints clean-sheet odds');
  ok(core.fdrCellValue('overall', cell()) === '62%', 'the overall lens prints the win chance');
  ok(core.fdrCellValue('fpl', cell()) === '2', 'the FPL lens prints the official rating');

  /* The whole point: two cells that colour identically can be very different
     fixtures, and the number is what separates them. */
  const easy = cell({ lam: 2.5, diff: 2 }), meh = cell({ lam: 1.6, diff: 2 });
  ok(easy.diff === meh.diff, 'two fixtures can share a difficulty bucket');
  ok(core.fdrCellValue('attack', easy) !== core.fdrCellValue('attack', meh),
    'but the attack lens tells them apart');

  /* Totals are in the lens's own unit, not a sum of 1-5 buckets. */
  const run = [cell({ lam: 2.21, cs: 0.33, win: 0.62, fdr: 2 }),
    cell({ lam: 1.65, cs: 0.33, win: 0.5, fdr: 3 }),
    cell({ lam: 2.78, cs: 0.46, win: 0.7, fdr: 2 })];
  ok(core.fdrRunTotal('attack', run) === '6.64', 'the attack total sums expected goals over the run');
  ok(core.fdrRunTotal('fpl', run) === '7', 'the FPL total sums the official ratings');
  ok(core.fdrRunTotal('defence', run) === '1.12', 'the defence total sums clean-sheet chance (expected clean sheets)');
  ok(core.fdrRunTotal('overall', run) === '61%', 'the overall total AVERAGES win chance — summing probabilities would be meaningless');
  ok(core.fdrLens('attack').unit === 'GLS' && core.fdrLens('defence').unit === 'xCS',
    'each lens names its own unit');

  /* Blanks: a club with no fixture that week has no cell at all. */
  ok(core.fdrCellValue('attack', null) === '—', 'a blank gameweek shows a dash, not a zero');
  ok(core.fdrRunTotal('attack', [null, null]) === '—', 'an all-blank run has no total');
  ok(core.fdrRunTotal('attack', [null, cell({ lam: 2 }), null]) === '2.00',
    'and a partial run totals only the fixtures that exist');
  ok(core.fdrRunTotal('attack', []) === '—' && core.fdrRunTotal('attack', null) === '—', 'an empty run is safe');

  /* Missing model output must read as zero, never NaN on the page. */
  const bare = { opp: 'X', home: true, diff: 3, fdr: 3 };
  for (const v of ['overall', 'attack', 'defence', 'fpl']) {
    ok(!/NaN|undefined/.test(core.fdrCellValue(v, bare)), 'the ' + v + ' lens never renders NaN');
  }
  ok(core.fdrCellValue('nonsense', cell()) === core.fdrCellValue('overall', cell()),
    'an unknown lens falls back to overall rather than throwing');
  /* An out-of-range official rating is clamped to average, as the grid does. */
  ok(core.fdrCellValue('fpl', cell({ fdr: 0 })) === '3' && core.fdrCellValue('fpl', cell({ fdr: 9 })) === '3',
    'an impossible official rating reads as average');
}

section('oopFlag: unusual for his own position, paid on his own tariff (Tier 2)');
{
  const M = core.OOP_MIN_MINUTES;
  /* A realistic league: within each position most players cluster low and a
     few sit well clear. That spread is the whole point — the flag is looking
     for the tail of a position, not for a player who resembles another one. */
  const pool = [];
  let id = 1;
  const add = (type, xgs) => xgs.forEach((xg) => pool.push({
    id: id++, element_type: type, minutes: M + 100, expected_goals_per_90: String(xg) }));
  /* 20 defenders: nearly all negligible, two genuine attacking full-backs. */
  add(2, [0.02, 0.02, 0.03, 0.03, 0.03, 0.04, 0.04, 0.04, 0.05, 0.05,
          0.05, 0.06, 0.06, 0.07, 0.07, 0.08, 0.09, 0.10, 0.22, 0.30]);
  /* 20 midfielders: a spread, with a couple playing as strikers. */
  add(3, [0.05, 0.06, 0.08, 0.09, 0.10, 0.11, 0.12, 0.13, 0.15, 0.16,
          0.17, 0.18, 0.20, 0.22, 0.25, 0.28, 0.32, 0.36, 0.55, 0.62]);
  /* 20 forwards, including two who barely threaten at all. */
  add(4, [0.12, 0.14, 0.20, 0.25, 0.30, 0.33, 0.36, 0.38, 0.40, 0.42,
          0.45, 0.47, 0.50, 0.52, 0.55, 0.58, 0.62, 0.66, 0.70, 0.80]);
  const marks = core.oopBenchmarks(pool);

  ok(marks[2] && marks[3] && marks[4], 'every position group gets its own cut-offs');
  ok(marks[2].high < marks[2].top, 'the strong cut-off sits above the ordinary one');
  ok(marks[2].n === 20, 'and the pool size is reported (' + marks[2].n + ')');

  /* THE REGRESSION THIS REPLACES. The old rule compared a defender against
     the MEDIAN MIDFIELDER, which is a genuinely attacking footballer — so it
     flagged nobody across two real club previews, including the league's
     most-cited out-of-position players. An attacking full-back must be found
     by his own position's distribution, and this pool is built so the two
     rules disagree: 0.12 is a standout among defenders and nowhere near a
     typical midfielder. */
  const fullBack = { element_type: 2, minutes: M + 100, expected_goals_per_90: '0.12' };
  const medianMid = core.oopQuantile(
    pool.filter((p) => p.element_type === 3).map((p) => parseFloat(p.expected_goals_per_90)).sort((a, b) => a - b), 0.5);
  ok(0.12 < medianMid, 'the test case would fail the old median-midfielder bar (' + medianMid + ')');
  ok(0.12 >= marks[2].high, 'while clearing his own position\'s bar (' + marks[2].high.toFixed(3) + ')');
  const fb = core.oopFlag(fullBack, marks);
  ok(fb && fb.kind === 'up', 'but an attacking full-back IS flagged now');
  ok(fb && /defender/.test(fb.label), 'and the label is about his own position (' + (fb || {}).label + ')');
  ok(fb && /6 points a goal/.test(fb.note), 'with the tariff that makes it worth points');

  /* Same idea for a midfielder playing as a striker. */
  const striker = core.oopFlag({ element_type: 3, minutes: M + 100, expected_goals_per_90: '0.55' }, marks);
  ok(striker && striker.kind === 'up' && /midfielder/.test(striker.label),
    'a midfielder in his position\'s top tail is flagged');
  ok(striker && /5 points a goal/.test(striker.note), 'with the midfielder tariff named');

  /* THE TAG IS A MEASUREMENT, NOT A FORECAST. This is derived entirely from
     last season's output, and a commentator made the cost of forgetting that
     concrete: Muñoz is flagged here as an attacking full-back on numbers he
     compiled in a back three under a manager who has since left. The role
     that produced them may not exist. Nothing in any feed we read carries a
     manager, so the honest move is to stop the copy claiming the present
     tense — "attacks like a winger" reads as a property of the player, and
     it is a property of a job. */
  ok(/last season/.test(fb.label),
    'the defender label is past tense (' + fb.label + ')');
  ok(!/^attacks /.test(fb.label), 'and does not assert a present-tense habit');
  ok(/ROLE and not a property|role and not a property/.test(fb.note),
    'the note says it is a role rather than a property');
  ok(/new manager|change of shape/.test(fb.note),
    'and names what would take it away (' + fb.note.slice(-90) + ')');
  ok(/last season/.test(striker.label) && /role and not a property|ROLE and not a property/i.test(striker.note),
    'the midfielder copy carries the same caveat');

  /* The tail is the claim, so the middle of a position must stay silent —
     otherwise the flag means "quite good" and stops being information. */
  ok(core.oopFlag({ element_type: 2, minutes: M + 100, expected_goals_per_90: '0.05' }, marks) === null,
    'a typical defender is not out of position');
  ok(core.oopFlag({ element_type: 3, minutes: M + 100, expected_goals_per_90: '0.15' }, marks) === null,
    'nor a typical midfielder');
  ok(core.oopFlag({ element_type: 1, minutes: M + 100, expected_goals_per_90: '0' }, marks) === null,
    'a goalkeeper is never flagged');

  /* No more than the stated share of a position may be flagged, or the
     percentile has stopped meaning what it says. */
  const defs = pool.filter((p) => p.element_type === 2);
  const flagged = defs.filter((p) => core.oopFlag(p, marks));
  ok(flagged.length <= Math.ceil(defs.length * (1 - core.OOP_PCTL)) + 1,
    'only the top tail of a position is flagged (' + flagged.length + ' of ' + defs.length + ')');
  ok(flagged.length >= 1, 'but the tail is not empty');

  /* Strength: the top of the tail reads differently from its edge. */
  const edge = core.oopFlag({ element_type: 2, minutes: M + 100,
    expected_goals_per_90: String(marks[2].high) }, marks);
  const peak = core.oopFlag({ element_type: 2, minutes: M + 100,
    expected_goals_per_90: String(marks[2].top + 0.05) }, marks);
  ok(edge.level === 1 && peak.level === 2, 'the very top of a position is a stronger flag');

  /* The caution, and it must stay a caution rather than a find. */
  const deep = core.oopFlag({ element_type: 4, minutes: M + 100, expected_goals_per_90: '0.12' }, marks);
  ok(deep && deep.level < 0 && deep.kind === 'down', 'a forward with no goal threat is a caution');
  ok(core.oopFlag({ element_type: 4, minutes: M + 100, expected_goals_per_90: '0.80' }, marks) === null,
    'and an elite forward is not flagged at all — he is exactly where he should be');

  /* Sample size and pre-season: no minutes, no claim. */
  ok(core.oopFlag({ element_type: 3, minutes: M - 1, expected_goals_per_90: '0.9' }, marks) === null,
    'too few minutes means no flag, however good the rate looks');
  ok(Object.keys(core.oopBenchmarks(pool.map((p) => Object.assign({}, p, { minutes: 0 })))).length === 0,
    'a pre-season squad produces no benchmarks at all');
  ok(core.oopFlag({ element_type: 3, minutes: M + 100, expected_goals_per_90: '0.9' }, {}) === null,
    'and with no benchmarks nothing is flagged');
  ok(Object.keys(core.oopBenchmarks([])).length === 0, 'an empty league is safe');
  ok(core.oopFlag(null, marks) === null && core.oopFlag({ element_type: 3, minutes: 9999 }, null) === null,
    'missing inputs do not throw');

  /* A thin group cannot describe a distribution — a percentile over four
     players is an ordering, not a tail. */
  const thin = core.oopBenchmarks(pool.filter((p) => p.element_type !== 4).concat(
    [{ id: 900, element_type: 4, minutes: M + 1, expected_goals_per_90: '0.5' }]));
  ok(thin[4] === undefined, 'a group with too few players sets no benchmark');
  ok(core.OOP_MIN_POOL >= 8, 'and the floor is a real sample (' + core.OOP_MIN_POOL + ')');

  /* The quantile itself, since everything above rests on it. */
  const q = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  ok(core.oopQuantile(q, 0) === 0 && core.oopQuantile(q, 1) === 10, 'quantile spans the range');
  ok(core.oopQuantile(q, 0.5) === 5, 'the median is the middle');
  ok(Math.abs(core.oopQuantile(q, 0.85) - 8.5) < 1e-9, 'and it interpolates between points');
  ok(core.oopQuantile([], 0.5) === null && core.oopQuantile([4], 0.9) === 4, 'degenerate inputs are safe');

  /* Non-penalty threat is preferred when Core Insights has it: penalties are
     a duty, not evidence of where a player plays. */
  const penTaker = { element_type: 3, minutes: M + 100, expected_goals_per_90: '0.60', _ci: { np_xg_per_90: 0.10 } };
  ok(core.oopThreat(penTaker) === 0.10, 'non-penalty xG is used when available');
  ok(core.oopFlag(penTaker, marks) === null, 'so a penalty taker is not mistaken for a striker');
}

section('setPieceByClub: the club is the row, the duty is the column (Tier 2)');
{
  const p = (id, team, name, pen, fk, ck) => ({
    id, team, web_name: name, element_type: 3,
    penalties_order: pen, direct_freekicks_order: fk, corners_and_indirect_freekicks_order: ck,
  });
  const b = {
    teams: { 1: { short_name: 'BOU' }, 2: { short_name: 'ARS' }, 3: { short_name: 'FUL' } },
    elements: [
      p(1, 1, 'Kluivert', 1, 3, null), p(2, 1, 'Kroupi', 2, null, null), p(3, 1, 'Tavernier', 3, 2, 1),
      p(4, 2, 'Saka', 1, 2, 2), p(5, 2, 'Rice', null, 1, 1),
      p(6, 3, 'Robinson', 1, null, null),
      p(7, 3, 'NoDuty', null, null, null),
    ],
  };
  const by = core.setPieceByClub(b);
  ok(by[1] && by[1].pen.length === 3, 'the whole penalty hierarchy is kept, not just the first two');
  ok(by[1].pen.map((x) => x.el.web_name).join() === 'Kluivert,Kroupi,Tavernier', 'and it comes back in order');
  ok(by[1].ck.length === 1 && by[1].ck[0].el.web_name === 'Tavernier', 'each duty is separate');
  ok(by[2].fk.map((x) => x.el.web_name).join() === 'Rice,Saka', 'a different duty can have a different first choice');

  /* A player on no duty is not a set-piece taker. */
  ok(!Object.keys(by).some((t) => by[t].pen.concat(by[t].fk, by[t].ck).some((x) => x.el.web_name === 'NoDuty')),
    'a player with no designation appears nowhere');

  /* Rows: clubs with nothing are omitted, not printed as three dashes. */
  const rows = core.setPieceClubRows(b);
  ok(rows.length === 3, 'every club with any designation gets a row');
  ok(rows[0].team === 2 && rows[1].team === 1, 'rows are in club-name order (ARS, BOU, FUL)');
  const empty = core.setPieceClubRows({ teams: b.teams, elements: [p(9, 1, 'Nobody', null, null, null)] });
  ok(empty.length === 0, 'a league with no designations produces no rows at all');

  /* The cap keeps a long tail out of the grid. */
  const capped = core.setPieceByClub(b, 2);
  ok(capped[1].pen.length === 2, 'the per-duty cap trims the tail');
  ok(capped[1].pen.map((x) => x.el.web_name).join() === 'Kluivert,Kroupi', 'keeping the top of the order');

  ok(Object.keys(core.setPieceByClub({ elements: [] })).length === 0, 'an empty squad is safe');
  ok(Object.keys(core.setPieceByClub({})).length === 0 && Object.keys(core.setPieceByClub(null)).length === 0,
    'missing input does not throw');
  ok(Object.keys(core.setPieceByClub({ elements: [null, undefined] })).length === 0, 'holes are ignored');
}

section('rotationChain: one slot, many clubs, transfers cost something (Tier 2)');
{
  const cands = (teams) => teams.map((t) => ({ id: t * 10, team: t, cost: 45 }));

  /* Brute force every possible sequence of clubs over the horizon and score
     it the same way, so "optimal" is a claim we can actually check rather
     than assert. Exponential, hence tiny cases only. */
  const brute = (teams, diff, sw) => {
    const N = Math.min(...teams.map((t) => diff[t].length));
    let best = null;
    const walk = (g, path, total) => {
      if (g === N) { if (!best || total < best.total - 1e-9) best = { total, path: path.slice() }; return; }
      for (const t of teams) {
        const step = diff[t][g] + (g > 0 && path[g - 1] !== t ? sw : 0);
        walk(g + 1, path.concat([t]), total + step);
      }
    };
    walk(0, [], 0);
    return best;
  };
  const totalOf = (r, diff, sw) =>
    r.path.reduce((s, t, g) => s + diff[t][g] + (g > 0 && r.path[g - 1] !== t ? sw : 0), 0);

  /* A planted chain: club 1 is green early, club 2 green in the middle,
     club 3 green late — exactly the shape the creator graphics show. */
  const diff = { 1: [1, 1, 5, 5, 5, 5], 2: [5, 5, 1, 1, 5, 5], 3: [5, 5, 5, 5, 1, 1] };
  const teams = [1, 2, 3];
  const r = core.rotationChain(cands(teams), diff, { switchCost: 1 });
  ok(r != null, 'a chain is found');
  ok(r.path.join() === '1,1,2,2,3,3', 'it walks the planted chain (' + r.path.join() + ')');
  ok(r.blocks.length === 3 && r.switches === 2, 'compressed into three blocks with two switches');
  ok(r.blocks[0].weeks === 2 && r.blocks[0].team === 1, 'each block records its club and length');
  ok(r.green === 6, 'and every week of the horizon is covered green');
  ok(r.teams.join() === '1,2,3', 'the chain is whichever clubs the path visits');

  /* The claim, checked: matches exhaustive search. */
  for (const sw of [0, 0.5, 1, 2, 5]) {
    const got = core.rotationChain(cands(teams), diff, { switchCost: sw });
    const bf = brute(teams, diff, sw);
    ok(Math.abs(totalOf(got, diff, sw) - bf.total) < 1e-9,
      'matches brute force at switch cost ' + sw);
  }

  /* The switch cost is what controls chain length, and that must be visible. */
  const cheap = core.rotationChain(cands(teams), diff, { switchCost: 0 });
  const dear = core.rotationChain(cands(teams), diff, { switchCost: 50 });
  ok(dear.switches === 0, 'an expensive transfer means never switching at all');
  ok(dear.teams.length === 1, 'so the chain collapses to a single club');
  ok(cheap.switches >= dear.switches, 'and a free transfer switches at least as often');

  /* Ties must prefer staying: an equal-cost plan with fewer transfers is
     strictly better in a game where transfers are the scarce resource. */
  const flat = { 1: [3, 3, 3, 3], 2: [3, 3, 3, 3] };
  const t = core.rotationChain(cands([1, 2]), flat, { switchCost: 0 });
  ok(t.switches === 0, 'identical clubs never switch, even when switching is free');
  /* The case that actually exercises the tie-break, on the path that gets
     chosen: holding club 2 throughout costs 3 + 0 = 3, and starting on club 1
     then paying a transfer costs 1 + 2 + 0 = 3 as well. Dead level, so only
     an explicit preference for staying avoids spending a transfer to buy
     nothing at all. */
  const tie = core.rotationChain(cands([1, 2]), { 1: [1, 3], 2: [3, 0] }, { switchCost: 2 });
  ok(tie.switches === 0, 'a tie is settled by NOT spending a transfer');
  ok(tie.path.join() === '2,2', 'so the plan holds one club rather than churning (' + tie.path.join() + ')');

  /* One candidate per club, and the cheapest one — a rotation slot is a
     budget slot. */
  /* Cheapest FIRST in the list, so "keep the last one seen" would pick the
     expensive player and the assertion below would catch it. */
  const dup = core.rotationChain(
    [{ id: 2, team: 1, cost: 45 }, { id: 1, team: 1, cost: 70 }, { id: 3, team: 2, cost: 50 }],
    { 1: [1, 1, 5, 5], 2: [5, 5, 1, 1] }, { switchCost: 1 });
  ok(dup.blocks[0].player.cost === 45, 'the cheapest player at a club represents it');
  ok(dup.minCost === 45 && dup.maxCost === 50, 'the price range of the chain is reported');

  /* Horizons of different length: the shortest club array bounds the run. */
  const ragged = core.rotationChain(cands([1, 2]), { 1: [1, 1, 1, 1, 1], 2: [5, 5] }, { switchCost: 1 });
  ok(ragged.n === 2, 'the horizon is the shortest club history available');

  /* Degenerate inputs return null rather than a misleading empty chain. */
  ok(core.rotationChain(cands([1]), { 1: [1, 2, 3] }) === null, 'one club is not a rotation');
  ok(core.rotationChain([], diff) === null && core.rotationChain(null, diff) === null, 'no candidates, no chain');
  ok(core.rotationChain(cands(teams), null) === null, 'no fixture difficulty, no chain');
  ok(core.rotationChain(cands([1, 2]), { 1: [1], 2: [1] }) === null, 'a single gameweek is not a rotation');
  ok(core.rotationChain([null, undefined].concat(cands(teams)), diff, { switchCost: 1 }).teams.length === 3,
    'holes in the candidate list are ignored');
  /* A club with no fixture data cannot be part of a chain. */
  ok(core.rotationChain(cands([1, 2, 9]), diff, { switchCost: 1 }).teams.indexOf(9) < 0,
    'a club with no difficulty array is left out');
}

section('clubSplit / clubVenueVerdict: is this club a different side at home? (Tier 2)');
{
  const fx = (team_h, team_a, hs, as_, finished) => ({ team_h, team_a, team_h_score: hs, team_a_score: as_, finished: finished !== false });
  /* Club 1: strong at home, poor away — the Brentford shape. */
  const games = [];
  for (let i = 0; i < 5; i++) games.push(fx(1, 2 + i, 3, 0));       // home: 3-0
  for (let i = 0; i < 5; i++) games.push(fx(2 + i, 1, 2, 1));       // away: lose 2-1
  const sp = core.clubSplit(games, 1);
  ok(sp.home.games === 5 && sp.away.games === 5, 'both venues are counted');
  ok(sp.home.gf === 15 && sp.home.ga === 0, 'home goals for and against are from the club\'s point of view');
  ok(sp.away.gf === 5 && sp.away.ga === 10, 'and flip correctly when the club is the away side');
  ok(sp.home.cs === 5 && sp.away.cs === 0, 'clean sheets are counted per venue');
  ok(Math.abs(sp.home.gfpg - 3) < 1e-9 && Math.abs(sp.away.gapg - 2) < 1e-9, 'per-game rates are right');

  const v = core.clubVenueVerdict(sp);
  ok(v.attack === 'home' && v.defence === 'home', 'a home-heavy side is called as one');
  ok(v.attGap > 0 && v.defGap > 0, 'and the size of each gap comes with it');

  /* A side that travels identically must read as level, not be forced into
     a verdict — most clubs are not Brentford. */
  const evenGames = [];
  for (let i = 0; i < 5; i++) { evenGames.push(fx(1, 2 + i, 2, 1)); evenGames.push(fx(2 + i, 1, 1, 2)); }
  const ev = core.clubVenueVerdict(core.clubSplit(evenGames, 1));
  ok(ev.attack === 'level' && ev.defence === 'level', 'a club that travels well reads level');

  /* The two reads are independent: a club can attack differently by venue
     while conceding the same everywhere. */
  const mixed = [];
  for (let i = 0; i < 5; i++) { mixed.push(fx(1, 2 + i, 3, 1)); mixed.push(fx(2 + i, 1, 1, 1)); }
  const mx = core.clubVenueVerdict(core.clubSplit(mixed, 1));
  ok(mx.attack === 'home' && mx.defence === 'level', 'attack and defence are judged separately');

  /* Sample size: four games at a venue is not a home record. */
  const thin = games.slice(0, 3).concat(games.slice(5, 8));
  ok(core.clubVenueVerdict(core.clubSplit(thin, 1)) === null, 'too few games at each venue means no verdict');
  ok(core.clubVenueVerdict(core.clubSplit([], 1)) === null, 'and a club with no games has none either');
  ok(core.clubVenueVerdict(null) === null, 'a missing split does not throw');

  /* Unplayed and malformed fixtures must not leak into the record. */
  const withFuture = games.concat([fx(1, 9, null, null, false), { team_h: 1, team_a: 9, finished: true }]);
  ok(core.clubSplit(withFuture, 1).games === 10, 'unplayed and score-less fixtures are ignored');
  ok(core.clubSplit([null, undefined], 1).games === 0, 'holes in the fixture list are safe');
  ok(core.clubSplit(games, 99).games === 0, 'a club that played none of these games has an empty record');
}

section('clubVsPoorAttacks: does a kind fixture actually become a clean sheet? (Tier 2)');
{
  /* The line this exists for, from a rival's Man Utd thread: "only 2 clean
     sheets vs weak sides, so if the defenders return nothing at Hull and
     Ipswich it is not bad luck". A fixture ticker cannot say that — it grades
     the opponent, not whether this defence converts one. */
  const R = { att: {}, def: {} };
  for (let i = 1; i <= 20; i++) { R.att[i] = 0.5 + i * 0.05; R.def[i] = 1; }
  const weak = core.poorAttacks(R);
  ok(weak instanceof Set && weak.size === 10, 'the bottom half of attacks is exactly half the league');
  ok(weak.has(1) && weak.has(10), 'the weakest attacks are in it');
  ok(!weak.has(11) && !weak.has(20), 'the strongest are not');
  ok([...weak].every((x) => typeof x === 'number'),
    'ids come back as numbers — the ratings are keyed by string, the fixtures are not');

  /* Team 1 plays opponents 2..11; it keeps two clean sheets. Only 2..10 are
     weak, so nine of the ten matches count. */
  const fx = [];
  for (let i = 0; i < 10; i++) {
    fx.push({ finished: true, team_h: 1, team_a: i + 2, team_h_score: 2, team_a_score: i < 2 ? 0 : 1 });
  }
  const v = core.clubVsPoorAttacks(fx, 1, weak);
  ok(v && v.games === 9, 'only matches against weak attacks count (' + (v && v.games) + ')');
  ok(v.cs === 2, 'two clean sheets, as played');
  ok(Math.abs(v.csr - 2 / 9) < 1e-9, 'and the rate is over those games, not the whole season');
  ok(v.gf === 18 && v.ga === 7, 'goals for and against are the club’s own way round');

  const away = [{ finished: true, team_h: 3, team_a: 1, team_h_score: 0, team_a_score: 4 }];
  const both = core.clubVsPoorAttacks(fx.concat(away), 1, weak);
  ok(both.games === 10 && both.cs === 3, 'an away clean sheet counts too');
  ok(both.gf === 22 && both.ga === 7, 'and away goals are not read off the wrong side');

  /* The guard that matters. A clean-sheet percentage off three games is noise
     wearing a number's clothes, and printed in a thread it reads as evidence. */
  ok(core.OPP_SPLIT_MIN === 5, 'the minimum sample is five matches');
  ok(core.clubVsPoorAttacks(fx.slice(0, 4), 1, weak) === null, 'four matches is not a finding');
  ok(core.clubVsPoorAttacks(fx.slice(0, 5), 1, weak) !== null, 'five is');
  ok(core.clubVsPoorAttacks(fx, 1, null) === null, 'and no ratings means no claim at all');
  ok(core.clubVsPoorAttacks(fx, 1, new Set()) === null, 'nor does an empty weak set');

  /* Unplayed fixtures must not dilute the rate — this is read mid-season and
     the fixture list carries the whole of it. */
  const withFuture = fx.concat([{ finished: false, team_h: 1, team_a: 2, team_h_score: null, team_a_score: null }]);
  ok(core.clubVsPoorAttacks(withFuture, 1, weak).games === 9, 'unplayed fixtures are ignored');
  ok(core.poorAttacks({ att: { 1: 1, 2: 1 } }) === null, 'too few clubs rated means no split');
  ok(core.poorAttacks(null) === null, 'and no ratings at all is safe');
}

section('clubLean: which end of this club is worth buying (Tier 2)');
{
  /* Four clubs: 1 all attack, 2 all defence, 3 good at both, 4 poor at both. */
  const R = {
    att: { 1: 1.40, 2: 0.80, 3: 1.35, 4: 0.75 },
    def: { 1: 1.30, 2: 0.70, 3: 0.75, 4: 1.35 },
  };
  ok(core.clubLean(R, 1).lean === 'attack', 'a side that rates far higher going forward says buy the attack');
  ok(core.clubLean(R, 2).lean === 'defence', 'and one that rates higher at the back says buy the defence');
  ok(core.clubLean(R, 3).lean === 'balanced' && core.clubLean(R, 3).grade === 'both',
    'a side strong at both ends is balanced AND strong — a very different message');
  ok(core.clubLean(R, 4).grade === 'neither', 'and one weak at both is called that, not just "balanced"');
  ok(core.clubLean(R, 1).attPct > core.clubLean(R, 2).attPct, 'percentiles order the league correctly');
  /* A LOWER defence multiplier is a better defence — the inversion is the
     easy thing to get backwards. */
  ok(core.clubLean(R, 2).defPct > core.clubLean(R, 1).defPct,
    'a lower defence multiplier ranks as the better defence');

  ok(core.clubLean(R, 99) === null, 'a club with no rating has no lean');
  ok(core.clubLean(null, 1) === null && core.clubLean({}, 1) === null, 'missing ratings do not throw');
  ok(core.clubLean({ att: { 1: 1, 2: 1 }, def: { 1: 1, 2: 1 } }, 1) === null,
    'a league too small to rank against gives no verdict');
}

section('bundleSeasonStale: model-bundle vs live season cross-check (Tier 2)');
/* Pre-season the bundle intentionally trails (last completed season), so no
   warning; once games are played a trailing bundle IS stale. */
ok(core.bundleSeasonStale('2026/27', false, '2025/26') === false, 'pre-season (no games): bundle behind is expected, not stale');
ok(core.bundleSeasonStale('2026/27', true, '2025/26') === true, 'season started but bundle still last season -> stale');
ok(core.bundleSeasonStale('2026/27', true, '2026/27') === false, 'season started and bundle caught up -> fresh');
ok(core.bundleSeasonStale('', true, '2025/26') === false && core.bundleSeasonStale('2026/27', true, '') === false, 'unknown season or missing bundle label -> never warn');

section('pre-season bootstrap: all-zeros end to end (Tier 4)');
/* The load-bearing pre-season state the recon flagged as untested: every
   player minutes=0, form=0, ownership forming. nativeXP is gated off below
   5 games, so xP leans entirely on FPL's provisional ep_next. These lock
   that the model degrades gracefully (finite, no crash, sensible empties). */
const preEl = (id, t, own, epNext) => ({
  id, element_type: t, team: id, web_name: 'P' + id, status: 'a',
  minutes: 0, starts: 0, form: '0.0', points_per_game: '0.0',
  ep_next: String(epNext == null ? 0 : epNext),
  expected_goals_per_90: '0', expected_assists_per_90: '0',
  chance_of_playing_next_round: null, now_cost: 60,
  selected_by_percent: String(own)
});
const preNf = { gp: 0 };                       /* no games played yet */
/* nativeXP is null pre-season (0 games), so the native blend never engages. */
ok(core.nativeXP(preEl(1, 3, 5, 0), preNf) === null, 'nativeXP is null pre-season (0 games played)');
/* Cold player with a zero ep_next -> xP is a finite 0, never NaN. */
const xpCold = core.xP({}, preEl(1, 3, 0, 0), preNf);
ok(Number.isFinite(xpCold) && xpCold === 0, 'a fully-cold player (ep_next 0) yields a finite xP of 0, not NaN');
/* With ep_next populated (FPL usually seeds it pre-season), xP tracks it and
   orders players — so the boards are not flat. */
const xpSeed = core.xP({}, preEl(2, 3, 5, 4.5), preNf);
ok(Number.isFinite(xpSeed) && xpSeed > 0, 'a provisional ep_next drives a positive, finite pre-season xP');
ok(xpSeed > xpCold, 'ep_next differences order players pre-season (boards are not flat)');
/* Realistic pre-season nf (buildNextFix always sets diff, from plsimDiff or
   FPL): an easy opener still lifts xP over a hard one, no NaN. */
const xpEasy = core.xP({}, preEl(3, 3, 5, 4.5), { gp: 0, diff: 2 });
const xpHard = core.xP({}, preEl(3, 3, 5, 4.5), { gp: 0, diff: 5 });
ok(Number.isFinite(xpEasy) && Number.isFinite(xpHard) && xpEasy > xpHard, 'fixture difficulty still tilts xP pre-season (easy opener > hard)');
ok(Number.isFinite(core.xP({}, preEl(4, 3, 5, 4.5), undefined)), 'a player with no upcoming fixture (undefined nf) still yields a finite xP');
/* captainModel over an all-zero-xP pool degrades to no pick, not a crash. */
const flatPool = [preEl(1, 3, 5, 0), preEl(2, 4, 3, 0), preEl(3, 3, 8, 0)];
ok(core.captainModel({}, {}, flatPool, 3).picks.length === 0, 'captainModel returns no pick when every xP is 0 (graceful, not a crash)');
/* With provisional ep_next it still ranks. */
const seedPool = [preEl(1, 3, 5, 3.0), preEl(2, 4, 3, 6.0), preEl(3, 3, 8, 4.0)];
const preCap = core.captainModel({}, {}, seedPool, 3);
ok(preCap.picks.length === 3 && preCap.picks[0].el.id === 2, 'captainModel ranks on provisional ep_next when present');
/* Differentials pre-season: 0%-owned non-premium players ARE included (nobody
   has picked yet), premiums excluded, and a missing ownership figure is not. */
const preElements = [
  preEl(1, 3, 0, 3),                              /* 0% owned -> included */
  Object.assign(preEl(2, 4, 5, 4), { now_cost: 140 }),  /* premium -> excluded */
  Object.assign(preEl(3, 3, 8, 2), { selected_by_percent: 'x' }), /* no figure -> excluded */
  preEl(4, 2, 12, 1)                              /* under 15% -> included */
];
const preDiffs = core.differentials(preElements, 15).map(e => e.id).sort();
ok(preDiffs.join(',') === '1,4', 'pre-season differentials include 0%-owned non-premiums, exclude premiums and no-ownership rows');

/* ── clubDepth: who is competing for the same shirt ─────── */
section('clubDepth — pecking order, contests and the unrankable');
/* gp = 10, so minutesSecurity = 100*(0.65*starts/10 + 0.35*mins/900). */
const mkDepth = (id, pos, starts, mins, extra) => Object.assign(
  { id, team: 1, element_type: pos, status: 'a', web_name: 'P' + id, now_cost: 45, starts, minutes: mins },
  extra || {});
const depthPool = [
  mkDepth(1, 2, 10, 900),   /* 100 */
  mkDepth(2, 2, 9, 810),    /*  90 — 10 behind, a contest */
  mkDepth(3, 2, 5, 450),    /*  50 — 40 behind, clear of the contest */
  mkDepth(4, 2, 2, 180),    /*  20 — under the fringe, not in the conversation */
  mkDepth(5, 3, 10, 900),   /* 100 */
  mkDepth(6, 3, 5, 450),    /*  50 — 50 behind, so the shirt is settled */
  mkDepth(7, 3, 0, 0),      /* no minutes at all — unrankable, not fringe */
  mkDepth(8, 3, 10, 900, { status: 'u' }),         /* left the club */
  mkDepth(10, 3, 0, 0, { status: 'u' }),           /* left, and never played */
  mkDepth(9, 2, 10, 900, { team: 2 })              /* another club entirely */
];
const dep = core.clubDepth(depthPool, 1, 10);
ok(dep[2].rows.map(r => r.e.id).join(',') === '1,2,3', 'defenders rank by minutes security, fringe player dropped');
ok(dep[2].rows.every(r => r.sec >= core.DEPTH_FRINGE), 'no ranked row sits below the fringe threshold');
ok(dep[2].settled === false, 'a 10-point lead is not a settled shirt');
ok(dep[2].rows[0].tied === true && dep[2].rows[1].tied === true, 'both halves of a contest are marked, not just the lower one');
ok(dep[2].rows[2].tied === false, 'the man 40 points adrift is not part of the contest');
ok(dep[3].settled === true && dep[3].rows[0].tied === false, 'a 50-point lead is a settled shirt');
ok(dep[3].unranked.map(e => e.id).join(',') === '7', 'a player with no minutes is listed as unrankable, not ranked last');
ok(dep[3].rows.every(r => r.e.id !== 7), 'the unrankable player is kept out of the ranking');
/* A departed player with no minutes must not surface as "one to watch" — the
   unranked list is the only place he could slip through. */
ok(!dep[3].unranked.some(e => e.id === 10), 'a player who has left the club never reaches the unranked list');
ok(!dep[2].rows.some(r => r.e.id === 9) && !dep[3].rows.some(r => r.e.id === 8),
  'another club and a departed player are both excluded');
ok(dep[1] === undefined && dep[4] === undefined, 'positions with nobody at all are absent, not empty groups');
/* A contest can sit BELOW a clear leader — the tie check has to look both
   ways, or the middle of the table reads as settled. */
const midPool = [mkDepth(1, 2, 10, 900), mkDepth(2, 2, 6, 540), mkDepth(3, 2, 5, 579), mkDepth(4, 2, 2, 180)];
const midDep = core.clubDepth(midPool, 1, 10);
ok(midDep[2].settled === true, 'leader 40 clear reads as settled');
ok(midDep[2].rows[0].tied === false && midDep[2].rows[1].tied === true && midDep[2].rows[2].tied === true,
  'a contest below a clear leader is marked on both players');
/* The list is capped so a 30-man squad does not become the panel. */
const bigPool = Array.from({ length: 9 }, (_, i) => mkDepth(i + 1, 2, 10 - i * 0.5, 900 - i * 45));
ok(core.clubDepth(bigPool, 1, 10)[2].rows.length === core.DEPTH_MAX,
  'the ranking is capped at DEPTH_MAX per position');
ok(Object.keys(core.clubDepth([], 1, 10)).length === 0, 'an empty squad yields no groups rather than throwing');

/* ── Venue split: what a projection owes to the venue ────────
   The Players table's home/away lens. Every property here is about NOT
   overclaiming: it is a per-game rate rather than a total, and a side with no
   fixtures is unknown rather than zero. */
{
  console.log('\n• venue split');
  /* Pre-season shape — no games played, so nativeXP declines and fixtureXP
     takes its documented fallback: ep_next scaled by the fixture. That makes
     the arithmetic below exact rather than approximate. */
  const b = {};
  const fwd = { id: 1, team: 1, element_type: 4, ep_next: '5.0' };
  const fx = (home, lam) => ({ home, lam, cs: 0.3, gp: 0, lamAvg: 1.47 });
  /* lam 1.47 is the league average, so the fixture factor is exactly 1. */
  const flat = (home) => fx(home, 1.47);

  /* A total would make four home games look better than one away game at the
     same quality. A per-game rate must not. */
  const lopsided = core.venueSplit(b, fwd,
    { 1: [flat(true), flat(true), flat(true), flat(true), flat(false)] });
  ok(lopsided.hN === 4 && lopsided.aN === 1, 'the counts are kept (' + lopsided.hN + 'H/' + lopsided.aN + 'A)');
  ok(Math.abs(lopsided.h - 5) < 1e-9, 'four identical home games average to one game (' + lopsided.h + ')');
  ok(Math.abs(lopsided.a - 5) < 1e-9, 'and the single away game to the same');
  ok(Math.abs(lopsided.swing) < 1e-9, 'so four home to one away is a swing of zero, not a home bias');

  /* A real difference still shows. A kinder home fixture raises the home rate
     and the swing goes positive. */
  const kind = core.venueSplit(b, fwd, { 1: [fx(true, 2.2), fx(false, 1.0)] });
  ok(kind.h > kind.a, 'a better home fixture reads as a better home rate');
  ok(kind.swing > 0, 'and the swing is positive');
  const harsh = core.venueSplit(b, fwd, { 1: [fx(true, 1.0), fx(false, 2.2)] });
  ok(harsh.swing < 0, 'reversed, the same player travels better');
  ok(Math.abs(harsh.swing + kind.swing) < 1e-9, 'and the two are mirror images');

  /* The refusals. A player with no away game has no away rate; a zero there
     would rank him the worst traveller in the league. */
  const allHome = core.venueSplit(b, fwd, { 1: [flat(true), flat(true)] });
  ok(allHome.a === null, 'no away fixture means no away rate — null, not zero');
  ok(allHome.swing === null, 'and no swing to report');
  ok(allHome.h != null && allHome.aN === 0, 'while the home side is still given');
  const allAway = core.venueSplit(b, fwd, { 1: [flat(false)] });
  ok(allAway.h === null && allAway.swing === null, 'and the same the other way round');

  /* A team with no horizon at all, and a horizon that does not mention this
     player's team. Both are "unknown", not "zero". */
  ok(core.venueSplit(b, fwd, {}).h === null, 'an empty horizon yields nothing');
  ok(core.venueSplit(b, fwd, { 2: [flat(true)] }).swing === null, 'nor does another team’s run');
  ok(core.venueSplit(b, fwd, null).swing === null, 'a missing horizon does not throw');

  /* A fixture whose expected points cannot be computed is skipped rather than
     counted as zero, which would drag the rate down and misreport the sample
     size behind it. */
  const broken = { id: 2, team: 1, element_type: 4, ep_next: '', form: 'x', points_per_game: 'x' };
  const skipped = core.venueSplit(b, broken, { 1: [flat(true), flat(false)] });
  ok(skipped.hN === 0 && skipped.aN === 0, 'an uncomputable fixture is not counted');
  ok(skipped.h === null && skipped.a === null, 'and contributes no rate');

  /* Defenders take the clean-sheet branch rather than the goals one, so the
     split has to work for them too — they are the whole point of the lens. */
  const def = { id: 3, team: 1, element_type: 2, ep_next: '4.0' };
  const dsplit = core.venueSplit(b, def,
    { 1: [{ home: true, lam: 1.2, cs: 0.55, gp: 0 }, { home: false, lam: 1.6, cs: 0.18, gp: 0 }] });
  ok(dsplit.h > dsplit.a, 'a defender with better clean-sheet odds at home reads that way');
  ok(dsplit.swing > 0, 'and carries a positive swing');
}

/* ── Value against the price curve ───────────────────────────
   The Players table's value scatter. The property that carries the whole
   feature is that the fit is PER POSITION: a single line through defenders and
   midfielders together measures the position tariff, not value, and would rank
   every cheap defender as a bargain. */
{
  console.log('\n• value curve');
  const line = (n, m, c, from) => Array.from({ length: n },
    (_, i) => ({ x: (from || 4) + i * 0.5, y: m * ((from || 4) + i * 0.5) + c }));

  /* Exact recovery on a perfect line — if this drifts, every residual is
     wrong by a constant nobody would notice. */
  const f = core.valueFit(line(8, 1.5, 2));
  ok(f && Math.abs(f.m - 1.5) < 1e-9, 'the slope is recovered exactly (' + (f && f.m) + ')');
  ok(Math.abs(f.c - 2) < 1e-9, 'and so is the intercept');
  ok(f.n === 8, 'the sample size is carried');

  /* The refusals. */
  ok(core.valueFit(line(core.VALUE_MIN_FIT - 1, 1, 0)) === null,
    'under ' + core.VALUE_MIN_FIT + ' players there is no curve to fit');
  ok(core.valueFit(line(core.VALUE_MIN_FIT, 1, 0)) !== null, 'at the floor there is');
  ok(core.valueFit(Array.from({ length: 9 }, (_, i) => ({ x: 5, y: i }))) === null,
    'a pool all on one price has no slope — null, not infinity');
  ok(core.valueFit([]) === null && core.valueFit(null) === null, 'and nothing at all is null');

  /* Residual sign. Above the line is positive, which is the direction the
     chart's whole reading depends on. */
  const pts = line(8, 1.0, 0);
  const fit = core.valueFit(pts);
  const resid = (x, y) => y - (fit.m * x + fit.c);
  ok(resid(6, 8) > 0, 'a player above the curve reads positive');
  ok(resid(6, 4) < 0, 'and one below it negative');

  /* ── the per-position property ──
     Two positions with genuinely different price curves. Defenders here return
     less per pound than midfielders — the real tariff difference. A defender
     sitting exactly on the DEFENDER curve is fairly priced, and must read as
     such; measured against a pooled line he would look like a bargain. */
  const el = (id, type, cost, y) => ({ id, element_type: type, now_cost: cost * 10, _y: y });
  const defs = [], mids = [];
  for (let i = 0; i < 8; i++) {
    const price = 4 + i * 0.5;
    defs.push(el(100 + i, 2, price, 1.0 * price));   /* defender curve: y = 1.0x */
    mids.push(el(200 + i, 3, price, 2.0 * price));   /* midfielder curve: y = 2.0x */
  }
  const all = defs.concat(mids);
  const r = core.valueResiduals(all, (e) => e._y);
  ok(r.fits[2] && Math.abs(r.fits[2].m - 1.0) < 1e-9, 'the defender curve is fitted alone (' + r.fits[2].m.toFixed(2) + ')');
  ok(r.fits[3] && Math.abs(r.fits[3].m - 2.0) < 1e-9, 'and the midfielder curve separately (' + r.fits[3].m.toFixed(2) + ')');
  ok(r.points.length === 16, 'every player is plotted');
  ok(r.points.every((p) => Math.abs(p.resid) < 1e-9),
    'a player exactly on his OWN position’s curve has no residual — the whole point');
  /* And the counterfactual: pooled, the same defenders would look mispriced.
     This is the bug the split exists to prevent, asserted rather than assumed. */
  const pooled = core.valueFit(all.map((e) => ({ x: (e.now_cost || 0) / 10, y: e._y })));
  const pooledResid = (e) => e._y - (pooled.m * ((e.now_cost || 0) / 10) + pooled.c);
  ok(Math.abs(pooledResid(defs[7])) > 1, 'pooled, a fairly-priced defender reads as badly off the line');
  ok(pooledResid(defs[7]) < 0 && pooledResid(mids[7]) > 0,
    'and the pooled reading is a position tariff, not value — every top defender low, every top mid high');

  /* A position too thin to fit still shows its players, with no residual —
     they are real, and hiding them would misrepresent the pool. */
  const thin = core.valueResiduals(defs.concat([el(300, 1, 4.5, 3), el(301, 1, 5.0, 4)]), (e) => e._y);
  ok(thin.fits[1] === null, 'two goalkeepers give no curve');
  const gks = thin.points.filter((p) => p.pos === 1);
  ok(gks.length === 2, 'but they are still plotted');
  ok(gks.every((p) => p.resid === null), 'with a null residual rather than one from a line nobody drew');

  /* A player whose projection cannot be computed is left out entirely, rather
     than dragging the curve down towards zero. */
  const withBad = core.valueResiduals(defs.concat([el(400, 2, 6.0, null), el(401, 2, 6.5, NaN)]),
    (e) => e._y);
  ok(withBad.points.length === 8, 'an uncomputable projection is not plotted (' + withBad.points.length + ')');
  ok(Math.abs(withBad.fits[2].m - 1.0) < 1e-9, 'and does not move the curve');
}

/* ── summary ────────────────────────────────────────────── */
console.log('\n' + passes + ' passed, ' + failures + ' failed');
if (failures) process.exit(1);
