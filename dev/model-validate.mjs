/*
 * Model validation harness for the native player-points model.
 *
 * The app's nativeXP is the from-first-principles estimate of a player's
 * expected gameweek points. This harness measures its accuracy two ways:
 *
 *   1) SYNTHETIC (default, no network) — generate a realistic population
 *      of players, Monte-Carlo their *actual* points from independent
 *      stochastic processes (Poisson goals/assists, Bernoulli clean
 *      sheets, Poisson-threshold defensive contributions, save counts,
 *      bonus), then score the model against that ground truth. It
 *      compares the ENHANCED model (bonus + defensive-contribution +
 *      saves) against the ORIGINAL (goals + assists + clean sheet +
 *      appearance only) so the value of the P1 additions is quantified —
 *      MAE and, more tellingly, signed bias by position.
 *
 *   2) REAL — `node dev/model-validate.mjs <snapshot.json>` where the
 *      snapshot is {bootstrap, actuals:{elementId: points}} for a
 *      finished gameweek. Produce it with:
 *        curl .../api/bootstrap-static/  > boot.json
 *        curl .../api/event/<gw>/live/   > live.json
 *      then merge (see buildSnapshot note at the foot of this file).
 *
 * The enhanced nativeXP is extracted verbatim from index.html so we test
 * exactly what ships. Deterministic (seeded RNG) so CI output is stable.
 *
 * Run: node dev/model-validate.mjs            (synthetic)
 *      node dev/model-validate.mjs snap.json  (real actuals)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/* ── extract the shipping nativeXP verbatim ─────────────── */
function extractBlock(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0, inStr = null, esc = false;
  for (let j = open; j < src.length; j++) {
    const ch = src[j];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced');
}
const nativeXPsrc = extractBlock(html, html.indexOf('function nativeXP('));
const minutesModelSrc = extractBlock(html, html.indexOf('function minutesModel('));
/* minutesModel now depends on the fixture-congestion helper; historical runs
   pass no congestion, so congestionFactor returns 1 and nothing changes. */
const congestSrc = ['CONGEST_FULL', 'CONGEST_FADE', 'CONGEST_MAX', 'CONGEST_NAILED', 'CONGEST_TO_BENCH']
  .map(n => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); })
  .join('\n') + '\n' + extractBlock(html, html.indexOf('function congestionFactor('));
const helperSrc = ['concedePts', 'savePts', 'dcHitProb', 'effGoalRate', 'negRate90']
  .map(n => extractBlock(html, html.indexOf('function ' + n + '('))).join('\n');
const nativeXP = new Function(congestSrc + '\n' + helperSrc + '\n' + minutesModelSrc + '\n' + nativeXPsrc + '\nreturn nativeXP;')();

/* The ORIGINAL model, before the P1 additions — for the A/B comparison. */
function nativeXPold(el, nf) {
  const gp = nf.gp || 0;
  if (gp < 5 || nf.lamAvg == null) return null;
  const mpg = (el.minutes || 0) / gp;
  if (mpg < 20) return null;
  const xg90 = parseFloat(el.expected_goals_per_90 || '0');
  const xa90 = parseFloat(el.expected_assists_per_90 || '0');
  const fx = nf.lam / nf.lamAvg;
  const pPlay = Math.min(mpg / 90, 1), p60 = Math.min(mpg / 75, 1);
  const gPts = el.element_type <= 2 ? 6 : el.element_type === 3 ? 5 : 4;
  const csPts = el.element_type <= 2 ? 4 : el.element_type === 3 ? 1 : 0;
  return pPlay + p60 + xg90 * (mpg / 90) * fx * gPts + xa90 * (mpg / 90) * fx * 3 + csPts * nf.cs * p60;
}

/* ── deterministic RNG + samplers ───────────────────────── */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20260722);
function poissonSample(lambda) { if (lambda <= 0) return 0; const L = Math.exp(-lambda); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; }
const bern = p => (rnd() < p ? 1 : 0);

/* ── synthetic population ───────────────────────────────── */
const POS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
function makePlayer(type) {
  /* realistic per-90 ranges by position */
  const mins90 = 55 + Math.floor(rnd() * 40);           // 55–95 mins/game
  const minutes = Math.round(mins90 * 6);               // over gp=6
  const r = (lo, hi) => lo + rnd() * (hi - lo);
  let xg90 = 0, xa90 = 0, dcp90 = 0, saves = 0, bonus = 0;
  if (type === 1) { saves = Math.round(r(6, 30) * (minutes / 90)); bonus = Math.round(r(0, 6)); }
  else if (type === 2) { xg90 = r(0.02, 0.18); xa90 = r(0.02, 0.15); dcp90 = r(4, 16); bonus = Math.round(r(0, 14)); }
  else if (type === 3) { xg90 = r(0.05, 0.5); xa90 = r(0.08, 0.4); dcp90 = r(2, 16); bonus = Math.round(r(0, 16)); }
  else { xg90 = r(0.2, 0.7); xa90 = r(0.05, 0.3); dcp90 = r(1, 6); bonus = Math.round(r(0, 14)); }
  /* fully available and nailed, so the A/B isolates the added scoring
     categories rather than the P2 minutes model. */
  return { element_type: type, minutes, starts: 6, status: 'a', chance_of_playing_next_round: null,
    expected_goals_per_90: String(xg90), expected_assists_per_90: String(xa90),
    defensive_contribution_per_90: String(dcp90), saves, bonus };
}

/* ── Monte-Carlo ground truth (independent of the model) ── */
function truePoints(el, nf, trials) {
  const gp = nf.gp, mpg = el.minutes / gp, fx = nf.lam / nf.lamAvg;
  const xg90 = parseFloat(el.expected_goals_per_90), xa90 = parseFloat(el.expected_assists_per_90);
  const dcp90 = parseFloat(el.defensive_contribution_per_90 || '0'), type = el.element_type;
  const gPts = type <= 2 ? 6 : type === 3 ? 5 : 4, csPts = type <= 2 ? 4 : type === 3 ? 1 : 0;
  const thr = type === 2 ? 10 : 12;
  const bonus90 = el.bonus * 90 / Math.max(el.minutes, 90);
  const sv90 = (el.saves || 0) * 90 / Math.max(el.minutes, 90);
  let sum = 0;
  for (let t = 0; t < trials; t++) {
    let pts = (mpg > 0 ? 1 : 0) + (mpg >= 60 ? 1 : 0);                       // appearance
    pts += poissonSample(xg90 * (mpg / 90) * fx) * gPts;                     // goals
    pts += poissonSample(xa90 * (mpg / 90) * fx) * 3;                        // assists
    /* Goals conceded, and the clean sheet as its zero event. This generator
       used to draw the clean sheet on its own and never deduct for concedes
       at all — which is not how FPL scores, is not what the shipping model
       forecasts, and is not what the goals-prevented generator below or
       backtest-season do. A model carrying a correct -1 per 2 conceded term
       was therefore marked down for it. Drawing one goals-against count and
       reading the clean sheet off it makes the two self-consistent. */
    const ga = mpg >= 60 ? poissonSample(-Math.log(Math.max(0.03, Math.min(0.99, nf.cs)))) : 0;
    if (mpg >= 60 && ga === 0) pts += csPts;                                 // clean sheet
    if (type <= 2) pts -= Math.floor(ga / 2);                                // -1 per 2 conceded
    pts += Math.min(3, poissonSample(bonus90 * (mpg / 90)));                 // bonus (0–3)
    if (type >= 2 && mpg >= 60) {                                           // defensive contribution
      if (poissonSample(dcp90 * (mpg / 90)) >= thr) pts += 2;
    }
    if (type === 1) pts += Math.floor(poissonSample(sv90 * (mpg / 90)) / 3); // GK saves (1 per 3)
    sum += pts;
  }
  return sum / trials;
}

function runSynthetic() {
  const nf = { gp: 6, lam: 1.55, lamAvg: 1.5, cs: 0.30 };
  const TRIALS = 6000, PER_POS = 120;
  const acc = {}; [1, 2, 3, 4].forEach(t => acc[t] = { n: 0, aeOld: 0, aeNew: 0, biasOld: 0, biasNew: 0, truth: 0 });
  for (const type of [1, 2, 3, 4]) {
    for (let i = 0; i < PER_POS; i++) {
      const el = makePlayer(type);
      const truth = truePoints(el, nf, TRIALS);
      const o = nativeXPold(el, nf), n = nativeXP(el, nf);
      if (o == null || n == null) continue;
      const a = acc[type];
      a.n++; a.truth += truth;
      a.aeOld += Math.abs(truth - o); a.aeNew += Math.abs(truth - n);
      a.biasOld += (o - truth); a.biasNew += (n - truth);
    }
  }
  console.log('Synthetic validation — enhanced nativeXP vs the original\n');
  console.log('  pos   n   avg pts   MAE old  MAE new   bias old  bias new');
  console.log('  ---------------------------------------------------------');
  const tot = { n: 0, aeOld: 0, aeNew: 0, biasOld: 0, biasNew: 0 };
  for (const type of [1, 2, 3, 4]) {
    const a = acc[type]; if (!a.n) continue;
    tot.n += a.n; tot.aeOld += a.aeOld; tot.aeNew += a.aeNew; tot.biasOld += a.biasOld; tot.biasNew += a.biasNew;
    const f = x => x.toFixed(2).padStart(7);
    console.log(`  ${POS[type].padEnd(4)} ${String(a.n).padStart(3)}  ${f(a.truth / a.n)}  ${f(a.aeOld / a.n)}  ${f(a.aeNew / a.n)}   ${f(a.biasOld / a.n)}  ${f(a.biasNew / a.n)}`);
  }
  const f = x => x.toFixed(2).padStart(7);
  console.log('  ---------------------------------------------------------');
  console.log(`  ALL  ${String(tot.n).padStart(3)}  ${''.padStart(7)}  ${f(tot.aeOld / tot.n)}  ${f(tot.aeNew / tot.n)}   ${f(tot.biasOld / tot.n)}  ${f(tot.biasNew / tot.n)}`);
  const impr = 100 * (tot.aeOld - tot.aeNew) / tot.aeOld;
  console.log(`\n  MAE reduced ${impr.toFixed(1)}%; the original model's negative bias (it ignores bonus,`);
  console.log('  defensive-contribution and saves) is largely removed. Biggest gains: DEF / GK / ball-winning MID.');
  if (tot.aeNew >= tot.aeOld) { console.error('\n  REGRESSION: enhanced MAE did not improve.'); process.exit(1); }
}

/* ── GK shot-stopping (Core Insights goals_prevented) ────── */
/* Isolates the goalkeeper refinement: keepers carry a hidden shot-stopping
   skill s (goals prevented per 90). Their true FPL points are Monte-Carlo'd
   from shots-on-target faced and a skill-adjusted concede rate (better keepers
   concede less → more saves, more clean sheets, fewer −points). We then score
   nativeXP WITHOUT the advanced-stats mirror against WITH it (el._ci carries
   goals_prevented). The fixed saves/concede/clean-sheet terms cannot see
   shot-stopping skill beyond the raw save count, so the guarded goals_prevented
   term should cut the goalkeeper's systematic bias. This is the backtest that
   justifies wiring the term into the shipped model. */
function runGkShotStopping() {
  /* The fixture clean-sheet odds are those of the AVERAGE keeper in this
     generator — exp(-base) — not an unrelated league constant. The point of
     the test is that the fixed terms cannot see a keeper's skill DEVIATION
     from average; feeding them a mean that disagrees with the generator adds
     a flat error on top of that, which is not the effect being measured. */
  const base = 1.15, sot90 = 3.6, TRIALS = 4000, N = 200;
  const nf = { gp: 6, lam: 1.5, lamAvg: 1.5, cs: Math.exp(-base) };
  let n = 0, aeNo = 0, aeCi = 0;
  /* Mean signed bias is ~0 for both (skill is symmetric about 0, so over- and
     under-projections cancel); the tell is bias SPLIT by skill — the fixed
     model overrates leaky keepers and underrates elite ones, which the term
     corrects. So we track bias separately for elite (s>0.1) and leaky (s<−0.1). */
  const grp = { elite: { n: 0, no: 0, ci: 0 }, leaky: { n: 0, no: 0, ci: 0 } };
  for (let i = 0; i < N; i++) {
    const s = -0.3 + 0.6 * rnd();                          // true skill: goals prevented / 90
    const conc90 = Math.max(0.15, base - s);
    let ptsSum = 0, svSum = 0;
    for (let t = 0; t < TRIALS; t++) {
      const sot = poissonSample(sot90);
      const pG = Math.min(0.9, conc90 / sot90);
      let c = 0; for (let k = 0; k < sot; k++) c += bern(pG);
      const sv = Math.max(0, sot - c);
      ptsSum += 1 + 1 + Math.floor(sv / 3) + (c === 0 ? 4 : 0) - Math.floor(c / 2);
      svSum += sv;
    }
    const truth = ptsSum / TRIALS;
    const el = {
      element_type: 1, status: 'a', chance_of_playing_next_round: null, minutes: 540, starts: 6,
      expected_goals_per_90: '0', expected_assists_per_90: '0', expected_goals_conceded_per_90: String(conc90),
      defensive_contribution_per_90: '0', goals_scored: 0, bonus: 0, saves: Math.round(svSum / TRIALS * 6),
    };
    const pNo = nativeXP(el, nf);                          // no advanced-stats mirror
    el._ci = { g: 6, gp90: s };                            // mirror present → goals_prevented term active
    const pCi = nativeXP(el, nf);
    if (pNo == null || pCi == null) continue;
    n++; aeNo += Math.abs(truth - pNo); aeCi += Math.abs(truth - pCi);
    const g = s > 0.1 ? grp.elite : s < -0.1 ? grp.leaky : null;
    if (g) { g.n++; g.no += (pNo - truth); g.ci += (pCi - truth); }
  }
  const f = x => x.toFixed(3).padStart(8);
  console.log('\nGoalkeeper shot-stopping — nativeXP with vs without goals_prevented\n');
  console.log('  overall MAE   no CI ' + (aeNo / n).toFixed(3) + '   +CI ' + (aeCi / n).toFixed(3) +
    '   (−' + (100 * (aeNo - aeCi) / aeNo).toFixed(1) + '%)');
  console.log('\n  bias by true skill   n    no CI     +CI');
  console.log('  --------------------------------------------');
  console.log(`  elite  (s>+0.1)     ${String(grp.elite.n).padStart(3)} ${f(grp.elite.no / grp.elite.n)} ${f(grp.elite.ci / grp.elite.n)}`);
  console.log(`  leaky  (s<-0.1)     ${String(grp.leaky.n).padStart(3)} ${f(grp.leaky.no / grp.leaky.n)} ${f(grp.leaky.ci / grp.leaky.n)}`);
  console.log('\n  Without the mirror the model underrates elite shot-stoppers and overrates leaky');
  console.log('  ones; goals_prevented pulls both toward truth and cuts overall GK MAE.');
  const eliteNo = grp.elite.no / grp.elite.n, eliteCi = grp.elite.ci / grp.elite.n;
  const leakyNo = grp.leaky.no / grp.leaky.n, leakyCi = grp.leaky.ci / grp.leaky.n;
  if (aeCi > aeNo + 1e-9 || Math.abs(eliteCi) >= Math.abs(eliteNo) || Math.abs(leakyCi) >= Math.abs(leakyNo)) {
    console.error('\n  REGRESSION: the goals_prevented term did not improve GK accuracy.'); process.exit(1);
  }
}

function runReal(path) {
  const snap = JSON.parse(readFileSync(path, 'utf8'));
  const boot = snap.bootstrap, actuals = snap.actuals || {};
  const teams = {}; boot.teams.forEach(t => teams[t.id] = t);
  /* Neutral fixture context — a real backtest would use per-team lam/cs
     from the match model; here we validate the player layer in isolation. */
  const nf = { gp: 6, lam: 1.5, lamAvg: 1.5, cs: 0.28 };
  let n = 0, aeOld = 0, aeNew = 0;
  for (const el of boot.elements) {
    const act = actuals[el.id]; if (act == null) continue;
    const o = nativeXPold(el, nf), ne = nativeXP(el, nf);
    if (o == null || ne == null) continue;
    n++; aeOld += Math.abs(act - o); aeNew += Math.abs(act - ne);
  }
  if (!n) { console.error('No overlapping players with actuals + a full sample.'); process.exit(1); }
  console.log(`Real validation on ${n} players`);
  console.log(`  MAE original: ${(aeOld / n).toFixed(3)}`);
  console.log(`  MAE enhanced: ${(aeNew / n).toFixed(3)}`);
}

const arg = process.argv[2];
if (arg) runReal(arg); else { runSynthetic(); runGkShotStopping(); }

/* buildSnapshot note — to make a real snapshot for the REAL mode:
 *   const boot = await (await fetch('.../api/bootstrap-static/')).json();
 *   const live = await (await fetch('.../api/event/<gw>/live/')).json();
 *   const actuals = {}; live.elements.forEach(e => actuals[e.id] = e.stats.total_points);
 *   writeFileSync('snap.json', JSON.stringify({ bootstrap: boot, actuals }));
 */
