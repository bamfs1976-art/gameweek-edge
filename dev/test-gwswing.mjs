/*
 * Offline test for the fixture-swing gameweek ranking (gwSwing in index.html).
 * The model helpers it calls (plsimRatings / plsimMatch / plsimDiff) are
 * already covered by test-core, so here we STUB plsimMatch to null — which
 * routes gwSwing through the fixture-difficulty fallback — and feed controlled
 * difficulties + ownership. That makes the aggregation, ownership weighting and
 * ranking deterministic, and proves the key design point: the raw league mean
 * is flat, so the ranking must use the ownership-weighted mean.
 *
 * Run: node dev/test-gwswing.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/* Comment/string-aware brace matcher (apostrophes in comments are safe). */
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
  throw new Error('unbalanced');
}
const grabFn = (n) => extractBlock(html, html.indexOf('function ' + n + '('));

/* Stub the model layer so gwSwing uses the fixture-difficulty fallback. */
const gwSwing = new Function(
  'const MEM={};\n' +
  'function plsimRatings(){return {att:{},def:{}};}\n' +
  'function plsimMatch(){return null;}\n' +          // null -> gwSwing reads f.team_*_difficulty
  'function plsimDiff(){return 3;}\n' +
  /* The real "still to be played" rule, not a stub: gwSwing must not rank a
     gameweek on games that have already been played. */
  grabFn('fixtureOver') + '\n' + grabFn('fixtureToCome') + '\n' +
  grabFn('gwSwing') + '\nreturn gwSwing;'
)();

let failures = 0, passes = 0;
const ok = (c, label) => { if (c) passes++; else { failures++; console.error('  ✗ ' + label); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
console.log('• gwSwing: fixture-swing gameweek ranking');

/* Teams 1,2 are heavily owned; 3,4 owned nothing. */
const els = [];
[[1, 100], [2, 80], [3, 0], [4, 0]].forEach(([team, own]) =>
  els.push({ team, element_type: 3, selected_by_percent: String(own), minutes: 0, expected_goal_involvements_per_90: '0' }));
const b = {
  raw: { teams: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] },
  teams: { 1: {}, 2: {}, 3: {}, 4: {} },
  elements: els,
  upcoming: { id: 10 },
};
const fx = (event, h, a, dh, da) => ({ event, team_h: h, team_a: a, team_h_difficulty: dh, team_a_difficulty: da });
const fixtures = [
  /* GW10: the OWNED teams (1,2) get the easy end (diff 1); unowned get diff 5. */
  fx(10, 1, 3, 1, 5), fx(10, 2, 4, 1, 5),
  /* GW11: mirror image — owned teams face the hard end (diff 5). */
  fx(11, 1, 3, 5, 1), fx(11, 2, 4, 5, 1),
  /* GW12: everyone middling (diff 3). */
  fx(12, 1, 2, 3, 3), fx(12, 3, 4, 3, 3),
];

const r = gwSwing(b, fixtures, 5);
ok(r.gws.length === 3, 'three gameweeks aggregated');
ok(r.best.length === 3 && r.worst.length === 3, 'best/worst cover every gameweek');

const g = Object.fromEntries(r.gws.map((x) => [x.gw, x]));
/* Raw mean is identical across GW10/11 (favourite+underdog cancel) — the flaw the design fixes. */
ok(near(g[10].meanDiff, 3) && near(g[11].meanDiff, 3), 'raw league mean is flat (1+5+1+5)/4 = 3 both weeks');
/* Ownership weighting separates them: owned teams easy in GW10, hard in GW11. */
ok(g[10].wMean < g[11].wMean, 'ownership-weighted mean is lower when owned teams have easy fixtures');
ok(near(g[10].wMean, 1), 'GW10 owned-weighted mean = 1 (owned teams all diff 1)');
ok(near(g[11].wMean, 5), 'GW11 owned-weighted mean = 5 (owned teams all diff 5)');

/* Ranking follows the weighted mean. */
ok(r.best[0].gw === 10, 'easiest week (by owned fixtures) ranks first in best');
ok(r.worst[0].gw === 11, 'toughest week ranks first in worst');
ok(r.best.every((x, i, a) => i === 0 || a[i - 1].wMean <= x.wMean), 'best is sorted ascending by weighted mean');

/* Easy-fixture counts (difficulty <= 2). */
ok(g[10].easy === 2, 'GW10 has two easy fixtures (the diff-1 entries)');
ok(g[12].easy === 0, 'GW12 (all diff 3) has no easy fixtures');
ok(g[10].n === 4, 'four team-fixtures counted per gameweek');

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
