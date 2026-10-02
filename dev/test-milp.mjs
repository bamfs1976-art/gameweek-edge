/*
 * The exact transfer plan (milpPlanLP + HiGHS) against the beam search it
 * sits beside, on the beam's own valuation, over seeded random leagues.
 *
 * What must hold:
 *   - every exact plan is legal week by week: fifteen players in the right
 *     shape, at most three per club, never overdrawn;
 *   - its hits are what the free transfers say they are;
 *   - replayed on the shared yardstick (planValuer.scorePlan), it is never
 *     worse than the beam's plan, because it solves the problem the beam
 *     approximates. The beam leaves the captain out of its search; the
 *     yardstick counts him for both.
 *
 * Runs the vendored engine (vendor/highs.js + highs.wasm) in Node.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractFn, extractDecl } from './extract.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
let failures = 0, n = 0;
const ok = (c, label) => { n++; if (!c) { failures++; console.error('  ✗ ' + label); } else console.log('  ok  ' + label); };

/* The engine, as the browser loads it. */
const ctx = vm.createContext({ window: {}, console, WebAssembly, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance });
ctx.globalThis = ctx;
vm.runInContext(readFileSync(join(ROOT, 'vendor', 'highs.js'), 'utf8'), ctx);
/* The browser fetches highs.wasm beside the script; here it is handed over
   through Emscripten's instantiation hook, which is what that fetch feeds. */
const wasm = readFileSync(join(ROOT, 'vendor', 'highs.wasm'));
const highs = await ctx.window.HiGHSLoader({ instantiateWasm: (imports, cb) => {
  WebAssembly.instantiate(wasm, imports).then((r) => cb(r.instance, r.module)); return {}; } });

const M = new Function([
  ...['RULES_FALLBACK', 'BENCH_W', 'FT_LADDER', 'FT_CAP', 'DECAY_BASE'].map((k) => extractDecl(html, k)),
  'let RULES = RULES_FALLBACK;',
  'const fixtureXP = (b, el, fx) => el._xp[fx.g] || 0;',
  ...['ftCap', 'ftValue', 'benchValue', 'bestXI', 'planValuer', 'solvePlanMulti', 'milpPlanLP', 'milpPlanDecode', 'solvePlanExact']
    .map((f) => extractFn(html, f)),
].join('\n') + '\nreturn {planValuer, solvePlanMulti, solvePlanExact, milpPlanLP};')();

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function league(seed, gws) {
  const r = rng(seed), els = [];
  let id = 1;
  for (let team = 1; team <= 20; team++) for (const [type, k] of [[1, 2], [2, 6], [3, 6], [4, 3]]) for (let j = 0; j < k; j++) {
    const q = r();
    const price = { 1: 40, 2: 40, 3: 45, 4: 45 }[type] + Math.round(q * (type === 1 ? 15 : 85));
    const _xp = {}; gws.forEach((g) => { _xp[g] = Math.max(0, (1.5 + q * 5) * (0.6 + r() * 0.8)); });
    els.push({ id: id++, team, element_type: type, now_cost: price, status: 'a', minutes: 900, chance_of_playing_next_round: null, _xp });
  }
  const gwFx = {}; for (let t = 1; t <= 20; t++) { gwFx[t] = {}; gws.forEach((g) => { gwFx[t][g] = [{ g }]; }); }
  /* A legal starting squad: the cheapest players, two of a club at most. */
  const squad = [], club = {};
  for (const [type, k] of [[1, 2], [2, 5], [3, 5], [4, 3]]) {
    let got = 0;
    for (const e of els.filter((x) => x.element_type === type).sort((a, c) => a.now_cost - c.now_cost)) {
      if (got >= k || (club[e.team] || 0) >= 2) continue;
      squad.push(e); club[e.team] = (club[e.team] || 0) + 1; got++;
    }
  }
  return { b: { elements: els }, gwFx, squad };
}
function legal(sq, bank) {
  const pos = { 1: 0, 2: 0, 3: 0, 4: 0 }, club = {};
  sq.forEach((e) => { pos[e.element_type]++; club[e.team] = (club[e.team] || 0) + 1; });
  return sq.length === 15 && new Set(sq.map((e) => e.id)).size === 15 && pos[1] === 2 && pos[2] === 5 && pos[3] === 5 && pos[4] === 3
    && Object.values(club).every((c) => c <= 3) && bank >= -1e-9;
}

const gws = [10, 11, 12];
let wins = 0, ties = 0, totalGain = 0;
for (const seed of [1, 2, 3, 4, 5, 6]) {
  const { b, gwFx, squad } = league(seed, gws);
  const bank = 15, ft = 1 + (seed % 3);
  const V = M.planValuer(b, gwFx, gws);
  const beam = M.solvePlanMulti(b, gwFx, gws, squad, bank, ft);
  const exact = await M.solvePlanExact(b, gwFx, gws, squad, bank, ft, highs);
  ok(!exact.error && exact.plan, `seed ${seed}: the solver returns a plan (${exact.status || exact.error}, ${exact.ms} ms)`);
  if (exact.error) continue;
  let sq = squad.slice(), bk = bank, f = ft, legalAll = true, hitsOk = true;
  exact.plan.forEach((st) => {
    st.moves.forEach((m) => { sq = sq.filter((e) => e.id !== m.o.id).concat([m.c]); bk += m.o.now_cost - m.c.now_cost; });
    if (!legal(sq, bk)) legalAll = false;
    if (st.hit !== Math.max(0, st.moves.length - f) * 4) hitsOk = false;
    f = Math.min(5, Math.max(0, f - st.moves.length) + 1);
  });
  ok(legalAll, `seed ${seed}: every week's squad is legal and in budget`);
  ok(hitsOk, `seed ${seed}: hits match the free transfers`);
  const beamScore = beam.best ? V.scorePlan(squad, bank, ft, beam.best.plan) : V.scorePlan(squad, bank, ft, gws.map(() => ({ moves: [] })));
  if (process.env.DEBUG) console.log('   seed', seed, 'ft', ft, 'obj', exact.objective.toFixed(3), 'replayed', exact.score.toFixed(3), 'beam', beamScore.toFixed(3), 'beam plan', JSON.stringify(beam.best && beam.best.plan.map(p => p.moves.map(m => m.o.id + '>' + m.c.id))), 'exact plan', JSON.stringify(exact.plan.map(p => p.moves.map(m => m.o.id + '>' + m.c.id))));
  ok(exact.score >= beamScore - 1e-6, `seed ${seed}: exact ${exact.score.toFixed(2)} >= beam ${beamScore.toFixed(2)} on the shared yardstick`);
  if (exact.score > beamScore + 0.05) wins++; else ties++;
  totalGain += exact.score - beamScore;
}
/* The reason to have an exact solver at all: a horizon the beam cannot
   search well. Eight gameweeks must still solve in a few seconds. */
{
  const long = [10, 11, 12, 13, 14, 15, 16, 17];
  const { b, gwFx, squad } = league(7, long);
  const V = M.planValuer(b, gwFx, long);
  const beam = M.solvePlanMulti(b, gwFx, long, squad, 15, 1);
  const exact = await M.solvePlanExact(b, gwFx, long, squad, 15, 1, highs);
  const beamScore = beam.best ? V.scorePlan(squad, 15, 1, beam.best.plan) : 0;
  ok(!exact.error && exact.ms < 15000, `an eight-gameweek plan solves in ${exact.ms} ms (${exact.status})`);
  ok(exact.score >= beamScore - 1e-6, `and beats or matches the beam over eight weeks (${exact.score.toFixed(2)} vs ${beamScore.toFixed(2)})`);
}
console.log(`\n  exact beat the beam on ${wins} of ${wins + ties} leagues, by ${(totalGain / (wins + ties)).toFixed(2)} points per plan on average`);
console.log(failures ? `\n${failures} of ${n} check(s) failed` : `\n${n}/${n} checks passed`);
process.exit(failures ? 1 : 0);
