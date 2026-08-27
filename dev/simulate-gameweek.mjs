/*
 * Simulate the model's gameweek outputs — the things a manager actually
 * decides each week — from the shipping nativeXP plus a per-player Monte
 * Carlo of the points distribution (floor / median / ceiling, haul and
 * blank probabilities). Demonstrates how the statistical model informs
 * captaincy, differentials, value and team selection.
 *
 * The player inputs below are ILLUSTRATIVE (plausible per-90 stats), so
 * the numbers are a demonstration of the model's logic, not a published
 * forecast. Swap in a real bootstrap snapshot to run it live.
 *
 * Run: node dev/simulate-gameweek.mjs            (prints the report)
 *      node dev/simulate-gameweek.mjs --html out.html   (also writes a page)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractBlock, extractDecl } from './extract.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/* minutesModel now depends on the fixture-congestion helper; historical runs
   pass no congestion, so congestionFactor returns 1 and nothing changes. */
const congestSrc = ['CONGEST_FULL', 'CONGEST_FADE', 'CONGEST_MAX', 'CONGEST_NAILED', 'CONGEST_TO_BENCH']
  .map(n => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); })
  .join('\n') + '\n' + extractBlock(html, html.indexOf('function congestionFactor('));
/* nativeXP reads the points table from SCORING rather than restating it
   inline, so this context has to supply it or the extracted function throws
   the moment it is called. */
const scoringSrc = extractDecl(html, 'SCORING_FALLBACK') + '\nlet SCORING = SCORING_FALLBACK;';
const nativeXP = new Function(
  scoringSrc + '\n' +
  congestSrc + '\n' +
  extractBlock(html, html.indexOf('function minutesModel(')) + '\n' +
  extractBlock(html, html.indexOf('function concedePts(')) + '\n' +
  extractBlock(html, html.indexOf('function savePts(')) + '\n' +
  extractBlock(html, html.indexOf('function dcHitProb(')) + '\n' +
  extractBlock(html, html.indexOf('function effGoalRate(')) + '\n' +
  extractBlock(html, html.indexOf('function negRate90(')) + '\n' +
  extractBlock(html, html.indexOf('function nativeXP(')) + '\nreturn nativeXP;')();

/* deterministic RNG + samplers */
const rng = (a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; })(424242);
const pois = l => { if (l <= 0) return 0; const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rng(); } while (p > L); return k - 1; };
const bern = p => rng() < p ? 1 : 0;

/* per-player points distribution — the model, simulated */
function dist(p, nf, trials = 20000) {
  const gp = nf.gp, mpg = p.minutes / gp, fx = nf.lam / nf.lamAvg;
  const xg = parseFloat(p.expected_goals_per_90), xa = parseFloat(p.expected_assists_per_90);
  const dcp = parseFloat(p.defensive_contribution_per_90 || '0'), type = p.element_type;
  const gPts = type <= 2 ? 6 : type === 3 ? 5 : 4, csPts = type <= 2 ? 4 : type === 3 ? 1 : 0, thr = type === 2 ? 10 : 12;
  const b90 = (p.bonus || 0) * 90 / Math.max(p.minutes, 90), sv90 = (p.saves || 0) * 90 / Math.max(p.minutes, 90);
  const out = new Array(trials);
  for (let t = 0; t < trials; t++) {
    let s = (mpg > 0 ? 1 : 0) + (mpg >= 60 ? 1 : 0);
    s += pois(xg * (mpg / 90) * fx) * gPts + pois(xa * (mpg / 90) * fx) * 3;
    if (mpg >= 60) s += bern(nf.cs) * csPts;
    s += Math.min(3, pois(b90 * (mpg / 90)));
    if (type >= 2 && mpg >= 60 && pois(dcp * (mpg / 90)) >= thr) s += 2;
    if (type === 1) s += Math.floor(pois(sv90 * (mpg / 90)) / 3);
    out[t] = s;
  }
  out.sort((a, b) => a - b);
  const q = f => out[Math.min(trials - 1, Math.floor(f * trials))];
  const mean = out.reduce((a, b) => a + b, 0) / trials;
  return { mean, p10: q(0.10), p50: q(0.50), p90: q(0.90),
    haul: out.filter(x => x >= 10).length / trials, blank: out.filter(x => x <= 2).length / trials };
}

/* ── illustrative roster (synthetic per-90 inputs) ──────── */
const P = (web_name, team, element_type, price, minutes, xg, xa, dcp, bonus, saves) =>
  ({ web_name, team, element_type, price, minutes, starts: 6, status: 'a', chance_of_playing_next_round: null,
     expected_goals_per_90: String(xg), expected_assists_per_90: String(xa),
     defensive_contribution_per_90: String(dcp), bonus, saves: saves || 0 });
const roster = [
  P('Raya', 'ARS', 1, 5.6, 540, 0, 0, 0, 8, 22),
  P('Sánchez', 'CHE', 1, 5.0, 540, 0, 0, 0, 5, 26),
  P('Gabriel', 'ARS', 2, 6.3, 540, 0.16, 0.06, 13, 14, 0),
  P('Gvardiol', 'MCI', 2, 6.1, 500, 0.10, 0.14, 9, 10, 0),
  P('Muñoz', 'CRY', 2, 5.5, 540, 0.08, 0.16, 15, 12, 0),
  P('Hall', 'NEW', 2, 5.2, 520, 0.06, 0.18, 11, 9, 0),
  P('M.Salah', 'LIV', 3, 12.8, 540, 0.55, 0.38, 3, 18, 0),
  P('Palmer', 'CHE', 3, 10.7, 540, 0.45, 0.34, 5, 16, 0),
  P('Saka', 'ARS', 3, 10.2, 500, 0.40, 0.36, 4, 14, 0),
  P('Rice', 'ARS', 3, 6.5, 540, 0.12, 0.20, 14, 10, 0),
  P('Mbeumo', 'BRE', 3, 7.4, 540, 0.38, 0.22, 6, 9, 0),
  P('Gordon', 'NEW', 3, 7.3, 520, 0.30, 0.28, 7, 8, 0),
  P('Haaland', 'MCI', 4, 15.1, 540, 0.95, 0.20, 2, 20, 0),
  P('Isak', 'NEW', 4, 10.4, 500, 0.62, 0.16, 3, 12, 0),
  P('Watkins', 'AVL', 4, 9.0, 520, 0.48, 0.22, 4, 10, 0),
  P('Wood', 'NFO', 4, 7.2, 500, 0.52, 0.10, 5, 8, 0),
];
/* a plausible fixture context per team (attack multiplier lam, CS odds) */
const FIX = { ARS: [1.9, 0.48], MCI: [2.1, 0.50], LIV: [1.8, 0.42], CHE: [1.7, 0.38], NEW: [1.6, 0.36],
  CRY: [1.4, 0.30], BRE: [1.5, 0.28], AVL: [1.5, 0.30], NFO: [1.3, 0.26] };
const nfFor = team => { const [lam, cs] = FIX[team] || [1.47, 0.28]; return { gp: 6, lam, lamAvg: 1.5, cs }; };

const rows = roster.map(p => {
  const nf = nfFor(p.team);
  const xp = nativeXP(p, nf);
  const d = dist(p, nf);
  return { p, xp, ...d, val: xp / p.price };
});

const POS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const pad = (s, n) => String(s).padEnd(n), rp = (s, n) => String(s).padStart(n);

function line(r) { return '  ' + pad(r.p.web_name, 10) + pad(POS[r.p.element_type] + ' ' + r.p.team, 8) +
  rp('£' + r.p.price.toFixed(1), 6) + rp(r.xp.toFixed(1), 7) + rp(r.p50, 6) + rp(r.p10 + '–' + r.p90, 9) +
  rp((100 * r.haul).toFixed(0) + '%', 7) + rp((100 * r.blank).toFixed(0) + '%', 7); }

const report = [];
report.push('GAMEWEEK MODEL OUTPUTS  (illustrative inputs — demonstrates the model logic)\n');
report.push('  Player    Pos/Team  Price     xP  med   floor–ceil  haul%  blank%');
report.push('  ----------------------------------------------------------------------');
const capOrder = rows.slice().sort((a, b) => b.mean - a.mean);
capOrder.forEach(r => report.push(line(r)));

report.push('\n► CAPTAIN — highest expected points, with the risk band:');
capOrder.slice(0, 3).forEach((r, i) =>
  report.push(`  ${i + 1}. ${r.p.web_name} — ${r.xp.toFixed(1)} xP · median ${r.p50}, ceiling ${r.p90}, ${(100 * r.haul).toFixed(0)}% to haul, ${(100 * r.blank).toFixed(0)}% blank`));

report.push('\n► DIFFERENTIAL CEILING — biggest upside outside the premiums (by P90):');
rows.filter(r => r.p.price <= 8).sort((a, b) => b.p90 - a.p90).slice(0, 3).forEach(r =>
  report.push(`  • ${r.p.web_name} (£${r.p.price.toFixed(1)}) — ceiling ${r.p90}, ${(100 * r.haul).toFixed(0)}% to haul`));

report.push('\n► BEST VALUE — expected points per £m:');
rows.slice().sort((a, b) => b.val - a.val).slice(0, 4).forEach(r =>
  report.push(`  • ${r.p.web_name} (${POS[r.p.element_type]}, £${r.p.price.toFixed(1)}) — ${r.val.toFixed(2)} xP/£m (${r.xp.toFixed(1)} xP)`));

/* greedy team selection: best XP under a formation, then captain the top */
function pickXI(rows) {
  const need = { 1: 1, 2: 4, 3: 4, 4: 2 };
  const by = t => rows.filter(r => r.p.element_type === t).sort((a, b) => b.xp - a.xp);
  const xi = [];
  Object.keys(need).forEach(t => by(+t).slice(0, need[t]).forEach(r => xi.push(r)));
  return xi;
}
const xi = pickXI(rows);
const xiXP = xi.reduce((s, r) => s + r.xp, 0) + Math.max(...xi.map(r => r.xp));
report.push('\n► MODEL XI (4-4-2, best XP; captain doubles the top pick):');
report.push('  ' + xi.map(r => r.p.web_name).join(', '));
report.push(`  Projected: ${xiXP.toFixed(1)} pts  (captain: ${xi.slice().sort((a, b) => b.xp - a.xp)[0].p.web_name})`);

const text = report.join('\n');
console.log(text);

/* optional HTML page for a visual read */
const htmlIdx = process.argv.indexOf('--html');
if (htmlIdx > -1 && process.argv[htmlIdx + 1]) {
  const x = v => 100 * v / 22;
  const bar = (lo, hi, med) => `<div class="band"><div class="fill" style="left:${x(lo)}%;width:${x(hi) - x(lo)}%"></div><div class="med" style="left:${x(med)}%"></div></div>`;
  const tr = r => `<tr><td class="nm">${r.p.web_name}</td><td class="mut">${POS[r.p.element_type]} · ${r.p.team}</td><td class="r">£${r.p.price.toFixed(1)}</td><td class="r b">${r.xp.toFixed(1)}</td><td>${bar(r.p10, r.p90, r.p50)}</td><td class="r">${(100 * r.haul).toFixed(0)}%</td></tr>`;
  const page = `<title>Gameweek model outputs</title><style>
:root{--bg:#0A0C0F;--card:#12151b;--line:#262C34;--txt:#E6E8EB;--mut:#8A94A0;--grn:#1f9d5c;--grnb:#3ddc84}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.5 system-ui,sans-serif;padding:22px;max-width:820px}
h1{font-size:1.3rem;margin:0 0 2px}.sub{color:var(--mut);font-size:.85rem;margin-bottom:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:16px}
.card h2{font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin:0 0 10px}
table{width:100%;border-collapse:collapse}td{padding:7px 6px;border-bottom:1px solid var(--line);font-size:.86rem}
td.nm{font-weight:700}td.mut{color:var(--mut);font-size:.78rem}td.r{text-align:right;font-variant-numeric:tabular-nums}td.b{font-weight:800;color:var(--grnb)}
.band{position:relative;height:9px;background:#1b2027;border-radius:5px;min-width:120px}
.fill{position:absolute;top:0;bottom:0;background:linear-gradient(90deg,#1f9d5c55,#3ddc84);border-radius:5px}
.med{position:absolute;top:-2px;bottom:-2px;width:2px;background:#fff}
.pick{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}.pick b{color:var(--grnb)}
.tag{font-family:ui-monospace,monospace;font-size:.72rem;color:var(--mut)}</style>
<h1>Gameweek model outputs</h1><div class="sub">Enhanced nativeXP + Monte-Carlo distribution · illustrative inputs, live model logic</div>
<div class="card"><h2>Captaincy — ranked by expected points, with the floor→ceiling band</h2>
<table><tr class="tag"><td>Player</td><td>Pos</td><td class="r">Price</td><td class="r">xP</td><td>P10 → P90</td><td class="r">Haul</td></tr>
${capOrder.map(tr).join('')}</table></div>
<div class="card"><h2>The call</h2>
${capOrder.slice(0, 3).map((r, i) => `<div class="pick"><b>C${i ? i + 1 : ''}</b><div>${r.p.web_name} — <b>${r.xp.toFixed(1)} xP</b> · median ${r.p50}, ceiling ${r.p90} · ${(100 * r.haul).toFixed(0)}% to haul, ${(100 * r.blank).toFixed(0)}% blank</div></div>`).join('')}
<div class="pick"><b>XI</b><div>${xi.map(r => r.p.web_name).join(', ')} — projected <b>${xiXP.toFixed(1)} pts</b></div></div></div>`;
  writeFileSync(process.argv[htmlIdx + 1], page);
  console.error('\nWrote ' + process.argv[htmlIdx + 1]);
}
