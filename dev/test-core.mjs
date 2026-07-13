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
  extractFn(html, 'bestXI'),
  extractFn(html, 'minutesSecurity'),
  extractFn(html, 'projectXI'),
  extractFn(aiSrc, 'fitJSON')
];
const core = new Function(
  pieces.join('\n') +
  '\nreturn {plsimMatch, esc, nativeXP, xP, priceChangeProb, bestXI, minutesSecurity, projectXI, fitJSON};'
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

/* ── summary ────────────────────────────────────────────── */
console.log('\n' + passes + ' passed, ' + failures + ' failed');
if (failures) process.exit(1);
