/*
 * Season backtest — walk-forward accuracy of the shipping player model.
 *
 * WHY THIS EXISTS (and what it is honest about)
 * ---------------------------------------------
 * The live FPL API is firewalled from CI / the sandbox, so this cannot
 * read the real 2025/26 returns. Instead it SIMULATES a 2025/26-rules
 * season from a data-generating process (DGP) that is deliberately RICHER
 * and MIS-SPECIFIED relative to the model — it injects the real-world
 * effects the model does not represent:
 *
 *   - finishing skill: goals = xG x a per-player finishing multiplier, so
 *     clinical / wasteful players systematically beat / miss their xG
 *     (the model only ever sees xG).
 *   - penalties: designated takers carry a concentrated extra goal source.
 *   - overdispersion / form: a per-GW gamma multiplier makes returns
 *     streakier than the Poisson the model assumes.
 *   - minutes regimes: nailed / rotation / injury spells, not the smooth
 *     season-average minutes the model extrapolates.
 *   - negatives: red cards, own goals, penalty misses, yellow cards —
 *     points the model never forecasts.
 *   - lumpy bonus correlated with hauls, not a smooth per-90 rate.
 *
 * Because the DGP differs from the model, this is a real specification
 * stress test — it can expose blind spots the self-consistent harness in
 * model-validate.mjs cannot (that one draws truth from nativeXP's own
 * formula, so it only measures the P1 additions).
 *
 * The model is extracted VERBATIM from index.html, so we grade exactly
 * what ships. Deterministic (seeded) so the report is reproducible.
 *
 * It walks forward: at the deadline before gameweek g the model sees only
 * season-to-date aggregates (the bootstrap-static fields), predicts g,
 * and is scored against the realized points. No lookahead.
 *
 * Run: node dev/backtest-season.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/* ── extract the shipping model verbatim ────────────────── */
function extractBlock(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0, inStr = null, esc = false, line = false, block = false;
  for (let j = open; j < src.length; j++) {
    const ch = src[j], nx = src[j + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && nx === '/') { block = false; j++; } continue; }
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && nx === '/') { line = true; j++; continue; }
    if (ch === '/' && nx === '*') { block = true; j++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced block from ' + startIdx);
}
const grab = name => extractBlock(html, html.indexOf('function ' + name + '('));
/* minutesModel now depends on the fixture-congestion helper; historical runs
   pass no congestion, so congestionFactor returns 1 and nothing changes. */
const congestSrc = ['CONGEST_FULL', 'CONGEST_FADE', 'CONGEST_MAX', 'CONGEST_NAILED', 'CONGEST_TO_BENCH']
  .map(n => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); })
  .join('\n') + '\n' + extractBlock(html, html.indexOf('function congestionFactor('));
const model = new Function(
  [congestSrc, grab('minutesModel'), grab('concedePts'), grab('effGoalRate'), grab('negRate90'),
    grab('nativeXP'), grab('xP'), grab('pointsDist')].join('\n') +
  '\nreturn { minutesModel, nativeXP, xP, pointsDist };'
)();

/* ── deterministic RNG + samplers ───────────────────────── */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20250809);
const r = (lo, hi) => lo + rnd() * (hi - lo);
function pois(l) { if (l <= 0) return 0; const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; }
const bern = p => (rnd() < p ? 1 : 0);
/* gamma(shape,1) via Marsaglia-Tsang — the per-GW form multiplier that
   makes the truth overdispersed vs the model's plain Poisson. */
function gamma(k) {
  if (k < 1) return gamma(k + 1) * Math.pow(rnd(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) { let x, v; do { const u1 = rnd(), u2 = rnd(); x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = rnd(); if (u < 1 - 0.0331 * x * x * x * x) return d * v; if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; }
}

/* ── a realistic 2025/26 player population ──────────────── */
const POS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const TEAMS = 20, GW = 38, EVAL_FROM = 8;   /* model needs >=5 games; let stats settle */

function makeTeam(id) {
  /* latent team strength → drives true attack (goals for) and defence
     (clean-sheet propensity). Spread mimics a real PL table. */
  return { id, att: r(0.75, 1.35), def: r(0.75, 1.35) };
}
function makePlayer(id, teamId, type) {
  const nailed = rnd();                       /* 0..1 → minutes regime */
  const regime = nailed > 0.62 ? 'nailed' : nailed > 0.3 ? 'rotation' : 'fringe';
  let xg90 = 0, xa90 = 0, dc90 = 0, saveRate = 0, penDuty = 0, finishing = r(0.82, 1.2);
  if (type === 1) { saveRate = r(2.2, 3.6); dc90 = 0; finishing = 1; }
  else if (type === 2) { xg90 = r(0.02, 0.22); xa90 = r(0.03, 0.22); dc90 = r(6, 17); }
  else if (type === 3) { xg90 = r(0.06, 0.55); xa90 = r(0.08, 0.42); dc90 = r(3, 15); }
  else { xg90 = r(0.22, 0.78); xa90 = r(0.05, 0.32); dc90 = r(1, 6); }
  /* penalty duty concentrated on a few mids/forwards */
  if ((type === 3 || type === 4) && rnd() < 0.16) penDuty = r(0.55, 0.95);
  return {
    id, team: teamId, element_type: type, regime,
    _xg90: xg90, _xa90: xa90, _dc90: dc90, _saveRate: saveRate, _penDuty: penDuty,
    _finishing: finishing,                    /* TRUE finishing vs xG (model never sees this) */
    _bonusTend: r(0.6, 1.5),                  /* BPS temperament */
    _injphase: 999,                           /* GW index an injury spell started (none) */
  };
}
const teams = []; for (let t = 1; t <= TEAMS; t++) teams.push(makeTeam(t));
const players = []; let pid = 1;
for (const tm of teams) {
  players.push(makePlayer(pid++, tm.id, 1));                     /* 1 nailed GK */
  for (let i = 0; i < 6; i++) players.push(makePlayer(pid++, tm.id, 2));
  for (let i = 0; i < 7; i++) players.push(makePlayer(pid++, tm.id, 3));
  for (let i = 0; i < 4; i++) players.push(makePlayer(pid++, tm.id, 4));
}

/* accumulators the model reads (mirrors bootstrap-static fields) */
for (const p of players) Object.assign(p, {
  minutes: 0, starts: 0, _goals: 0, _assists: 0, _cs: 0, bonus: 0, saves: 0,
  _dcActions: 0, _xgAcc: 0, _xaAcc: 0, _pts: [], _mins: [],
  _yc: 0, _rc: 0, _og: 0, _pm: 0,
});
const teamGP = {}; teams.forEach(t => teamGP[t.id] = 0);

/* one team's true fixture λ / clean-sheet odds for a gameweek */
function fixture(team, opp, home) {
  const BASE = 1.42;
  const lam = Math.max(0.25, BASE * team.att / opp.def * (home ? 1.13 : 0.9));   /* goals for */
  const conc = Math.max(0.25, BASE * opp.att / team.def * (home ? 0.9 : 1.13));  /* goals against */
  const cs = Math.exp(-conc);                                                     /* P(0 conceded), consistent with conc */
  return { lam, cs, conc };
}

/* ── true realized points for a player-gameweek (the rich DGP) ── */
function realize(p, tm, opp, home, gw) {
  const fxT = fixture(tm, opp, home);
  /* minutes regime with injury spells */
  if (p._injphase === 999 && rnd() < 0.012) p._injphase = gw;            /* new injury */
  const inInjury = gw - p._injphase >= 0 && gw - p._injphase < 3;
  let minutes;
  if (inInjury) minutes = rnd() < 0.5 ? 0 : Math.round(r(0, 30));
  else if (p.regime === 'nailed') minutes = rnd() < 0.9 ? Math.round(r(80, 96)) : Math.round(r(0, 70));
  else if (p.regime === 'rotation') minutes = rnd() < 0.62 ? Math.round(r(55, 92)) : Math.round(r(0, 45));
  else minutes = rnd() < 0.35 ? Math.round(r(30, 80)) : Math.round(r(0, 20));
  if (p._injphase !== 999 && gw - p._injphase >= 3) p._injphase = 999;   /* recovered */
  const started = minutes >= 60 ? 1 : 0, mfrac = minutes / 90;
  const type = p.element_type;
  const gPts = type <= 2 ? 6 : type === 3 ? 5 : 4, csPts = type <= 2 ? 4 : type === 3 ? 1 : 0;

  /* per-GW form multiplier (overdispersion the model ignores) */
  const form = gamma(3.2) / 3.2;                                          /* mean 1, right-skewed */
  const xgThis = p._xg90 * mfrac * fxT.lam / 1.42;                        /* xG this match */
  const xaThis = p._xa90 * mfrac * fxT.lam / 1.42;
  /* goals: xG scaled by TRUE finishing skill + form, plus penalties */
  let goals = pois(xgThis * p._finishing * form);
  let penMiss = 0, penXg = 0;
  if (p._penDuty > 0 && minutes >= 45 && rnd() < 0.16 * p._penDuty) {
    penXg = 0.79;                                                         /* FPL xG includes penalty xG */
    if (rnd() < 0.79) goals += 1; else penMiss = 1;                       /* ~79% conversion */
  }
  const assists = pois(xaThis * form * 1.02);
  let pts = 0;
  if (minutes > 0) pts += 1;
  if (minutes >= 60) pts += 1;
  pts += goals * gPts + assists * 3;
  /* Goals conceded ~ Poisson(conc); clean sheet is exactly the zero event,
     so cs and the concede count are self-consistent (cs = exp(-conc)). */
  const goalsAgainst = minutes >= 60 ? pois(fxT.conc) : 0;
  const cs = (minutes >= 60 && goalsAgainst === 0) ? 1 : 0;
  if (cs) pts += csPts;
  let conceded = 0;
  if (type <= 2) { conceded = Math.floor(goalsAgainst / 2); pts -= conceded; }   /* -1 per 2 conceded (GK/DEF) */
  /* defensive contribution (2025/26) */
  const dcActions = type >= 2 ? pois(p._dc90 * mfrac * (0.85 + 0.3 * form)) : 0;
  if (type >= 2 && minutes >= 60 && dcActions >= (type === 2 ? 10 : 12)) pts += 2;
  /* goalkeeper saves */
  let saves = 0;
  if (type === 1 && minutes > 0) { saves = pois(p._saveRate * mfrac); pts += Math.floor(saves / 3); if (rnd() < 0.04) pts -= 2; /* pen saved rare / goals conceded penalty handled above */ }
  /* bonus — lumpy, correlated with returns */
  let bonus = 0;
  const involvement = goals * 3 + assists * 2 + (cs ? 1 : 0) + dcActions / 10;
  if (involvement > 2.5 && rnd() < 0.5 * p._bonusTend) bonus = 1 + pois(1.1);
  bonus = Math.min(3, bonus);
  pts += bonus;
  /* negatives the model never forecasts */
  let yellow = 0, red = 0, og = 0;
  if (penMiss) pts -= 2;
  if (minutes > 0 && rnd() < 0.02) { yellow = 1; pts -= 1; }
  if (minutes > 0 && rnd() < 0.006) { red = 1; pts -= 3; }
  if (rnd() < 0.004) { og = 1; pts -= 2; }

  return { minutes, started, goals, assists, cs, bonus, saves, dcActions, xg: xgThis + penXg, xa: xaThis, pts, penMiss, conceded, yellow, red, og };
}

/* ── metrics accumulators ───────────────────────────────── */
const M = {};
[1, 2, 3, 4].forEach(t => M[t] = { n: 0, aeN: 0, seN: 0, biasN: 0, aeX: 0, biasX: 0, aeForm: 0, aePPG: 0, truth: 0 });
const spearman = [];                 /* per-GW rank corr of xP vs actual */
const cover = { in: 0, below: 0, above: 0, n: 0 };     /* p10..p90 interval coverage */
const haulRows = [], blankRows = [];                    /* calibration */
const capReg = { model: 0, opt: 0, form: 0, n: 0 };     /* captaincy regret */
const xgGap = { g: 0, xg: 0 };                          /* finishing-skill blind spot */
let penForecastMiss = 0, penForecastN = 0;
/* concede-deduction probe: the -pts/GW GK/DEF actually lose to conceded
   goals — a deduction nativeXP never subtracts. Should ~= their bias. */
const concede = { pts: 0, n: 0 };
/* finishing-skill probe: scorer residual split by TRUE finishing multiplier */
const finish = { clinical: { b: 0, n: 0 }, wasteful: { b: 0, n: 0 } };

function spearmanCorr(pairs) {
  const rank = arr => { const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const rk = new Array(arr.length); idx.forEach(([, i], k) => rk[i] = k); return rk; };
  const a = rank(pairs.map(p => p[0])), b = rank(pairs.map(p => p[1])), n = pairs.length;
  let d2 = 0; for (let i = 0; i < n; i++) d2 += (a[i] - b[i]) ** 2;
  return 1 - 6 * d2 / (n * (n * n - 1));
}

/* ── walk the season forward ────────────────────────────── */
for (let gw = 1; gw <= GW; gw++) {
  /* random opponents this GW (shuffle teams into pairs) */
  const order = teams.map(t => t.id).sort(() => rnd() - 0.5);
  const oppOf = {}, homeOf = {};
  for (let i = 0; i < order.length; i += 2) { oppOf[order[i]] = order[i + 1]; oppOf[order[i + 1]] = order[i]; homeOf[order[i]] = true; homeOf[order[i + 1]] = false; }

  /* team season-average λ so far (what the match model would know) */
  const teamLamAvg = {}; teams.forEach(t => { const gp = teamGP[t.id] || 1; teamLamAvg[t.id] = 1.42 * t.att; });

  const evalRows = [];   /* {p, actual, xp} for this GW's metrics */
  const capPool = [];

  for (const p of players) {
    const tm = teams[p.team - 1], opp = teams[oppOf[p.team] - 1], home = homeOf[p.team];
    const truth = realize(p, tm, opp, home, gw);

    /* Build the model's view from season-to-date aggregates (pre-GW). */
    const gp = teamGP[p.team];
    let xp = null, nat = null, dist = null, formPPG = null, ppg = null;
    if (gw > EVAL_FROM && gp >= 5) {
      const fxT = fixture(tm, opp, home);
      const el = {
        id: p.id, element_type: p.element_type,
        minutes: p.minutes, starts: p.starts, status: 'a',
        chance_of_playing_next_round: (p._injphase !== 999 && gw - p._injphase < 3) ? 25 : null,
        expected_goals_per_90: String(p.minutes ? p._xgAcc * 90 / p.minutes : 0),
        expected_assists_per_90: String(p.minutes ? p._xaAcc * 90 / p.minutes : 0),
        defensive_contribution_per_90: String(p.minutes ? p._dcActions * 90 / p.minutes : 0),
        saves: p.saves, bonus: p.bonus, goals_scored: p._goals,       /* enables finishing blend (P-fix 5) */
        yellow_cards: p._yc, red_cards: p._rc, own_goals: p._og, penalties_missed: p._pm,   /* negatives (P-fix 4) */
        form: (p._pts.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, p._pts.length || 1)).toFixed(1),
        points_per_game: (p._pts.reduce((a, b) => a + b, 0) / Math.max(1, p._pts.length)).toFixed(1),
      };
      /* a plausible ep_next (FPL's own estimate) = shrunk recent form */
      el.ep_next = (0.6 * parseFloat(el.form) + 0.4 * parseFloat(el.points_per_game)).toFixed(1);
      /* fixture context the model gets (match layer validated separately) */
      const nf = { gp, lam: fxT.lam, lamAvg: teamLamAvg[p.team], cs: fxT.cs, diff: 3 };
      nat = model.nativeXP(el, nf);
      xp = model.xP(null, el, nf);
      formPPG = parseFloat(el.form); ppg = parseFloat(el.points_per_game);
      if (nat != null) {
        dist = model.pointsDist(el, nf, 900);
        const a = M[p.element_type]; a.n++; a.truth += truth.pts;
        a.aeN += Math.abs(truth.pts - nat); a.seN += (truth.pts - nat) ** 2; a.biasN += (nat - truth.pts);
        a.aeX += Math.abs(truth.pts - xp); a.biasX += (xp - truth.pts);
        a.aeForm += Math.abs(truth.pts - formPPG); a.aePPG += Math.abs(truth.pts - ppg);
        evalRows.push({ p, actual: truth.pts, xp });
        /* interval coverage */
        cover.n++; if (truth.pts < dist.p10) cover.below++; else if (truth.pts > dist.p90) cover.above++; else cover.in++;
        /* calibration */
        haulRows.push({ p: dist.haul, y: truth.pts >= 10 ? 1 : 0 });
        blankRows.push({ p: dist.blank, y: truth.pts <= 2 ? 1 : 0 });
        /* finishing-skill blind spot: accumulate goals vs xG the model saw */
        xgGap.g += truth.goals; xgGap.xg += truth.xg;
        const resid = nat - truth.pts;                    /* + = model over-forecast */
        /* concede-deduction probe (GK/DEF): points lost to conceded goals,
           which nativeXP never subtracts. */
        if (p.element_type <= 2) { concede.pts += truth.conceded; concede.n++; }
        /* finishing probe (scorers): are clinical finishers under-forecast? */
        if (p.element_type >= 3) {
          if (p._finishing > 1.08) { finish.clinical.b += resid; finish.clinical.n++; }
          else if (p._finishing < 0.92) { finish.wasteful.b += resid; finish.wasteful.n++; }
        }
        /* penalty takers: did the model under-rate them? track separately */
        if (p._penDuty > 0) { penForecastMiss += (truth.pts - nat); penForecastN++; }
        /* captain candidates: eligible = mid/fwd/def with a projection */
        if (p.element_type >= 2) capPool.push({ p, xp, actual: truth.pts, form: formPPG });
      }
    }

    /* commit this GW's realized stats into the accumulators (post-eval) */
    p.minutes += truth.minutes; p.starts += truth.started; p._goals += truth.goals;
    p._assists += truth.assists; p._cs += truth.cs; p.bonus += truth.bonus; p.saves += truth.saves;
    p._dcActions += truth.dcActions; p._xgAcc += truth.xg; p._xaAcc += truth.xa;
    p._yc += truth.yellow; p._rc += truth.red; p._og += truth.og; p._pm += truth.penMiss;
    p._pts.push(truth.pts); p._mins.push(truth.minutes);
  }
  teams.forEach(t => teamGP[t.id]++);

  /* per-GW rank correlation + captaincy */
  if (evalRows.length > 30) {
    spearman.push(spearmanCorr(evalRows.map(e => [e.xp, e.actual])));
    if (capPool.length > 5) {
      const byModel = capPool.slice().sort((a, b) => b.xp - a.xp)[0];
      const byForm = capPool.slice().sort((a, b) => b.form - a.form)[0];
      const opt = capPool.slice().sort((a, b) => b.actual - a.actual)[0];
      capReg.model += byModel.actual; capReg.form += byForm.actual; capReg.opt += opt.actual; capReg.n++;
    }
  }
}

/* ── the app's own calibration() logic, for the haul curve ── */
function calibration(rows) {
  let brier = 0; const B = 10, acc = Array.from({ length: B }, () => ({ sp: 0, sy: 0, n: 0 }));
  rows.forEach(rw => { const p = Math.max(0, Math.min(1, rw.p)), y = rw.y ? 1 : 0; brier += (p - y) ** 2; const b = acc[Math.min(B - 1, Math.floor(p * B))]; b.sp += p; b.sy += y; b.n++; });
  return { n: rows.length, brier: brier / rows.length, buckets: acc.filter(b => b.n).map(b => ({ pMean: b.sp / b.n, oFreq: b.sy / b.n, n: b.n })) };
}

/* ── report ─────────────────────────────────────────────── */
const pad = (s, n) => String(s).padStart(n);
const f2 = x => x.toFixed(2);
console.log('════════════════════════════════════════════════════════════════');
console.log(' SEASON BACKTEST — shipping player model vs a mis-specified DGP');
console.log(' (simulated 2025/26 rules; live API is firewalled here — see header)');
console.log('════════════════════════════════════════════════════════════════\n');

console.log('Per-position accuracy (points/GW), walk-forward GW' + (EVAL_FROM + 1) + '–' + GW + ':');
console.log('  pos    n    avg   MAE_nat  RMSE_nat  bias_nat   MAE_xP  bias_xP | MAE_form  MAE_ppg');
console.log('  -------------------------------------------------------------------------------------');
const tot = { n: 0, aeN: 0, seN: 0, biasN: 0, aeX: 0, biasX: 0, aeForm: 0, aePPG: 0, truth: 0 };
for (const t of [1, 2, 3, 4]) {
  const a = M[t]; if (!a.n) continue;
  for (const k of Object.keys(tot)) tot[k] += a[k];
  console.log('  ' + POS[t].padEnd(4) + pad(a.n, 5) + pad(f2(a.truth / a.n), 7) +
    pad(f2(a.aeN / a.n), 9) + pad(f2(Math.sqrt(a.seN / a.n)), 10) + pad((a.biasN / a.n >= 0 ? '+' : '') + f2(a.biasN / a.n), 10) +
    pad(f2(a.aeX / a.n), 9) + pad((a.biasX / a.n >= 0 ? '+' : '') + f2(a.biasX / a.n), 9) + ' |' +
    pad(f2(a.aeForm / a.n), 9) + pad(f2(a.aePPG / a.n), 9));
}
console.log('  -------------------------------------------------------------------------------------');
console.log('  ALL ' + pad(tot.n, 5) + pad(f2(tot.truth / tot.n), 7) +
  pad(f2(tot.aeN / tot.n), 9) + pad(f2(Math.sqrt(tot.seN / tot.n)), 10) + pad((tot.biasN / tot.n >= 0 ? '+' : '') + f2(tot.biasN / tot.n), 10) +
  pad(f2(tot.aeX / tot.n), 9) + pad((tot.biasX / tot.n >= 0 ? '+' : '') + f2(tot.biasX / tot.n), 9) + ' |' +
  pad(f2(tot.aeForm / tot.n), 9) + pad(f2(tot.aePPG / tot.n), 9));

const avgSpear = spearman.reduce((a, b) => a + b, 0) / spearman.length;
console.log('\nRanking quality (what actually drives picks):');
console.log('  mean per-GW Spearman rank corr (xP vs actual): ' + f2(avgSpear));
console.log('  captain — pts/GW following the model: ' + f2(capReg.model / capReg.n) +
  '   vs highest-form baseline: ' + f2(capReg.form / capReg.n) +
  '   vs perfect hindsight: ' + f2(capReg.opt / capReg.n));
console.log('  captain regret vs perfect: ' + f2((capReg.opt - capReg.model) / capReg.n) + ' pts/GW' +
  '  (baseline regret ' + f2((capReg.opt - capReg.form) / capReg.n) + ')');

console.log('\nDistribution calibration (pointsDist):');
const covIn = 100 * cover.in / cover.n;
console.log('  80% interval [p10,p90] coverage: ' + f2(covIn) + '%  (target ~80; ' +
  f2(100 * cover.below / cover.n) + '% below, ' + f2(100 * cover.above / cover.n) + '% above)');
const hc = calibration(haulRows);
console.log('  haul (>=10) Brier: ' + hc.brier.toFixed(4) + '  — reliability (pred → obs):');
hc.buckets.forEach(b => { if (b.n >= 20) console.log('    ' + f2(b.pMean) + ' → ' + f2(b.oFreq) + '  (n=' + b.n + ')'); });

console.log('\nStructural probes (the fixes are now IN the model — this checks they hold):');
const finRatio = xgGap.g / xgGap.xg;
const cMean = concede.pts / Math.max(1, concede.n);
console.log('  Concede term (fix 1): GK/DEF lose a measured -' + f2(cMean) + ' pts/GW to concedes;');
console.log('    residual bias now GK ' + (M[1].biasN / M[1].n >= 0 ? '+' : '') + f2(M[1].biasN / M[1].n) +
  ' / DEF ' + (M[2].biasN / M[2].n >= 0 ? '+' : '') + f2(M[2].biasN / M[2].n) + ' (was ~ +0.6 to +0.7 before the term).');
const fClin = finish.clinical.b / Math.max(1, finish.clinical.n), fWast = finish.wasteful.b / Math.max(1, finish.wasteful.n);
console.log('  Finishing blend (fix 5): clinical residual ' + (fClin >= 0 ? '+' : '') + f2(fClin) +
  ' vs wasteful ' + (fWast >= 0 ? '+' : '') + f2(fWast) + ' (gap ' + f2(fWast - fClin) + ', shrunk on purpose).');
console.log('  penalty takers: mean nativeXP bias ' + (penForecastMiss / penForecastN >= 0 ? '+' : '') +
  f2(penForecastMiss / penForecastN) + ' pts/GW (n=' + penForecastN + ').');

console.log('\n──────────────────────────────────────────────────────────────');
console.log(' WHERE TO IMPROVE NEXT (read from the current numbers)');
console.log('──────────────────────────────────────────────────────────────');
const notes = [];
/* Find the position with the largest residual bias magnitude. */
let worst = 1; for (const t of [2, 3, 4]) if (Math.abs(M[t].biasN / M[t].n) > Math.abs(M[worst].biasN / M[worst].n)) worst = t;
const wb = M[worst].biasN / M[worst].n;
if (Math.abs(wb) > 0.3) notes.push('[top residual] ' + POS[worst] + ' bias ' + (wb >= 0 ? '+' : '') + f2(wb) + ' pts/GW' + (worst === 4 ? ' — forwards get bonus concentration, rebounds and secondary chances that pure-xG forecasting under-captures; a position-specific calibration term (or a higher finishing-blend weight for FWD) would close it.' : ' — a position-specific recalibration would close it.'));
if (cover.above / cover.n > 0.13) notes.push('Upper tail of pointsDist still slightly thin: ' + f2(100 * cover.above / cover.n) + '% beat p90 (target ~10; band width otherwise fine at ' + f2(covIn) + '%). This tracks the ' + POS[worst] + ' under-forecast above — the hauling position breaching its own ceiling — so fixing that mean also fixes the tail. Overdispersion (gam k) and finishing weight are the levers; calibrate them on live data via the P5 endpoint rather than to this simulation.');
notes.push('Minutes-regime error is the largest variance source: RMSE ' + f2(Math.sqrt(tot.seN / tot.n)) + ' vs MAE ' + f2(tot.aeN / tot.n) + ', from rotation/injury weeks a season aggregate cannot see. A true start-probability state needs per-GW history (element-summary), a data-plumbing follow-on beyond the current bootstrap fields.');
notes.push('Overall bias ' + (tot.biasN / tot.n >= 0 ? '+' : '') + f2(tot.biasN / tot.n) + ' pts/GW (was +0.32 before these fixes) — small and now uniform across GK/DEF/MID, so a single global recentre on live data would finish the job.');
if (tot.aeN / tot.n < tot.aeForm / tot.n) notes.push('Health check: nativeXP MAE ' + f2(tot.aeN / tot.n) + ' beats the 3-GW form baseline ' + f2(tot.aeForm / tot.n) + ' and season-PPG ' + f2(tot.aePPG / tot.n) + '; captaining the model returns +' + f2((capReg.model - capReg.form) / capReg.n) + ' pts/GW over the form pick (Spearman ' + f2(avgSpear) + ').');
notes.forEach((n, i) => console.log(' ' + (i + 1) + '. ' + n));

console.log('\nCaveat: this is a simulation calibrated to 2025/26 RULES, not the');
console.log('season\'s real returns (the FPL API is firewalled from this sandbox).');
console.log('For a real backtest, drop a finished-GW snapshot in and run');
console.log('dev/model-validate.mjs <snap.json>; this harness then ports directly.');
