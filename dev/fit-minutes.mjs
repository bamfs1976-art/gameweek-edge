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
  [extractFn(html, 'recentMinutes'), extractFn(html, 'minutesFeatures')].join('\n') +
  '\nreturn {recentMinutes, minutesFeatures};')();

const seasonPath = (s) => join(ROOT, 'dev', 'fixtures', 'vaastav', s, 'merged_gw.csv');
for (const s of [...TRAIN, TEST]) if (!existsSync(seasonPath(s))) {
  console.error(`missing ${seasonPath(s)}: run node dev/fetch-vaastav.mjs ${s}`); process.exit(1);
}
const ex = (s) => examples(loadRows(seasonPath(s)), app.recentMinutes);
const train = TRAIN.flatMap(ex), test = ex(TEST);

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
const dropped = train.filter((e) => e.el._recent && e.el._recent.n >= 2 && e.el.starts / e.gp >= 0.6
  && e.el._recent.lastStart === 0 && e.el._recent.prevStart === 0);
const rate = (k) => Math.round(dropped.reduce((s, e) => s + e.y[k], 0) / dropped.length * 1000) / 1000;
const benched = { set: 'override', start: rate('start'), app: rate('app'), p60: rate('p60') };

console.log(`• learned minutes model, fitted on ${TRAIN.join(', ')} (${train.length} player-fixtures)`);
for (const l of report) console.log(l);
console.log(`  "lost his place" sample n=${dropped.length}: next game start ${benched.start}, appear ${benched.app}, 60+ ${benched.p60}`);

const fmt = (o) => `{start:[${o.start.join(',')}],app:[${o.app.join(',')}],p60:[${o.p60.join(',')}]}`;
/* One line, so every harness that lifts constants line by line gets all of it. */
const block = `const MINUTES_W={base:${fmt(W.base)},recent:${fmt(W.recent)}};`;
const benchedLine = `const MINUTES_BENCHED={set:'override',start:${benched.start},app:${benched.app},p60:${benched.p60}};`;
if (process.argv.includes('--write')) {
  const a = html.indexOf('const MINUTES_W={'), b = html.indexOf('\n', a);
  const c = html.indexOf('const MINUTES_BENCHED='), d = html.indexOf('\n', c);
  if (a < 0 || c < 0) { console.error('could not find MINUTES_W / MINUTES_BENCHED in index.html'); process.exit(1); }
  html = html.slice(0, a) + block + html.slice(b);
  const c2 = html.indexOf('const MINUTES_BENCHED='), d2 = html.indexOf('\n', c2);
  html = html.slice(0, c2) + benchedLine + html.slice(d2);
  writeFileSync(htmlPath, html);
  console.log('  wrote MINUTES_W and MINUTES_BENCHED into index.html');
} else {
  console.log('\n' + block + '\n' + benchedLine);
}
