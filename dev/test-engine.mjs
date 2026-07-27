/*
 * Tests for the shared-engine extraction (scripts/extract-engine.mjs).
 *
 * Euro Matchday Edge runs on model code lifted out of Gameweek Edge's index.html
 * at build time. If that lift is wrong, the second app is wrong in ways no
 * panel test would catch — so the extraction itself is tested here:
 *
 *  1. the scanner respects regex literals (the bug that makes the older
 *     extractors swallow half the file when they hit `esc`);
 *  2. every declared engine function comes out as exactly that function;
 *  3. the emitted bundle parses, runs, and exports what it claims;
 *  4. the model inside it produces the same answers as the model in the app.
 *
 * Run: node dev/test-engine.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { sliceBalanced, buildEngine, ENGINE_FNS, ENGINE_CONSTS } from '../scripts/extract-engine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let failures = 0, passes = 0;
const ok = (c, label) => { if (c) passes++; else { failures++; console.error('  ✗ ' + label); } };

console.log('• sliceBalanced: braces that are not braces');
{
  /* Each of these hides a `}` somewhere the naive scanner would count it. */
  const cases = [
    ['string', 'function f(){ var s = "}"; return 1; }'],
    ['single-quoted', "function f(){ var s = '}'; return 1; }"],
    ['template', 'function f(){ var s = `}`; return 1; }'],
    ['template expr', 'function f(){ var s = `${ {a:1}.a }`; return 1; }'],
    ['line comment', 'function f(){ // }\n return 1; }'],
    ['block comment', 'function f(){ /* } */ return 1; }'],
    ['regex class', 'function f(){ return /[}]/.test("x"); }'],
    ['regex escape', 'function f(){ return /\\}/.test("x"); }'],
    ['division not regex', 'function f(){ var a = 4; var b = a /2/ 1; return b; }'],
  ];
  for (const [label, src] of cases) {
    const got = sliceBalanced(src, 0);
    ok(got === src, 'captures the whole function, no more no less: ' + label);
  }

  /* The real regression: `esc` contains the character class /[&<>"']/g, whose
     quotes make a string-only scanner run past the closing brace. */
  const escSrc = sliceBalanced(html, html.indexOf('function esc('));
  ok(escSrc.startsWith('function esc(') && escSrc.endsWith('}'), 'esc is bounded');
  ok(escSrc.length < 400, 'esc is not over-captured (' + escSrc.length + ' bytes)');
  ok((escSrc.match(/\bfunction\b/g) || []).length === 1,
    'esc capture contains exactly one function, not the rest of the file');
}

console.log('• every declared engine member extracts cleanly');
{
  for (const name of ENGINE_FNS) {
    const at = html.indexOf('function ' + name + '(');
    ok(at >= 0, name + ': present in index.html');
    if (at < 0) continue;
    const src = sliceBalanced(html, at);
    ok(src.endsWith('}'), name + ': capture is brace-balanced');
    /* A capture that swallowed a neighbour would contain a second top-level
       `function <name>(` — the cheapest reliable over-capture detector. */
    const topLevel = (src.match(/^function [A-Za-z0-9_$]+\(/gm) || []).length;
    ok(topLevel === 1, name + ': capture holds one top-level function (' + topLevel + ')');
    let parsed = true;
    try { new vm.Script('(' + src + ')'); } catch (_) { parsed = false; }
    ok(parsed, name + ': capture parses on its own');
  }
  for (const name of ENGINE_CONSTS) {
    ok(html.includes('const ' + name + '='), name + ': constant present in index.html');
  }
}

console.log('• the emitted bundle runs and exports what it declares');
{
  const src = buildEngine(html);
  let ran = true, err = '';
  const ctx = { window: {} };
  vm.createContext(ctx);
  try { new vm.Script(src, { filename: 'engine.js' }).runInContext(ctx); }
  catch (e) { ran = false; err = e.message; }
  ok(ran, 'bundle parses and executes' + (ran ? '' : ' — ' + err));
  if (!ran) { report(); process.exit(1); }

  const E = ctx.window.GEEngine;
  ok(!!E, 'window.GEEngine is assigned');
  for (const n of [...ENGINE_FNS, ...ENGINE_CONSTS]) ok(E[n] !== undefined, n + ': exported');
  ok(typeof E.setRules === 'function' && typeof E.getRules === 'function', 'rules can be swapped');

  /* The engine must not drag app-level globals in with it. */
  ok(!/\bGAME\b/.test(src), 'no reference to the game pack leaks into the engine');
  ok(!/document\.|getElementById/.test(src), 'no DOM access leaks into the engine');
  ok(!/\/api\//.test(src), 'no endpoint leaks into the engine');

  console.log('• the engine model agrees with the app model');
  /* Same pool, same options as dev/test-social.mjs uses against the in-app
     optimiser: if the extraction were subtly wrong these would diverge. */
  const pool = [];
  let id = 1;
  const add = (type, n) => {
    for (let i = 0; i < n; i++) {
      pool.push({ el: { id: id++, element_type: type, now_cost: 40 + ((i * 7) % 45),
        team: 1 + (i % 6), web_name: 't' + type + 'p' + i }, p: 1 + ((i * 13) % 17) / 2.7 });
    }
  };
  add(1, 4); add(2, 7); add(3, 7); add(4, 5);

  const got = E.squadOptimise(pool, { budget: 1000, topN: 99, cheapN: 99 });
  ok(!!got && got.squad.length === 15, 'engine optimiser builds a legal 15');
  ok(got && Math.abs(got.xiXP - 55.07) < 0.01, 'engine optimiser matches the app total (' +
    (got ? got.xiXP.toFixed(2) : 'null') + ')');

  /* Poisson is the load-bearing primitive under every clean-sheet number. */
  ok(Math.abs(E.poisson(2, 1.5) - 0.2510214) < 1e-6, 'poisson agrees to 6dp');
  /* A flat LG_GRID×LG_GRID Float64Array of scoreline probabilities. */
  const grid = E.lgScoreGrid(1.6, 1.2);
  let mass = 0;
  for (const p of grid) mass += p;
  ok(grid.length === E.LG_GRID * E.LG_GRID, 'score grid is LG_GRID² cells');
  ok(Math.abs(mass - 1) < 1e-9, 'score grid normalises to 1 (' + mass.toFixed(9) + ')');
  const cs = E.lgCleanSheets(grid);
  ok(cs.length === 2 && cs[0] > 0 && cs[0] < 1 && cs[1] > 0 && cs[1] < 1,
    'clean-sheet probabilities are real probabilities');
  ok(cs[0] > cs[1], 'the stronger home side keeps more clean sheets than it concedes to');

  /* Rules are swappable — the whole point, since UCL is not 15/11/3. */
  E.setRules({ squadSize: 11, xiSize: 11, teamLimit: 5, budget: 1000,
    need: { 1: 1, 2: 4, 3: 4, 4: 2 }, minPlay: { 1: 1, 2: 3, 3: 2, 4: 1 },
    maxPlay: { 1: 1, 2: 5, 3: 5, 4: 3 }, sellFee: 0, moneyDiv: 10 });
  ok(E.getRules().squadSize === 11, 'a different game\'s squad shape takes effect');
  ok(E.minClubsForXi(E.getRules()) === 3, 'derived club minimum follows the new cap');
}

function report() {
  console.log('\n' + passes + ' passed, ' + failures + ' failed');
}
report();
process.exit(failures ? 1 : 0);
