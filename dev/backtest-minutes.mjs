/*
 * Minutes backtest: grades the SHIPPING minutesModel (learned, see
 * dev/fit-minutes.mjs) against a frozen copy of the hand-weighted blend it
 * replaced, on 2025-26, a season the fit never saw.
 *
 * Both are given the same point-in-time inputs and no availability flags
 * (vaastav carries none), so this measures the part that changed: how well
 * each turns a player's minutes history into P(start), P(appear) and
 * P(60+ minutes). Flags and congestion are applied identically on top of
 * either in the app.
 *
 *   node dev/backtest-minutes.mjs                  # committed sample
 *   node dev/backtest-minutes.mjs --make-sample    # rebuild it from the full season
 *
 * Skips cleanly (exit 0) when no fixture is present.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractBlock, extractFn } from './extract.mjs';
import { parseCsvLine, loadRows, examples, score, MINUTES_COLUMNS } from './minutes-data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEASON = '2025-26';
const dir = join(ROOT, 'dev', 'fixtures', 'vaastav', SEASON);
const full = join(dir, 'merged_gw.csv'), sample = join(dir, 'minutes.sample.csv');

if (process.argv.includes('--make-sample')) {
  /* One player in five, every column the minutes model reads. Sampling
     players, not rows, keeps each player's history whole; with roughly five
     sampled players per club per fixture, every club fixture is still seen,
     so club games played (the denominator) is exact. */
  const lines = readFileSync(full, 'utf8').split('\n').filter(Boolean);
  const head = parseCsvLine(lines[0]); const idx = MINUTES_COLUMNS.map((k) => head.indexOf(k));
  const out = [MINUTES_COLUMNS.join(',')];
  for (const l of lines.slice(1)) {
    const c = parseCsvLine(l);
    if (parseInt(c[idx[0]], 10) % 5 !== 0) continue;
    out.push(idx.map((i) => (/[",]/.test(c[i]) ? '"' + c[i].replace(/"/g, '""') + '"' : c[i])).join(','));
  }
  writeFileSync(sample, out.join('\n') + '\n');
  console.log(`wrote ${sample} (${out.length - 1} rows)`); process.exit(0);
}

const path = existsSync(full) ? full : existsSync(sample) ? sample : null;
if (!path) { console.log(`• minutes backtest: no ${SEASON} fixture, skipping.`); process.exit(0); }

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const constLine = (n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); };
const constBlock = (n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n};', i) + 3); };
const app = new Function([
  ...['CONGEST_FULL', 'CONGEST_FADE', 'CONGEST_MAX', 'CONGEST_NAILED', 'CONGEST_TO_BENCH', 'MINUTES_BENCHED', 'MINUTES_SUB60'].map(constLine),
  constLine('MINUTES_W'),
  extractBlock(html, html.indexOf('function congestionFactor(')),
  ...['recentMinutes', 'minutesFeatures', 'minutesProbs', 'minutesLegacy', 'overrideLive', 'minutesModel'].map((n) => extractFn(html, n)),
].join('\n') + '\nreturn {recentMinutes, minutesModel, overrideLive};')();

/* The model this replaced, frozen as it shipped (index.html before the
   learned model), availability 1 and no congestion. */
function legacy(el, gp) {
  let startShare = Math.min(1, (el.starts || 0) / gp), minShare = Math.min(1, (el.minutes || 0) / (gp * 90));
  if (el._recent && el._recent.n >= 2) {
    const w = Math.min(0.6, 0.15 * el._recent.n);
    startShare = (1 - w) * startShare + w * el._recent.startShare;
    minShare = (1 - w) * minShare + w * el._recent.minShare;
  }
  const startEff = Math.max(startShare, Math.max(0, (minShare - 0.15) / 0.85));
  const perStart = (el.starts || 0) > 0 ? Math.min(1, (el.minutes || 0) / (el.starts * 90)) : 0.9;
  const cameo = Math.max(0, minShare - startEff * perStart);
  const pStart = Math.min(1, startEff);
  return { start: pStart, app: Math.min(1, pStart + cameo), p60: Math.min(1, pStart * Math.max(0.8, perStart / 0.9)) };
}

const ex = examples(loadRows(path), app.recentMinutes);
const avail = { status: 'a', chance_of_playing_next_round: null };
let failures = 0;
const ok = (c, label) => { if (!c) { failures++; console.error('  ✗ ' + label); } };
const f4 = (x) => x.toFixed(4);
console.log(`• minutes backtest, ${SEASON} (${path === full ? 'full season' : 'committed sample'}), learned vs the blend it replaced`);
for (const [label, rows, strip] of [
  ['season totals only (most of the pool)', ex, true],
  ['with recent fixtures (squad, candidates)', ex.filter((e) => e.el._recent), false],
]) {
  console.log(`  ${label}, n=${rows.length}`);
  const els = rows.map((e) => ({ ...avail, ...e.el, _recent: strip ? null : e.el._recent }));
  const L = els.map((el, i) => app.minutesModel(el, rows[i].gp, null));
  const O = els.map((el, i) => legacy(el, rows[i].gp));
  for (const [tgt, key] of [['start', 'pStart'], ['app', 'pAppear'], ['p60', 'p60']]) {
    const ys = rows.map((e) => e.y[tgt]);
    const n = score(L.map((m) => m[key]), ys), o = score(O.map((m) => m[tgt]), ys);
    const meanP = L.reduce((s, m) => s + m[key], 0) / L.length, meanY = ys.reduce((s, y) => s + y, 0) / ys.length;
    console.log(`    ${tgt.padEnd(5)} Brier ${f4(o.brier)} -> ${f4(n.brier)}   log loss ${f4(o.ll)} -> ${f4(n.ll)}   AUC ${o.auc.toFixed(3)} -> ${n.auc.toFixed(3)}   mean ${meanP.toFixed(3)} vs actual ${meanY.toFixed(3)}`);
    ok(n.brier < o.brier, `${label}: ${tgt} Brier beats the old blend`);
    ok(n.ll < o.ll, `${label}: ${tgt} log loss beats the old blend`);
    ok(Math.abs(meanP - meanY) < 0.03, `${label}: ${tgt} is calibrated on average (${meanP.toFixed(3)} vs ${meanY.toFixed(3)})`);
  }
}

/* The learned path, not the fallback, is what runs. */
const srcs = new Set(ex.slice(0, 200).map((e) => app.minutesModel({ ...avail, ...e.el }, e.gp, null).src));
ok(!srcs.has('legacy'), 'weights match the features, so the legacy fallback never runs');

/* Overrides: out means out; benched uses the measured rates; a passed date expires. */
const nailed = { ...avail, starts: 10, minutes: 900, element_type: 3, now_cost: 80 };
const base = app.minutesModel(nailed, 10, null);
const out = app.minutesModel({ ...nailed, _ovr: { kind: 'out' } }, 10, null);
const bench = app.minutesModel({ ...nailed, _ovr: { kind: 'benched' } }, 10, null);
const expired = app.minutesModel({ ...nailed, _ovr: { kind: 'out', until: '2000-01-01' } }, 10, null);
ok(base.pStart > 0.8, `a nailed starter is expected to start (${base.pStart.toFixed(3)})`);
ok(out.pAppear === 0 && out.pStart === 0 && out.src === 'override', 'an "out" override removes him');
ok(bench.pStart < 0.3 && bench.pAppear > bench.pStart && bench.src === 'override', 'a "benched" override keeps a cameo but drops the start');
ok(Math.abs(expired.pStart - base.pStart) < 1e-12, 'an override past its date no longer applies');
ok(app.overrideLive({ kind: 'out', until: '2026-10-10' }, Date.parse('2026-10-09T23:00:00')), 'an override is live the day before its date');
ok(!app.overrideLive({ kind: 'out', until: '2026-10-10' }, Date.parse('2026-10-10T00:00:01')), 'and expires as that day begins');
ok(!app.overrideLive({ kind: 'nonsense' }), 'an unknown kind is ignored');

console.log(failures ? `\n${failures} check(s) failed` : '\nchecks passed');
process.exit(failures ? 1 : 0);
