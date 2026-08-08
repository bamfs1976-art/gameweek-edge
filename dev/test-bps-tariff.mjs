/*
 * BPS tariff guard — derived from real matches, not from a published table.
 *
 * Why this exists.
 *
 * baselineBps() works by subtraction: it takes a player's total BPS and
 * removes the BPS his returns earned him, leaving the open-play component
 * (passes, tackles, recoveries, clearances) that predicts bonus BEFORE he
 * scores. That design is deliberately robust — when FPL changed the
 * clearances rate and dropped the tackled-deduction for 2026/27, both changes
 * flowed through the residual with no code change at all.
 *
 * The exposure is the constants we DO hardcode. And one of them was wrong for
 * as long as the function has existed: the code paid 2 BPS per THREE saves.
 * That is the points rule (1 FPL point per 3 saves) borrowed into a tariff
 * that actually pays every save. It under-subtracted a keeper's save BPS
 * threefold, inflating his baseline and pushing goalkeepers up the
 * bonus-magnet board for a reason that was arithmetic rather than football.
 *
 * Reading a table off a website would not have caught it — I tried, and the
 * summaries available contradicted both each other and the code, including
 * one that transposed the goal tariff entirely. So this test does not consult
 * a table. It solves the tariff out of 29,725 real player-matches and checks
 * the code against the answer.
 *
 * Run: node dev/test-bps-tariff.mjs   (wired into npm test)
 *
 * Uses the committed sample, so CI needs no network. Run
 * `node dev/fetch-vaastav.mjs` for the full season locally.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/* ---- the tariff, read out of the shipped app ----
   Evaluated from index.html rather than restated here: a test carrying its own
   copy of the constants passes happily while the app says something else. */
function constSource(src, name) {
  const idx = src.indexOf('const ' + name + '=');
  assert.ok(idx >= 0, `const ${name} not found in index.html`);
  let depth = 0;
  for (let i = idx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(idx, i + 1) + ';'; }
  }
  throw new Error(`unbalanced braces reading ${name}`);
}
function fnSource(src, name) {
  const idx = src.indexOf('function ' + name + '(');
  assert.ok(idx >= 0, `function ${name} not found in index.html`);
  let depth = 0, started = false;
  for (let i = idx; i < src.length; i++) {
    if (src[i] === '{') { depth++; started = true; }
    else if (src[i] === '}') { depth--; if (started && depth === 0) return src.slice(idx, i + 1); }
  }
  throw new Error(`unbalanced braces reading ${name}`);
}
/* Both the constant AND the function that consumes it. Pulling only the
   constant and re-implementing the arithmetic here would let the formula
   drift while the test kept passing — which is precisely the failure this
   file exists to prevent, and the first draft of it fell in. */
const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  constSource(html, 'BPS_TARIFF') + '\n' + fnSource(html, 'bpsFromReturns') +
  '\n;globalThis.__t = BPS_TARIFF; globalThis.__f = bpsFromReturns;', ctx);
const BPS_TARIFF = vm.runInContext('__t', ctx);
const bpsFromReturns = vm.runInContext('__f', ctx);
assert.ok(BPS_TARIFF && BPS_TARIFF.goal, 'could not read BPS_TARIFF out of index.html');
assert.equal(typeof bpsFromReturns, 'function', 'could not read bpsFromReturns out of index.html');

/* ---- real matches ---- */
const dir = join(ROOT, 'dev', 'fixtures', 'vaastav', '2023-24');
const full = join(dir, 'merged_gw.csv');
const sample = join(dir, 'merged_gw.sample.csv');
const path = existsSync(full) ? full : sample;
assert.ok(existsSync(path), `no vaastav fixture at ${sample} — run node dev/fetch-vaastav.mjs`);

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (const c of line) {
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
const lines = readFileSync(path, 'utf8').split('\n');
const head = splitCsv(lines[0]).map((h) => h.trim());
const ix = Object.fromEntries(head.map((h, i) => [h, i]));
for (const col of ['position', 'minutes', 'bps', 'saves', 'clean_sheets', 'penalties_saved',
  'goals_scored', 'assists', 'yellow_cards', 'red_cards', 'own_goals', 'penalties_missed']) {
  assert.ok(ix[col] != null, `fixture is missing the ${col} column — re-run dev/fetch-vaastav.mjs`);
}
const POS = { GK: 1, GKP: 1, DEF: 2, MID: 3, FWD: 4 };
const rows = [];
for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  const c = splitCsv(lines[i]);
  const pos = POS[(c[ix.position] || '').trim()];
  const minutes = +c[ix.minutes] || 0;
  if (!pos || minutes < 60) continue;      // full-ish games: appearance BPS is then constant
  const num = (k) => +c[ix[k]] || 0;
  rows.push({
    pos, minutes, bps: num('bps'), saves: num('saves'), cs: num('clean_sheets'),
    ps: num('penalties_saved'), g: num('goals_scored'), a: num('assists'),
    yc: num('yellow_cards'), rc: num('red_cards'), og: num('own_goals'), pm: num('penalties_missed')
  });
}
assert.ok(rows.length > 1200,
  `only ${rows.length} usable rows — fixture looks truncated. The committed 1-in-5 sample
   yields ~1700; the full season ~7900.`);

/* ---- solve the goalkeeper tariff by least squares ----
   bps ~ intercept + b1*saves + b2*cleanSheet + b3*penaltySaved
   A keeper's open-play BPS barely varies, so the intercept absorbs it and the
   slopes come out clean. */
function solve(X, y) {
  const n = X[0].length;
  const A = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => X.reduce((s, x) => s + x[i] * x[j], 0)));
  const b = Array.from({ length: n }, (_, i) => X.reduce((s, x, k) => s + x[i] * y[k], 0));
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]]; [b[i], b[piv]] = [b[piv], b[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let cc = i; cc < n; cc++) A[r][cc] -= f * A[i][cc];
      b[r] -= f * b[i];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}
const gk = rows.filter((r) => r.pos === 1 && r.minutes >= 90);
assert.ok(gk.length > 100,
  `only ${gk.length} goalkeeper rows — too few to solve the tariff. The committed sample
   yields ~140, the full season ~745; below 100 the save coefficient gets too noisy.`);
const [intercept, perSave, perCleanSheet, perPenSave] =
  solve(gk.map((r) => [1, r.saves, r.cs, r.ps]), gk.map((r) => r.bps));

/* Saves: the constant that was wrong. Solved at ~2.05 across 745 real
   goalkeeper matches; the old code implied 0.67. A full point of tolerance
   still separates the two by a mile. */
assert.ok(Math.abs(perSave - BPS_TARIFF.savesBps) < 1.0,
  `saves BPS: real data says ${perSave.toFixed(2)} per save, BPS_TARIFF.savesBps is ` +
  `${BPS_TARIFF.savesBps}. If this fired after a rule change, update the constant; if it ` +
  `fired after a refactor, something reintroduced the per-3-saves points rule.`);

/* Tolerance sized for the COMMITTED SAMPLE, not the full season. 142 keeper
   rows solve this at 13.65 where 745 rows give 12.74 — that spread is sampling
   noise, so the bar has to clear it. It still bites: halving the constant to 6
   leaves a gap of 7.6. */
assert.ok(Math.abs(perCleanSheet - BPS_TARIFF.cleanSheet[1]) < 2.5,
  `clean-sheet BPS: real data says ${perCleanSheet.toFixed(2)}, tariff says ${BPS_TARIFF.cleanSheet[1]}`);

/* penSave is NOT asserted, and that is a deliberate gap. A whole season holds
   about eight penalty saves, so the solved coefficient (reported below) is
   too thin to fail a build on — it lands near 15, but on a sample that small
   it would land near anything. Removing the penSave term entirely survives
   this file's mutation testing for exactly that reason. If it ever matters,
   the fix is more seasons, not a tighter threshold. */
const penSaveRows = gk.filter((r) => r.ps > 0).length;

/* ---- the goal tariff, by a property rather than a number ----
   Position-by-position least squares on goals is noisy (scorers also do more
   of everything). The robust check is an ordering that football guarantees:
   strip out every return and a DEFENDER's remaining open-play BPS must exceed
   a MIDFIELDER's, which must exceed a FORWARD's — defenders bank clearances,
   blocks and interceptions all match; strikers bank almost none.
   Invert the goal tariff and this ordering flips, which is exactly how a
   transposed table gets caught. */
/* The APP's function, on the app's own element shape — not a copy of it. */
const returns = (r) => bpsFromReturns({
  element_type: r.pos, goals_scored: r.g, assists: r.a, clean_sheets: r.cs,
  saves: r.saves, penalties_saved: r.ps, penalties_missed: r.pm,
  own_goals: r.og, yellow_cards: r.yc, red_cards: r.rc
});
const meanResidual = (p) => {
  const set = rows.filter((r) => r.pos === p && r.g > 0);
  return set.reduce((s, r) => s + (r.bps - returns(r)), 0) / set.length;
};
const [dRes, mRes, fRes] = [2, 3, 4].map(meanResidual);
assert.ok(dRes > mRes && mRes > fRes,
  `open-play BPS should fall DEF > MID > FWD, got DEF ${dRes.toFixed(1)}, ` +
  `MID ${mRes.toFixed(1)}, FWD ${fRes.toFixed(1)} — the goal tariff looks transposed`);

/* And a keeper, who touches the ball least, must bank less open play than a
   defender. This is the assertion the old saves constant failed: it put the
   two level at 14.7 apiece. */
const gkRes = gk.reduce((s, r) => s + (r.bps - returns(r)), 0) / gk.length;
assert.ok(gkRes < dRes,
  `a goalkeeper's open-play BPS (${gkRes.toFixed(1)}) should sit below a defender's ` +
  `(${dRes.toFixed(1)}) — a keeper does not out-touch a centre-back`);

/* ---- every return term must actually be subtracted ----
   The ordering checks above are blind to a uniform shift, so dropping a whole
   term (an early draft of this file lost the assist line and still passed)
   goes unnoticed. This catches it directly: strip the returns out and a player
   who did the thing once should look near-identical in OPEN PLAY to one who
   did not. Measured, the residual gap for an assist is 1.8 — real, because
   creating a chance also banks key-pass BPS — against 10.8 if the term is
   missing entirely. Anything past 5 means a term is gone or badly priced. */
const GAP_LIMIT = 5;
function residualGap(match, none) {
  const a = rows.filter(none), b = rows.filter(match);
  const mean = (s) => s.reduce((x, r) => x + (r.bps - returns(r)), 0) / s.length;
  return { gap: mean(b) - mean(a), n: b.length };
}
for (const [label, match, none] of [
  ['assist', (r) => r.pos !== 1 && r.g === 0 && r.a === 1, (r) => r.pos !== 1 && r.g === 0 && r.a === 0],
  ['goal', (r) => r.pos !== 1 && r.a === 0 && r.g === 1, (r) => r.pos !== 1 && r.a === 0 && r.g === 0],
  ['clean sheet', (r) => r.pos === 2 && r.cs === 1, (r) => r.pos === 2 && r.cs === 0]
]) {
  const { gap, n } = residualGap(match, none);
  assert.ok(n > 100, `only ${n} rows to test the ${label} term`);
  assert.ok(Math.abs(gap) < GAP_LIMIT,
    `the ${label} term leaves a ${gap.toFixed(1)} BPS residual gap over ${n} matches ` +
    `(limit ${GAP_LIMIT}) — that term is missing from bpsFromReturns or priced wrong`);
}

console.log(`BPS tariff OK: solved from ${rows.length} real player-matches ` +
  `(${gk.length} goalkeeper). Per save ${perSave.toFixed(2)} vs tariff ${BPS_TARIFF.savesBps}; ` +
  `clean sheet ${perCleanSheet.toFixed(2)} vs ${BPS_TARIFF.cleanSheet[1]}; ` +
  `open play DEF ${dRes.toFixed(1)} > MID ${mRes.toFixed(1)} > FWD ${fRes.toFixed(1)}, GK ${gkRes.toFixed(1)}. ` +
  `penSave ${perPenSave.toFixed(1)} vs ${BPS_TARIFF.penSave} — not asserted, only ${penSaveRows} rows.`);
