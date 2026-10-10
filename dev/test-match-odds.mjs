/*
 * Market odds in the match model (P12): the feed parser, odds into goal
 * rates, bookmaker names to FPL ids, the fixture match, plsimMatch preferring
 * the market, and the scoreline grid.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { extractFn, extractDecl } from './extract.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const feed = require(join(ROOT, 'netlify', 'functions', 'match-odds.js'));
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const block = (n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('};', i) + 2); };
const M = new Function([
  'const MEM={};', extractDecl(html, 'PLSIM_PROMOTED'), 'const PLSIM_ALIAS={};', block('MKT_ALIAS'),
  ...['ELO_SCALE', 'ELO_ATT', 'ELO_DEF', 'ELO_CLAMP'].map((n) => extractDecl(html, n)),
  "const PLSIM={BASE_H:1.62,BASE_A:1.32,RHO:" + html.match(/RHO:(-?[\d.]+)/)[1] + ",PRIOR_W:8,ITER:24,priors:{}};",
  ...['poisson', 'eloMean', 'eloPrior', 'plsimPrior', 'recencyWeight', 'availAttackMult', 'plsimRatings', 'plsimMatch',
    'mktImplied', 'mktTeamId', 'marketRates'].map((n) => extractFn(html, n)),
].join('\n') + '\nreturn {plsimRatings,plsimMatch,mktImplied,mktTeamId,marketRates};')();

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; } };

const CSV = '﻿Div,Date,Time,HomeTeam,AwayTeam,B365H,B365D,B365A,AvgH,AvgD,AvgA,B365>2.5,B365<2.5,Avg>2.5,Avg<2.5\r\n'
  + 'E0,17/10/2026,15:00,Man United,Tottenham,2.10,3.50,3.40,2.05,3.45,3.50,1.80,2.00,1.78,2.05\r\n'
  + 'E0,17/10/26,17:30,Arsenal,Hull,1.20,7.00,13.0,,,,1.50,2.60,,\r\n'
  + 'E1,17/10/2026,15:00,Leeds,Derby,1.9,3.4,4.2,1.9,3.4,4.2,1.9,1.9,1.9,1.9\r\n'
  + 'E0,18/10/2026,14:00,Chelsea,Fulham,0,3.5,4,,,,,,,\r\n';

t('the feed keeps Premier League rows, de-vigs, and falls back by bookmaker', () => {
  const rows = feed.oddsRows(feed.parseCsv(CSV));
  assert.equal(rows.length, 2, 'E1 and the broken Chelsea row are dropped');
  const [a, b] = rows;
  assert.equal(a.date, '2026-10-17'); assert.equal(a.home, 'Man United');
  assert.ok(Math.abs(a.pH + a.pD + a.pA - 1) < 1e-3, 'fair 1X2 sums to one');
  assert.ok(a.pH > a.pA && a.pOver > 0.5 && a.pOver < 0.6);
  assert.equal(b.date, '2026-10-17', 'two-digit years read as 20xx');
  assert.ok(b.pH > 0.75 && b.pOver > 0.6, 'no market average, Bet365 used');
});

t('a bad price spoils the set rather than half-reading it', () => {
  assert.equal(feed.fair(['2.0', '', '3.0']), null);
  assert.equal(feed.fair(['0.9', '3', '4']), null);
  assert.equal(feed.isoDate('2026-10-17'), null);
});

const r0 = { att: { 1: 1, 2: 1 }, def: { 1: 1, 2: 1 }, hom: { 1: 1, 2: 1 } };
t('odds into goal rates reproduce the chances they came from', () => {
  for (const [hx, ax] of [[1.8, 0.9], [1.1, 1.4], [2.6, 0.5]]) {
    const m = M.plsimMatch({ ...r0, mkt: { '1-2': { hx, ax } } }, 1, 2);
    const over = 1 - [0, 1, 2].reduce((s, n) => s + m.sg.flat().filter((_, k) => Math.floor(k / 6) + (k % 6) === n).reduce((x, y) => x + y, 0), 0);
    const lam = M.mktImplied(m.pH, m.pA, over);
    assert.ok(lam && Math.abs(lam[0] - hx) < 0.03 && Math.abs(lam[1] - ax) < 0.03, `${hx}/${ax} -> ${lam}`);
  }
  assert.equal(M.mktImplied(0.5, 0.3, null), null);
  assert.equal(M.mktImplied(0.95, 0.9, 0.5), null, 'impossible prices are rejected');
});

const teams = [{ id: 1, name: 'Man Utd', short_name: 'MUN' }, { id: 2, name: 'Spurs', short_name: 'TOT' },
  { id: 3, name: "Nott'm Forest", short_name: 'NFO' }, { id: 4, name: 'Hull', short_name: 'HUL' }];
t('bookmaker names match FPL names, including the ones that differ', () => {
  assert.equal(M.mktTeamId('Man United', teams), 1);
  assert.equal(M.mktTeamId('Tottenham', teams), 2);
  assert.equal(M.mktTeamId("Nott'm Forest", teams), 3);
  assert.equal(M.mktTeamId('Hull', teams), 4);
  assert.equal(M.mktTeamId('Derby', teams), null);
});

const b = { raw: { teams }, teams: Object.fromEntries(teams.map((x) => [x.id, x])), elements: [] };
const fx = [
  { id: 10, event: 8, team_h: 1, team_a: 2, finished: false, kickoff_time: '2026-10-17T14:00:00Z' },
  { id: 11, event: 8, team_h: 3, team_a: 4, finished: false, kickoff_time: '2026-10-17T14:00:00Z' },
  { id: 12, event: 1, team_h: 2, team_a: 1, finished: true, team_h_score: 1, team_a_score: 1, kickoff_time: '2026-08-16T14:00:00Z' },
];
const odds = [
  { date: '2026-10-17', home: 'Man United', away: 'Tottenham', pH: 0.45, pD: 0.27, pA: 0.28, pOver: 0.55 },
  { date: '2026-10-17', home: "Nott'm Forest", away: 'Hull', pH: 0.6, pD: 0.24, pA: 0.16, pOver: null },
];
t('only priced, matched, unfinished fixtures take market rates', () => {
  const mk = M.marketRates(b, fx, odds);
  assert.deepEqual(Object.keys(mk), ['1-2'], 'the row with no over/under price is skipped');
  assert.equal(M.marketRates(b, fx.map((f) => ({ ...f, finished: true })), odds), null);
  assert.equal(M.marketRates(b, fx, [{ ...odds[0], date: '2026-10-25' }]), null, 'a week off is not this fixture');
});

t('plsimMatch prefers the market and says so', () => {
  const R = M.plsimRatings({ ...b, odds }, fx);
  const m = M.plsimMatch(R, 1, 2), n = M.plsimMatch(R, 3, 4);
  assert.equal(m.src, 'market'); assert.equal(n.src, 'model');
  assert.ok(Math.abs(m.pH - 0.45) < 0.02 && Math.abs(m.pA - 0.28) < 0.02, 'market chances come back out');
  const R2 = M.plsimRatings(b, fx);
  assert.equal(M.plsimMatch(R2, 1, 2).src, 'model', 'without odds the memo is not reused');
});

t('the scoreline grid is a 6 x 6 of chances whose top cell is the likely score', () => {
  const m = M.plsimMatch({ ...r0, mkt: { '1-2': { hx: 1.7, ax: 1.0 } } }, 1, 2);
  assert.equal(m.sg.length, 6); assert.ok(m.sg.every((r) => r.length === 6));
  const flat = m.sg.flat(), top = flat.indexOf(Math.max(...flat));
  assert.equal(Math.floor(top / 6), m.mlH); assert.equal(top % 6, m.mlA);
  const tot = flat.reduce((a, c) => a + c, 0);
  assert.ok(tot > 0.95 && tot <= 1 + 1e-9, 'the grid covers almost every outcome');
});

t('the app and the server agree on the API route and the source note', () => {
  assert.ok(html.includes("apiBase()+'/api/match-odds'"));
  assert.ok(readFileSync(join(ROOT, 'netlify.toml'), 'utf8').includes('from = "/api/match-odds"'));
  assert.ok(html.includes('football-data.co.uk'), 'the source is credited where odds are used');
});

console.log(`• market odds: ${passed} checks passed`);
