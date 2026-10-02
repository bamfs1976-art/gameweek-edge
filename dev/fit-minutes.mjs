/*
 * Fit the learned minutes model (MINUTES_W and MINUTES_BENCHED in index.html).
 *
 *   node dev/fetch-vaastav.mjs 2022-23   # and 2023-24, 2024-25, 2025-26
 *   node dev/fit-minutes.mjs             # fit, grade, print
 *   node dev/fit-minutes.mjs --write     # ...and write the weights into index.html
 *
 * Training seasons: 2022-23, 2023-24, 2024-25 (2021-22 and earlier have no
 * `starts` column). Test season: 2025-26, never touched by the fit, graded
 * against the frozen previous heuristic in dev/backtest-minutes.mjs.
 *
 * Logistic regression by Newton's method with a light ridge penalty (the
 * bias is not penalised). Small, explainable, and cheap to evaluate for
 * every player on every load; a tree ensemble would need a runtime the
 * single-file app does not have, for a gain nobody has shown here.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractFn } from './extract.mjs';
import { loadRows, examples, score } from './minutes-data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TRAIN = ['2022-23', '2023-24', '2024-25'];
const TEST = '2025-26';
const L2 = 1e-3;

const htmlPath = join(ROOT, 'index.html');
let html = readFileSync(htmlPath, 'utf8');
const app = new Function(
  [extractFn(html, 'recentMinutes'), extractFn(html, 'minutesFeatures'), extractFn(html, 'flagKey')].join('\n') +
  '\nreturn {recentMinutes, minutesFeatures, flagKey};')();

const seasonPath = (s) => join(ROOT, 'dev', 'fixtures', 'vaastav', s, 'merged_gw.csv');
for (const s of [...TRAIN, TEST]) if (!existsSync(seasonPath(s))) {
  console.error(`missing ${seasonPath(s)}: run node dev/fetch-vaastav.mjs ${s}`); process.exit(1);
}
/* Deadline flags from fplcache (dev/fetch-flags.mjs). The weights are fitted
   on players who carried NO flag, because the app applies a flag on top of
   them; each flag's effect is then measured against those weights. */
const flagsOf = (s) => { const f = join(ROOT, 'dev', 'fixtures', 'flags', s + '.json');
  if (!existsSync(f)) { console.error(`missing ${f}: run dev/fetch-flags.mjs`); process.exit(1); }
  return JSON.parse(readFileSync(f, 'utf8')); };
const ex = (s) => examples(loadRows(seasonPath(s)), app.recentMinutes, flagsOf(s));
/* 'a' with a chance of 100 is a player who once carried a flag and is fit:
   FPL leaves the 100 in place, so a quarter of all player-weeks carry it.
   It is not a flag. */
const unflagged = (e) => e.el.status === 'a';
const allTrain = TRAIN.flatMap(ex), allTest = ex(TEST);
/* Weights on EVERY player-fixture, flagged or not. Fitting them on fit
   players only gave sharper minutes probabilities but a worse points
   forecast end to end (MAE 1.713 -> 1.809 on 2024-25, 1.779 -> 1.871 on
   2025-26, flags applied in both): the scoring layer's own upward bias had
   been offset by the lower minutes. Until that bias is fixed, the shipped
   weights stay fitted on everyone. FIT_ONLY=1 reproduces the other fit. */
const FIT_ONLY = process.env.FIT_ONLY === '1';
const train = FIT_ONLY ? allTrain.filter(unflagged) : allTrain;
const test = FIT_ONLY ? allTest.filter(unflagged) : allTest;

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}
function fit(X, y) {
  const d = X[0].length, w = new Array(d).fill(0), N = X.length;
  for (let it = 0; it < 100; it++) {
    const g = new Array(d).fill(0), H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let n = 0; n < N; n++) {
      const x = X[n]; let z = 0; for (let a = 0; a < d; a++) z += w[a] * x[a];
      const p = 1 / (1 + Math.exp(-z)), r = p - y[n], s = p * (1 - p);
      for (let a = 0; a < d; a++) { g[a] += r * x[a]; const sa = s * x[a]; for (let b = a; b < d; b++) H[a][b] += sa * x[b]; }
    }
    for (let a = 0; a < d; a++) { if (a) { g[a] += L2 * N * w[a]; H[a][a] += L2 * N; } for (let b = 0; b < a; b++) H[a][b] = H[b][a]; }
    const step = solve(H, g); let mx = 0;
    for (let a = 0; a < d; a++) { w[a] -= step[a]; mx = Math.max(mx, Math.abs(step[a])); }
    if (mx < 1e-8) break;
  }
  return w.map((v) => Math.round(v * 1e4) / 1e4);
}
const sig = (w, x) => { let z = 0; for (let i = 0; i < w.length; i++) z += w[i] * x[i]; return 1 / (1 + Math.exp(-z)); };

/* Each example is fitted under the feature set the app would use for it: the
   'recent' set when it has fixture history, and ALWAYS the 'base' set too,
   because the app scores most of the pool from bootstrap totals alone. */
const asBase = (e) => ({ ...e.el, _recent: null });
const W = { base: {}, recent: {} };
const report = [];
for (const set of ['base', 'recent']) {
  const rows = set === 'base' ? train : train.filter((e) => e.el._recent);
  const X = rows.map((e) => app.minutesFeatures(set === 'base' ? asBase(e) : e.el, e.gp).x);
  for (const tgt of ['start', 'app', 'p60']) {
    W[set][tgt] = fit(X, rows.map((e) => e.y[tgt]));
    const T = set === 'base' ? test : test.filter((e) => e.el._recent);
    const s = score(T.map((e) => sig(W[set][tgt], app.minutesFeatures(set === 'base' ? asBase(e) : e.el, e.gp).x)), T.map((e) => e.y[tgt]));
    report.push(`  ${set.padEnd(6)} ${tgt.padEnd(5)} train n=${rows.length}  test ${TEST} n=${s.n}  log loss ${s.ll.toFixed(4)}  Brier ${s.brier.toFixed(4)}  AUC ${s.auc.toFixed(3)}`);
  }
}

/* "Lost his place": started at least 60% of his club's games, then did not
   start either of the last two. What happened next, measured. */
const dropped = allTrain.filter(unflagged).filter((e) => e.el._recent && e.el._recent.n >= 2 && e.el.starts / e.gp >= 0.6
  && e.el._recent.lastStart === 0 && e.el._recent.prevStart === 0);
/* What those rates CAN'T say is what a manager means by "benched": that he
   will not start this week, from team news. Players dropped on history alone
   start again about 40% of the time (stable across definitions), because
   history cannot tell a rotation from a lost place. So the override takes
   the manager at their word, with BENCH_TRUST of doubt that the news is
   wrong, and measures only what history can say: how often a dropped regular
   who does not start still comes on, and how often a start reaches 60. */
const BENCH_DOUBT = 0.10;
const startN = dropped.filter((e) => e.y.start).length;
const appNoStart = dropped.filter((e) => !e.y.start && e.y.app).length / Math.max(1, dropped.length - startN);
const sixtyGivenStart = dropped.filter((e) => e.y.start && e.y.p60).length / Math.max(1, startN);
const sub60 = 0.012;
const r3b = (x) => Math.round(x * 1000) / 1000;
const benched = { set: 'override', start: BENCH_DOUBT,
  app: r3b(BENCH_DOUBT + (1 - BENCH_DOUBT) * appNoStart),
  p60: r3b(BENCH_DOUBT * sixtyGivenStart + (1 - BENCH_DOUBT) * appNoStart * sub60) };
const rate = (k) => Math.round(dropped.reduce((s, e) => s + e.y[k], 0) / dropped.length * 1000) / 1000;

console.log(`• learned minutes model, fitted on ${TRAIN.join(', ')} (${train.length} player-fixtures)`);
for (const l of report) console.log(l);
console.log(`  dropped regulars on history alone, n=${dropped.length}: next game start ${rate('start')}, appear ${rate('app')}, 60+ ${rate('p60')}`);
console.log(`    of those who did not start, ${r3b(appNoStart)} came on; of those who did, ${r3b(sixtyGivenStart)} reached 60`);
console.log(`  "benched" override (manager's word, ${BENCH_DOUBT} doubt): start ${benched.start}, appear ${benched.app}, 60+ ${benched.p60}`);

/* Each flag's measured effect: real outcomes over what the unflagged model
   expected, summed over the bucket, on the training seasons. Graded on the
   test season against the old chance-of-playing rule on the same weights. */
const FLAGS = ['d75', 'd50', 'd25'];
const flagMult = {};
const probsOf = (e) => {
  const f = app.minutesFeatures(e.el, e.gp), w = W[f.set];
  return { start: sig(w.start, f.x), app: sig(w.app, f.x), p60: sig(w.p60, f.x) };
};
for (const k of FLAGS) {
  const rows = allTrain.filter((e) => app.flagKey(e.el) === k);
  const sum = { ys: 0, ya: 0, y6: 0, ps: 0, pa: 0, p6: 0 };
  for (const e of rows) { const p = probsOf(e); sum.ys += e.y.start; sum.ya += e.y.app; sum.y6 += e.y.p60; sum.ps += p.start; sum.pa += p.app; sum.p6 += p.p60; }
  const r3 = (x) => Math.round(x * 1000) / 1000;
  flagMult[k] = { start: r3(sum.ys / sum.ps), app: r3(sum.ya / sum.pa), p60: r3(sum.y6 / sum.p6) };
  const T = allTest.filter((e) => app.flagKey(e.el) === k);
  const rule = (e, t) => { const p = probsOf(e); const ch = (e.el.chance_of_playing_next_round == null ? 100 : e.el.chance_of_playing_next_round) / 100; return Math.min(1, p[t] * ch); };
  const fm = (e, t) => Math.min(1, probsOf(e)[t] * flagMult[k][t]);
  const br = (f, t) => T.reduce((s, e) => s + (f(e, t) - e.y[t]) ** 2, 0) / Math.max(1, T.length);
  console.log(`  flag ${k.padEnd(4)} train n=${rows.length} x start ${flagMult[k].start} app ${flagMult[k].app} 60+ ${flagMult[k].p60}`
    + `   test n=${T.length} Brier start ${br(rule, 'start').toFixed(4)} -> ${br(fm, 'start').toFixed(4)}, app ${br(rule, 'app').toFixed(4)} -> ${br(fm, 'app').toFixed(4)}`);
}

const fmt = (o) => `{start:[${o.start.join(',')}],app:[${o.app.join(',')}],p60:[${o.p60.join(',')}]}`;
/* One line, so every harness that lifts constants line by line gets all of it. */
const block = `const MINUTES_W={base:${fmt(W.base)},recent:${fmt(W.recent)}};`;
/* Measured and reported, NOT shipped: on 2025-26 the measured effects did
   no better than the chance-of-playing rule (75% worse, 25% better, 50%
   level) and the end-to-end points forecast was slightly worse with them.
   FLAG_EFFECTS=1 writes them anyway, for the next attempt. */
const flagLine = process.env.FLAG_EFFECTS === '1'
  ? `const MINUTES_FLAG=${JSON.stringify(flagMult).replace(/"(\w+)":/g, '$1:')};`
  : 'const MINUTES_FLAG={};';
const benchedLine = `const MINUTES_BENCHED={set:'override',start:${benched.start},app:${benched.app},p60:${benched.p60}};`;
if (process.argv.includes('--write')) {
  const a = html.indexOf('const MINUTES_W={'), b = html.indexOf('\n', a);
  const c = html.indexOf('const MINUTES_BENCHED='), d = html.indexOf('\n', c);
  if (a < 0 || c < 0) { console.error('could not find MINUTES_W / MINUTES_BENCHED in index.html'); process.exit(1); }
  html = html.slice(0, a) + block + html.slice(b);
  const c2 = html.indexOf('const MINUTES_BENCHED='), d2 = html.indexOf('\n', c2);
  html = html.slice(0, c2) + benchedLine + html.slice(d2);
  const e2 = html.indexOf('const MINUTES_FLAG='), f2 = html.indexOf('\n', e2);
  if (e2 < 0) { console.error('could not find MINUTES_FLAG in index.html'); process.exit(1); }
  html = html.slice(0, e2) + flagLine + html.slice(f2);
  writeFileSync(htmlPath, html);
  console.log('  wrote MINUTES_W and MINUTES_BENCHED into index.html');
} else {
  console.log('\n' + block + '\n' + benchedLine + '\n' + flagLine);
}
