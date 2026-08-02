/*
 * MULTI-SEASON backtest — grades the shipping model across every season of the
 * open vaastav dataset, not just one, and writes the per-season result to
 * data/backtest-history.json for the Model Accountability panel to publish.
 *
 * dev/backtest-vaastav.mjs already does this properly for a single season, and
 * this file deliberately reuses its method verbatim: strictly walk-forward, no
 * lookahead, fixture conditioning neutralised, appearance-conditional MAE as
 * the headline. What it adds is breadth — and one honest complication.
 *
 * THE ERA PROBLEM, AND WHY THERE IS NO TEN-SEASON NUMBER
 *
 * The model reads per-90 expected goals, expected assists and expected goals
 * conceded. Those columns enter the dataset in 2022-23. They do not exist for
 * 2016-17 to 2021-22, and no amount of care invents them. So this run reports
 * two different things and never blends them:
 *
 *   mode "shipping" (2022-23 onward) — the real model on its real inputs.
 *     This is the number that means what it says.
 *
 *   mode "proxy" (2016-17 to 2021-22) — the same model structure fed REALISED
 *     rates where expected ones are missing: goals per 90 standing in for xG
 *     per 90, and so on. That is a different, noisier model. It is reported so
 *     the decade has a shape, and it is labelled everywhere so nobody reads it
 *     as a ten-season validation of what ships.
 *
 * Averaging those together would produce exactly the kind of impressive,
 * meaningless headline this panel exists to avoid.
 *
 * Positions come from players_raw.csv, which every season has, because
 * merged_gw.csv only carries a `position` column from 2022-23.
 *
 * Usage:
 *   node scripts/history/fetch-seasons.mjs   # once
 *   node dev/backtest-history.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SEASONS, parseCsv, num, str, detectEra } from '../scripts/history/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'dev', 'fixtures', 'vaastav');
const OUT = join(ROOT, 'data', 'backtest-history.json');

/* ── extract the shipping model from index.html ──────────────────────────
   Same approach, and the same ~15 lines, as dev/backtest-vaastav.mjs: the
   model is graded by pulling it out of the file that ships it, so a change to
   nativeXP cannot pass here and fail in the app. */
function extractBlock(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0, inStr = null, esc = false, com = 0;
  for (let j = open; j < src.length; j++) {
    const ch = src[j], nx = src[j + 1];
    if (com) { if (com === 1 && ch === '\n') com = 0; else if (com === 2 && ch === '*' && nx === '/') { com = 0; j++; } continue; }
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && nx === '/') { com = 1; j++; continue; }
    if (ch === '/' && nx === '*') { com = 2; j++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced block');
}
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const grabFn = (n) => extractBlock(html, html.indexOf('function ' + n + '('));
const congestSrc = ['CONGEST_FULL', 'CONGEST_FADE', 'CONGEST_MAX', 'CONGEST_NAILED', 'CONGEST_TO_BENCH']
  .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); })
  .join('\n') + '\n' + extractBlock(html, html.indexOf('function congestionFactor('));
const model = new Function(
  [congestSrc, grabFn('minutesModel'), grabFn('concedePts'), grabFn('savePts'),
    grabFn('dcHitProb'), grabFn('effGoalRate'),
    grabFn('negRate90'), grabFn('nativeXP')].join('\n') + '\nreturn {nativeXP};',
)();

const NEUTRAL_NF = { gp: 0, lam: 1, lamAvg: 1, cs: 0.28 };
const BANDS = [
  { key: 'zeros', label: 'Zeros (did not play)', hit: (r) => r.minutes === 0 },
  { key: 'blanks', label: 'Blanks (played, <=2)', hit: (r) => r.minutes > 0 && r.total_points <= 2 },
  { key: 'tickers', label: 'Tickers (3-4)', hit: (r) => r.total_points >= 3 && r.total_points <= 4 },
  { key: 'haulers', label: 'Haulers (>=5)', hit: (r) => r.total_points >= 5 },
];

/* ── one season ─────────────────────────────────────────────────────── */

function loadPositions(season) {
  const p = join(SRC, season, 'players_raw.csv');
  if (!existsSync(p)) return null;
  const { index, rows } = parseCsv(readFileSync(p, 'utf8'));
  const m = new Map();
  for (const r of rows) m.set(num(r[index.id]), num(r[index.element_type]));
  return m;
}

function runSeason(season) {
  const gwPath = join(SRC, season, 'merged_gw.csv');
  if (!existsSync(gwPath)) return null;
  const pos = loadPositions(season);
  if (!pos) return null;

  const { header, index, rows: raw } = parseCsv(readFileSync(gwPath, 'utf8'));
  const era = detectEra(header);
  const gwCol = index.GW !== undefined ? index.GW : index.round;

  const rows = [];
  for (const c of raw) {
    const element = num(c[index.element]);
    const type = pos.get(element);
    const gw = num(c[gwCol]);
    if (!element || !type || !gw || type > 4) continue;   /* type 5 = manager */
    rows.push({
      element, type, gw,
      minutes: num(c[index.minutes]),
      total_points: num(c[index.total_points]),
      starts: era.starts ? num(c[index.starts]) : 0,
      goals: num(c[index.goals_scored]),
      assists: num(c[index.assists]),
      bonus: num(c[index.bonus]),
      saves: num(c[index.saves]),
      conceded: num(c[index.goals_conceded]),
      xg: era.xg ? num(c[index.expected_goals]) : 0,
      xa: era.xg ? num(c[index.expected_assists]) : 0,
      xgc: era.xgc ? num(c[index.expected_goals_conceded]) : 0,
      dc: era.defcon ? num(c[index.defensive_contribution]) : 0,
      yc: num(c[index.yellow_cards]),
      rc: num(c[index.red_cards]),
      og: num(c[index.own_goals]),
      pm: num(c[index.penalties_missed]),
    });
  }
  if (!rows.length) return null;

  const byGw = new Map();
  for (const r of rows) { if (!byGw.has(r.gw)) byGw.set(r.gw, []); byGw.get(r.gw).push(r); }
  const gws = [...byGw.keys()].sort((a, b) => a - b);

  const agg = {};
  const cur = (el) => agg[el] || (agg[el] = {
    g: 0, min: 0, st: 0, xg: 0, xa: 0, xgc: 0, gl: 0, as: 0, gc: 0,
    bon: 0, sv: 0, dc: 0, yc: 0, rc: 0, og: 0, pm: 0, pts: 0, last: [],
  });

  const mk = () => ({ n: 0, model: 0, form: 0, ppg: 0 });
  const all = mk(), appear = mk();
  const band = {};
  for (const b of BANDS) band[b.key] = { n: 0, model: 0, form: 0, ppg: 0 };

  for (const gw of gws) {
    const wk = byGw.get(gw);

    /* 1) score using ONLY gameweeks strictly before this one */
    for (const r of wk) {
      const a = cur(r.element);
      if (!(a.g >= 5 && a.min / a.g >= 20)) continue;
      const per90 = a.min > 0 ? 90 / a.min : 0;

      /* Where expected numbers do not exist, realised ones stand in. This is
         the whole of the "proxy" mode, and it is the only difference between
         the two — the model itself is identical. */
      const xg90 = era.xg ? a.xg * per90 : a.gl * per90;
      const xa90 = era.xg ? a.xa * per90 : a.as * per90;
      const xgc90 = era.xgc ? a.xgc * per90 : a.gc * per90;

      const el = {
        element_type: r.type, status: 'a', chance_of_playing_next_round: null,
        minutes: a.min, starts: a.st,
        expected_goals_per_90: String(xg90),
        expected_assists_per_90: String(xa90),
        expected_goals_conceded_per_90: String(xgc90),
        defensive_contribution_per_90: String(era.defcon ? a.dc * per90 : 0),
        goals_scored: a.gl, bonus: a.bon, saves: a.sv,
        yellow_cards: a.yc, red_cards: a.rc, own_goals: a.og, penalties_missed: a.pm,
      };
      const xp = model.nativeXP(el, { ...NEUTRAL_NF, gp: a.g });
      if (xp == null) continue;

      const form = a.last.length ? a.last.reduce((s, x) => s + x, 0) / a.last.length : 0;
      const ppg = a.g ? a.pts / a.g : 0;
      for (const bkt of (r.minutes > 0 ? [all, appear] : [all])) {
        bkt.n++;
        bkt.model += Math.abs(xp - r.total_points);
        bkt.form += Math.abs(form - r.total_points);
        bkt.ppg += Math.abs(ppg - r.total_points);
      }
      for (const h of BANDS.filter((bd) => bd.hit(r))) {
        const s = band[h.key];
        s.n++;
        s.model += (xp - r.total_points) ** 2;
        s.form += (form - r.total_points) ** 2;
        s.ppg += (ppg - r.total_points) ** 2;
      }
    }

    /* 2) fold this gameweek's realised outcome into the running totals */
    for (const r of wk) {
      const a = cur(r.element);
      if (r.minutes > 0) a.g += 1;
      a.min += r.minutes; a.st += r.starts;
      a.xg += r.xg; a.xa += r.xa; a.xgc += r.xgc;
      a.gl += r.goals; a.as += r.assists; a.gc += r.conceded;
      a.bon += r.bonus; a.sv += r.saves; a.dc += r.dc;
      a.yc += r.yc; a.rc += r.rc; a.og += r.og; a.pm += r.pm;
      a.pts += r.total_points;
      a.last.push(r.total_points); if (a.last.length > 3) a.last.shift();
    }
  }

  const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
  const mae = (b) => ({
    n: b.n,
    model: r3(b.model / b.n),
    form: r3(b.form / b.n),
    ppg: r3(b.ppg / b.n),
    beatsForm: b.model < b.form,
  });
  const bands = {};
  for (const b of BANDS) {
    const s = band[b.key];
    bands[b.key] = {
      label: b.label, n: s.n,
      model: r3(Math.sqrt(s.model / s.n)),
      form: r3(Math.sqrt(s.form / s.n)),
      ppg: r3(Math.sqrt(s.ppg / s.n)),
    };
  }
  return {
    season,
    mode: era.xg ? 'shipping' : 'proxy',
    era,
    gws: gws.length,
    appear: mae(appear),
    all: mae(all),
    bands,
  };
}

/* ── run ────────────────────────────────────────────────────────────── */

const out = [];
for (const season of SEASONS) {
  const res = runSeason(season);
  if (!res) { process.stdout.write(`${season}: no data, skipped\n`); continue; }
  out.push(res);
  process.stdout.write(
    `${season} [${res.mode.padEnd(8)}] appearance-conditional MAE  ` +
    `model ${String(res.appear.model).padEnd(6)} · form ${String(res.appear.form).padEnd(6)} · ` +
    `PPG ${String(res.appear.ppg).padEnd(6)} · beats form: ${res.appear.beatsForm ? 'YES' : 'no'}  ` +
    `(n=${res.appear.n})\n`,
  );
}

if (!out.length) {
  console.error('No seasons available — run: node scripts/history/fetch-seasons.mjs');
  process.exit(0);
}

const shipping = out.filter((s) => s.mode === 'shipping');
const wins = shipping.filter((s) => s.appear.beatsForm).length;

/* Only the shipping-mode seasons are pooled. The proxy seasons are reported
   individually and never folded into a headline. */
const pooled = (key) => {
  let n = 0, model = 0, form = 0, ppg = 0;
  for (const s of shipping) {
    n += s[key].n;
    model += s[key].model * s[key].n;
    form += s[key].form * s[key].n;
    ppg += s[key].ppg * s[key].n;
  }
  const r3 = (x) => Math.round((x / n) * 1000) / 1000;
  return { n, model: r3(model), form: r3(form), ppg: r3(ppg), beatsForm: model < form };
};

const artefact = {
  v: 1,
  built: new Date().toISOString().slice(0, 10),
  method: 'Walk-forward, no lookahead. Fixture conditioning neutralised, so this grades the per-90 scoring core rather than the fixture model. Appearance-conditional MAE is the headline; see dev/backtest-history.mjs.',
  modes: {
    shipping: 'The model as it ships, on the expected-goals inputs it actually reads. Available from 2022-23, when those columns enter the dataset.',
    proxy: 'The same model structure fed realised rates in place of the expected ones that did not exist yet. A different, noisier model — reported for shape, never pooled into a headline.',
  },
  seasons: out,
  shippingSeasons: shipping.length,
  shippingBeatsForm: wins,
  pooled: shipping.length ? { appear: pooled('appear'), all: pooled('all') } : null,
};

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(OUT, JSON.stringify(artefact));

process.stdout.write(
  `\nShipping-mode seasons: ${shipping.length}. Beat the 3-gameweek form baseline in ${wins} of ${shipping.length}.\n`,
);
if (artefact.pooled) {
  const p = artefact.pooled.appear;
  process.stdout.write(
    `Pooled appearance-conditional MAE (shipping only, n=${p.n.toLocaleString()}): ` +
    `model ${p.model} · form ${p.form} · PPG ${p.ppg}\n`,
  );
}
process.stdout.write(`Proxy-mode seasons reported separately: ${out.length - shipping.length}.\n`);
process.stdout.write(`→ ${OUT}\n`);
