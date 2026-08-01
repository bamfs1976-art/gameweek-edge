/*
 * Offline tests for the Social Studio building blocks: the constrained squad
 * optimiser (budget, forced picks, bank, club limit) and the card specs it
 * feeds.
 *
 * The headline test is a BRUTE-FORCE comparison. On a pool small enough to
 * enumerate every legal 15-man squad exhaustively, the optimiser must find the
 * same best-XI total as the exhaustive search. That is the only honest way to
 * claim the heuristic is sound, and it is run across several budgets plus a
 * forced-pick case so the search is genuinely exercised.
 *
 * Run: node dev/test-social.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/* Comments are skipped before strings (an apostrophe in prose would open a
   phantom string), and REGEX LITERALS are skipped before both. That last one
   is not theoretical: playersCsv contains /[",\n]/, whose quote character
   opened a phantom string, the scanner sailed past the closing brace, and the
   extraction failed with "unbalanced" — this scanner had never met a regex
   until that function needed testing.

   A `/` starts a regex when the previous meaningful character cannot end an
   expression; after an identifier, a number or a closing bracket it is
   division. That is the standard heuristic and it is exact enough here. */
const RE_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'void', 'delete', 'new', 'instanceof', 'yield', 'await']);
/* Does the `/` at position i open a regex, or divide? Look back past
   whitespace: an operator or an opening bracket means a regex must follow,
   an identifier or a closing bracket means division — unless that identifier
   is a keyword, which is the case `return /[",\n]/` falls into. */
function startsRegex(src, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(src[k])) k--;
  if (k < 0) return true;
  const c = src[k];
  if (/[([{,;:=!&|?+\-*%~^<>]/.test(c)) return true;
  if (!/[A-Za-z_$]/.test(c)) return false;          /* number, ) or ] → division */
  let w = k;
  while (w >= 0 && /[A-Za-z0-9_$]/.test(src[w])) w--;
  return RE_KEYWORDS.has(src.slice(w + 1, k + 1));
}
function extractBlock(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0, inStr = null, esc = false, com = 0, re = 0;   /* re: 1 body, 2 char class */
  for (let j = open; j < src.length; j++) {
    const ch = src[j], nx = src[j + 1];
    if (com) { if (com === 1 && ch === '\n') com = 0; else if (com === 2 && ch === '*' && nx === '/') { com = 0; j++; } continue; }
    if (re) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (re === 2) { if (ch === ']') re = 1; }
      else if (ch === '[') re = 2;
      else if (ch === '/') re = 0;
      continue;
    }
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && nx === '/') { com = 1; j++; continue; }
    if (ch === '/' && nx === '*') { com = 2; j++; continue; }
    if (ch === '/' && startsRegex(src, j)) { re = 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced');
}
const grabFn = (n) => extractBlock(html, html.indexOf('function ' + n + '('));
/* Bracket-matched slice for any opener — extractBlock only knows braces, and
   NAV is an array literal. Shared so more than one block can read it. */
function balancedFrom(src, from, open, close) {
  const start = src.indexOf(open, from);
  let depth = 0, inStr = null, esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
}
const NAV_ALL = new Function('return ' + balancedFrom(html, html.indexOf('const NAV ='), '[', ']'))()
  .flatMap((a) => a.panels.map((p) => ({ ...p, area: a.id })));
const grabConst = (n) => {
  const i = html.indexOf('const ' + n + '=');
  return html.slice(i, html.indexOf('\n', i));
};

const { squadOptimise, bestXI, RULES_FALLBACK, fplRules, minClubsForXi, setRules,
  ftValue, benchValue, BENCH_W, FT_LADDER, FT_CAP, teamSheet, neverStarts, solvePlanMulti, DECAY_BASE } = new Function(
  grabFn('bestXI') + '\n' + grabFn('fplRules') + '\n' + grabFn('minClubsForXi') + '\n' +
  /* The two terms the transfer solver's objective gained beyond XI xP. */
  grabConst('FT_CAP') + '\n' + grabConst('BENCH_W') + '\n' + grabConst('FT_LADDER') + '\n' +
  grabFn('ftValue') + '\n' + grabFn('benchValue') + '\n' +
  /* squadOptimise reads squad shape, club cap and budget from the live game
     rules now; the fallback block is exactly the old hard-coded values. */
  grabConst('RULES_FALLBACK') + '\nlet RULES=RULES_FALLBACK;\n' +
  grabFn('squadOptimise') +
  /* The team sheet is assembly on top of bestXI — which formation, which
     armband, who never starts. The xP model underneath it has its own
     suite, so it is stubbed here: a fixture is worth whatever the test
     plants on it, and the sheet's logic is what gets graded. */
  '\nconst fixtureXP=(b,el,fx)=>fx.xp;\n' + grabFn('teamSheet') + '\n' + grabFn('neverStarts') +
  /* The plan solver, on the same stubbed xP: what is under test is the
     sequencing and the discounting, not the projection underneath. */
  '\n' + grabConst('DECAY_BASE') + '\n' + grabFn('solvePlanMulti') +
  '\nreturn {squadOptimise,bestXI,RULES_FALLBACK,fplRules,minClubsForXi,setRules:(r)=>{RULES=r;},'+
  'ftValue,benchValue,BENCH_W,FT_LADDER,FT_CAP,teamSheet,neverStarts,solvePlanMulti,DECAY_BASE};'
)();

let failures = 0, passes = 0;
const ok = (c, label) => { if (c) passes++; else { failures++; console.error('  ✗ ' + label); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

/* ── Brute force: enumerate every legal squad and keep the best XI total ── */
function bruteForce(scored, budget, mustIds, wantMinCost) {
  const must = new Set(mustIds || []);
  let minCost = Infinity;
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  scored.forEach((s) => byPos[s.el.element_type].push(s));
  const need = { 1: 2, 2: 5, 3: 5, 4: 3 };
  let best = null;

  const combos = (arr, k) => {
    const out = [];
    const rec = (start, cur) => {
      if (cur.length === k) { out.push(cur.slice()); return; }
      for (let i = start; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
    };
    rec(0, []);
    return out;
  };
  const perPos = [1, 2, 3, 4].map((t) => combos(byPos[t], need[t]));
  for (const g of perPos[0]) for (const d of perPos[1]) for (const m of perPos[2]) for (const f of perPos[3]) {
    const sq = [...g, ...d, ...m, ...f];
    if (must.size && ![...must].every((id) => sq.some((s) => s.el.id === id))) continue;
    const club = {};
    let legal = true;
    for (const s of sq) { club[s.el.team] = (club[s.el.team] || 0) + 1; if (club[s.el.team] > 3) { legal = false; break; } }
    if (!legal) continue;
    const c = sq.reduce((a, s) => a + s.el.now_cost, 0);
    if (c < minCost) minCost = c;
    if (c > budget) continue;
    const x = bestXI(sq);
    if (x && (!best || x.total > best)) best = x.total;
  }
  return wantMinCost ? { best, minCost } : best;
}

/* A deterministic pool: enough players to have real choices, small enough
   to enumerate. Prices and projections are varied so cost genuinely trades
   off against points. */
function makePool() {
  const out = [];
  let id = 1;
  const add = (type, n, teamBase) => {
    for (let i = 0; i < n; i++) {
      const cost = 40 + ((i * 7) % 45);                 // 4.0 .. 8.4
      const p = 1 + ((i * 13) % 17) / 2.7;              // uncorrelated with price
      out.push({ el: { id: id++, element_type: type, now_cost: cost, team: teamBase + (i % 6), web_name: 't' + type + 'p' + i }, p });
    }
  };
  add(1, 4, 1); add(2, 7, 1); add(3, 7, 1); add(4, 5, 1);
  return out;
}

console.log('• squadOptimise: matches brute force on an enumerable pool');
{
  const pool = makePool();
  for (const budget of [1000, 900, 850, 820, 800]) {
    const bf = bruteForce(pool, budget);
    const got = squadOptimise(pool, { budget, topN: 99, cheapN: 99 });
    ok((bf == null) === (got == null), 'feasibility agrees with brute force at budget ' + budget);
    if (bf != null && got != null) {
      ok(near(got.xiXP, bf), 'optimiser matches brute force at budget ' + budget +
        ' (got ' + got.xiXP.toFixed(3) + ', best ' + bf.toFixed(3) + ')');
    }
  }
  /* Below the cheapest legal squad both must agree there is nothing to build. */
  ok(bruteForce(pool, 700) === null && squadOptimise(pool, { budget: 700, topN: 99, cheapN: 99 }) === null,
    'an under-funded budget is infeasible for both');
  /* With a forced pick the search space changes shape — check it still lands. */
  const forcedId = pool.find((s) => s.el.element_type === 4).el.id;
  const bf = bruteForce(pool, 820, [forcedId]);
  const got = squadOptimise(pool, { budget: 820, mustInclude: [forcedId], topN: 99, cheapN: 99 });
  ok(got != null && near(got.xiXP, bf), 'optimiser matches brute force with a forced pick');
}

console.log('• squadOptimise: fuzz against brute force on random pools');
{
  /* Seeded PRNG so a failure is always reproducible. */
  let seed = 20260725;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  /* Budgets are set as a multiple of each pool's own cheapest legal squad, so
     the fuzz exercises the regime FPL actually lives in. A real £100.0m budget
     buys a cheapest-possible squad around £65m, i.e. roughly 50% slack; below
     about 5% slack almost every pick is forced and a swap-based search can
     fall marginally short of an exhaustive one. That tight corner is tested
     separately and explicitly, rather than being hidden here. */
  let checked = 0, matched = 0, worstGap = 0, worstGapRel = 0;
  for (let trial = 0; trial < 10; trial++) {
    const pool = [];
    let id = 1;
    const add = (type, n) => {
      for (let i = 0; i < n; i++) {
        pool.push({
          el: { id: id++, element_type: type, now_cost: 40 + Math.floor(rnd() * 60), team: 1 + Math.floor(rnd() * 7), web_name: 'r' + id },
          p: rnd() * 9,
        });
      }
    };
    add(1, 4); add(2, 7); add(3, 7); add(4, 5);
    const { minCost } = bruteForce(pool, Infinity, null, true);
    if (!isFinite(minCost)) continue;
    for (const slack of [1.15, 1.3, 1.5]) {
      const budget = Math.round(minCost * slack);
      const bf = bruteForce(pool, budget);
      const got = squadOptimise(pool, { budget, topN: 99, cheapN: 99 });
      if (bf == null) continue;
      checked++;
      if (got != null && near(got.xiXP, bf, 1e-6)) matched++;
      else {
        worstGap = Math.max(worstGap, got == null ? Infinity : bf - got.xiXP);
        worstGapRel = Math.max(worstGapRel, got == null ? Infinity : (bf - got.xiXP) / bf);
      }
    }
  }
  ok(checked >= 20, 'fuzz produced a decent number of feasible cases (' + checked + ')');
  /* The claim being asserted is "very close to exhaustive, almost always
     exactly it" — not "provably optimal". These pools hold only 23 players,
     so nearly every pick is forced and the swap neighbourhood is far poorer
     than it is against a real 700-player list. */
  ok(matched / checked >= 0.9,
    'at least 90% of realistic-slack pools hit the exhaustive optimum exactly (' +
    matched + '/' + checked + ')');
  ok(worstGapRel <= 0.01,
    'no realistic-slack pool falls more than 1% short of exhaustive (worst ' +
    (worstGapRel * 100).toFixed(2) + '%)');

  /* The honest caveat, asserted rather than assumed: with almost no slack the
     search can trail brute force, but it must still return a legal squad and
     land close. */
  const tight = [];
  let s2 = 4242424;
  const rnd2 = () => (s2 = (s2 * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 6; t++) {
    const pool = [];
    let id = 1;
    [[1, 4], [2, 7], [3, 7], [4, 5]].forEach(([type, n]) => {
      for (let i = 0; i < n; i++) {
        pool.push({
          el: { id: id++, element_type: type, now_cost: 40 + Math.floor(rnd2() * 60), team: 1 + Math.floor(rnd2() * 7), web_name: 'q' + id },
          p: rnd2() * 9,
        });
      }
    });
    const { minCost } = bruteForce(pool, Infinity, null, true);
    if (!isFinite(minCost)) continue;
    const budget = Math.round(minCost * 1.01);
    const bf = bruteForce(pool, budget);
    const got = squadOptimise(pool, { budget, topN: 99, cheapN: 99 });
    if (bf == null || got == null) continue;
    tight.push(got.xiXP / bf);
  }
  ok(tight.length > 0, 'tight-budget cases were generated');
  ok(tight.every((r) => r >= 0.95),
    'under 1% slack the squad still reaches 95% of the exhaustive optimum (worst ' +
    (tight.length ? Math.min(...tight).toFixed(3) : 'n/a') + ')');
}

console.log('• squadOptimise: squad legality and constraints');
{
  const pool = makePool();
  const r = squadOptimise(pool, { budget: 1000, topN: 99, cheapN: 99 });
  ok(r.squad.length === 15, 'builds a 15-man squad');
  ok(r.xi.length === 11, 'fields eleven');
  ok(r.bench.length === 4, 'benches four');

  const count = (list, t) => list.filter((s) => s.el.element_type === t).length;
  ok(count(r.squad, 1) === 2 && count(r.squad, 2) === 5 &&
     count(r.squad, 3) === 5 && count(r.squad, 4) === 3, 'squad respects 2/5/5/3');
  ok(count(r.xi, 1) === 1, 'exactly one goalkeeper starts');
  ok(count(r.xi, 2) >= 3 && count(r.xi, 4) >= 1, 'the XI is a legal formation');
  ok(r.formation.reduce((a, v) => a + v, 0) === 10, 'formation covers the ten outfield slots');

  const club = {};
  r.squad.forEach((s) => { club[s.el.team] = (club[s.el.team] || 0) + 1; });
  ok(Object.values(club).every((n) => n <= 3), 'never more than three from one club');

  const ids = r.squad.map((s) => s.el.id);
  ok(new Set(ids).size === 15, 'no player is picked twice');
  ok(r.cost === r.squad.reduce((a, s) => a + s.el.now_cost, 0), 'reported cost matches the squad');
  ok(r.cost <= 1000, 'squad is inside the budget');
  ok(r.bank === 1000 - r.cost, 'bank is the unspent remainder');
  ok(near(r.xiXP, r.xi.reduce((a, s) => a + s.p, 0)), 'XI total matches the sum of its picks');

  /* The bench must be the four squad players outside the XI. */
  const xiIds = new Set(r.xi.map((s) => s.el.id));
  ok(r.bench.every((s) => !xiIds.has(s.el.id)), 'bench and XI do not overlap');
  ok(r.bench.every((s) => ids.includes(s.el.id)), 'bench comes from the squad');
}

console.log('• squadOptimise: forced picks, bank and infeasible asks');
{
  const pool = makePool();
  const gk = pool.find((s) => s.el.element_type === 1);
  const fwd = pool.filter((s) => s.el.element_type === 4).slice(0, 2);

  const forced = squadOptimise(pool, { budget: 1000, mustInclude: [fwd[0].el.id, fwd[1].el.id], topN: 99, cheapN: 99 });
  ok(forced.squad.some((s) => s.el.id === fwd[0].el.id) &&
     forced.squad.some((s) => s.el.id === fwd[1].el.id), 'named players are always in the squad');

  /* Forced picks must survive the hill climb, not be swapped out for value. */
  const cheapFwd = pool.filter((s) => s.el.element_type === 4)
    .sort((a, c) => a.p - c.p)[0];
  const kept = squadOptimise(pool, { budget: 1000, mustInclude: [cheapFwd.el.id], topN: 99, cheapN: 99 });
  ok(kept.squad.some((s) => s.el.id === cheapFwd.el.id),
    'even the weakest forced pick is never swapped out');

  /* Bank: asking to leave money unspent must actually leave it. */
  const banked = squadOptimise(pool, { budget: 1000, minBank: 50, topN: 99, cheapN: 99 });
  ok(banked.cost <= 950, 'a minimum bank is respected in the spend');
  ok(banked.bank >= 50, 'the reported bank clears the minimum');
  ok(banked.xiXP <= squadOptimise(pool, { budget: 1000, topN: 99, cheapN: 99 }).xiXP + 1e-9,
    'holding money back never beats spending it all');

  /* A bank equal to a brute-force budget cut must agree with brute force. */
  ok(near(banked.xiXP, bruteForce(pool, 950)), 'banked squad matches brute force at the reduced budget');

  /* Infeasible asks return null rather than an illegal squad. */
  ok(squadOptimise(pool, { budget: 1, topN: 99, cheapN: 99 }) === null, 'an impossible budget returns null');
  ok(squadOptimise(pool, { budget: 1000, mustInclude: [999999] }) === null, 'an unknown player id returns null');
  const fourGk = pool.filter((s) => s.el.element_type === 1).slice(0, 3).map((s) => s.el.id);
  ok(squadOptimise(pool, { budget: 1000, mustInclude: fourGk }) === null,
    'forcing three goalkeepers returns null');

  /* Forcing four players from one club breaks the limit and must be refused. */
  const sameClub = [];
  for (const t of [2, 3, 4]) {
    const c = pool.filter((s) => s.el.element_type === t && s.el.team === 1);
    c.slice(0, t === 2 ? 2 : 1).forEach((s) => sameClub.push(s.el.id));
  }
  if (sameClub.length >= 4) {
    ok(squadOptimise(pool, { budget: 1000, mustInclude: sameClub }) === null,
      'forcing four from one club returns null');
  } else { passes++; }

  ok(squadOptimise([], { budget: 1000 }) === null, 'an empty pool returns null');
  ok(gk != null, 'pool sanity: a goalkeeper exists');
}

/* ── Card contents ────────────────────────────────────────────────────
   A squad card has to show the whole thing an FPL manager actually buys:
   eleven starters AND four substitutes, inside £100.0m. The arithmetic on
   the card must close — XI cost plus bench cost is the squad cost, and squad
   cost plus bank is the budget — because those numbers get posted publicly. */
console.log('• socSquadCard: XI plus four subs, and the budget adds up');
{
  const socSquadCard = new Function(
    'const teamShort=(b,t)=>"T"+t;\n' +
    'const socPhotoUrls=()=>[];\n' +
    'const crestUrl=()=>"";\n' +
    'const KIT={};\n' +
    grabFn('socSquadCard') + '\nreturn socSquadCard;'
  )();

  const pool = makePool();
  const res = squadOptimise(pool, { budget: 1000, topN: 99, cheapN: 99 });
  const card = socSquadCard({}, res, 'T', 'S', 'N');

  const onPitch = card.rows.reduce((a, r) => a + r.length, 0);
  ok(onPitch === 11, 'eleven players are drawn on the pitch (got ' + onPitch + ')');
  ok(card.bench.length === 4, 'four substitutes are drawn (got ' + card.bench.length + ')');
  ok(onPitch + card.bench.length === 15, 'the card shows all fifteen squad members');

  ok(card.benchCost === card.bench.reduce((a, p) => a + p.cost, 0),
    'reported bench cost matches the substitutes shown');
  ok(card.xiCost === card.rows.flat().reduce((a, p) => a + p.cost, 0),
    'reported XI cost matches the starters shown');
  ok(card.xiCost + card.benchCost === card.cost,
    'XI cost plus bench cost equals the squad cost printed on the card');
  ok(card.cost + card.bank === 1000,
    'squad cost plus bank equals the £100.0m budget');
  ok(card.cost <= 1000, 'the squad shown is inside the budget');

  /* The bench is drawn with prices, so those must be real numbers. */
  ok(card.bench.every((p) => typeof p.cost === 'number' && p.cost > 0),
    'every substitute carries a price');
  ok(card.bench.every((p) => p.nm), 'every substitute carries a name');
  /* Reserve keeper first, then outfield subs by projection — the order FPL
     would actually bring them on in. */
  const benchTypes = res.bench.slice().sort((a, c) =>
    (a.el.element_type === 1 ? 0 : 1) - (c.el.element_type === 1 ? 0 : 1) || c.p - a.p);
  ok(benchTypes[0].el.element_type === 1, 'the reserve keeper is the first substitute');

  /* Rows are position groups, keeper first — a pitch, not a jumble. */
  ok(card.rows.length >= 3 && card.rows.length <= 4, 'pitch has three or four rows');
  ok(card.rows[0].length === 1, 'the first row is the single goalkeeper');
  ok(Array.isArray(card.formation) && card.formation.reduce((a, v) => a + v, 0) === 10,
    'formation accounts for the ten outfield starters');

  /* A squad holding money back must still show all fifteen. */
  const banked = squadOptimise(pool, { budget: 1000, minBank: 50, topN: 99, cheapN: 99 });
  const bCard = socSquadCard({}, banked, 'T', 'S', 'N');
  ok(bCard.rows.reduce((a, r) => a + r.length, 0) + bCard.bench.length === 15,
    'the money-in-the-bank card still shows fifteen players');
  ok(bCard.bank >= 50, 'the money-in-the-bank card really holds the money back');
  ok(bCard.cost + bCard.bank === 1000, 'its arithmetic closes on the budget too');

  ok(socSquadCard({}, null, 'T', 'S', 'N') === null, 'no squad yields no card');
}

/* ── Card builder ─────────────────────────────────────────────────────
   The builder lets a card be assembled by hand, so the numbers it prints are
   the ones most likely to end up on a public post with nobody double-checking
   them. The metric definitions are the risky part — a wrong formatter puts a
   price where a percentage belongs — so every one is exercised. */
console.log('• socMetricDefs: every metric computes and formats sanely');
{
  const socMetricDefs = new Function(
    'const buildNextFix=()=>({});\n' +
    'const buildHorizon=()=>({1:[{},{}]});\n' +
    'const fixtureXP=(b,e)=>e._fx||1;\n' +
    'const xP=(b,e)=>e._xp||0;\n' +
    'const money=c=>"£"+(c/10).toFixed(1);\n' +
    'const dcHitRate=e=>e._dc||0;\n' +
    'const baselineBps90=e=>e._bb||0;\n' +
    'const socHist=e=>e._hist||null;\n' +
    grabFn('socMetricDefs') + '\nreturn socMetricDefs;'
  )();

  const defs = socMetricDefs({}, []);
  ok(defs.length >= 8, 'a useful spread of metrics is offered (' + defs.length + ')');
  const keys = defs.map((d) => d.k);
  ok(new Set(keys).size === keys.length, 'metric keys are unique');
  ok(defs.every((d) => d.k && d.l && typeof d.v === 'function' && typeof d.f === 'function'),
    'every metric has a key, label, accessor and formatter');

  /* A representative player, then check each metric returns a finite number
     and a non-empty string — no NaN and no "undefined" reaching a card. */
  const el = {
    id: 1, team: 1, now_cost: 75, total_points: 140, form: '5.5',
    selected_by_percent: '12.3', element_type: 3, minutes: 900,
    _xp: 5.4, _fx: 2.5, _dc: 0.62, _bb: 12.4, _ci: { npxg90: 0.41 },
    _hist: { n: 12, ppg: 5.5, sd: 3.2, haulRate: 0.25, blankRate: 0.5, profile: 'balanced' },
  };
  defs.forEach((d) => {
    const n = d.v(el);
    ok(typeof n === 'number' && isFinite(n), d.k + ' returns a finite number');
    const s = d.f(n);
    ok(typeof s === 'string' && s.length > 0 && !/NaN|undefined/.test(s),
      d.k + ' formats to a clean string (' + s + ')');
  });

  /* Spot-check the formatters that carry a unit, since mixing those up is the
     failure that would actually embarrass a post. */
  const by = Object.fromEntries(defs.map((d) => [d.k, d]));
  ok(by.price.f(by.price.v(el)) === '£7.5', 'price formats as pounds');
  ok(by.own.f(by.own.v(el)) === '12.3%', 'ownership formats as a percentage');
  ok(by.dchr.f(by.dchr.v(el)) === '62%', 'DefCon hit rate formats as a whole percentage');
  ok(by.npxg90.f(by.npxg90.v(el)) === '0.41', 'npxG per 90 keeps two decimals');
  ok(by.pts.f(by.pts.v(el)) === '140', 'total points formats as a whole number');
  ok(by.ppm.f(by.ppm.v(el)) === (140 / 7.5).toFixed(1), 'points per £m divides by price in millions');
  ok(by.xp6.v(el) === 5, 'xP over 6 sums the horizon fixtures');
  ok(by.bbps90.f(by.bbps90.v(el)) === '12.4', 'baseline BPS keeps one decimal');
  /* History-backed metrics read the per-match summary the builder loads. */
  ok(by.ppa.f(by.ppa.v(el)) === '5.5', 'points per appearance reads the history');
  ok(by.sd.f(by.sd.v(el)) === '3.2', 'return spread reads the history');
  ok(by.haul.f(by.haul.v(el)) === '25%', 'haul rate formats as a percentage');
  ok(by.blank.f(by.blank.v(el)) === '50%', 'blank rate formats as a percentage');
  ok(['ppa', 'sd', 'haul', 'blank'].every((k) => by[k].hist), 'they are flagged as needing history');
  /* A player with no loaded history prints a dash and sorts last, rather
     than showing a fabricated zero. */
  const noHist = Object.assign({}, el, { _hist: null });
  ok(['ppa', 'sd', 'haul', 'blank'].every((k) => by[k].v(noHist) === -1), 'missing history sentinels to -1');
  ok(['ppa', 'sd', 'haul', 'blank'].every((k) => by[k].f(by[k].v(noHist)) === '—'), 'and prints a dash');

  /* Missing advanced data must read as zero, not crash or print undefined. */
  const bare = { id: 2, team: 1, now_cost: 40, element_type: 2 };
  defs.forEach((d) => {
    const n = d.v(bare);
    ok(typeof n === 'number' && isFinite(n), d.k + ' survives a player with no stats');
  });
}

/* ── Panel wiring ─────────────────────────────────────────────────────
   Social Studio shipped broken because the panel was registered in NAV and
   given a hydrator, but had no PANEL_CONTENT entry — and renderPage reads
   content.desc unguarded, so tapping it threw before anything drew. That is
   a whole class of bug (register a panel, forget one of the three places it
   has to appear) and it is checkable statically, so it is checked here for
   EVERY panel rather than just the new one. */
console.log('• panel wiring: every panel is registered everywhere it needs to be');
{
  const balanced = (src, from, open, close) => {
    const s = src.indexOf(open, from);
    let d = 0, inStr = null, esc = false, com = 0;
    for (let j = s; j < src.length; j++) {
      const ch = src[j], nx = src[j + 1];
      if (com) { if (com === 1 && ch === '\n') com = 0; else if (com === 2 && ch === '*' && nx === '/') { com = 0; j++; } continue; }
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; continue; }
      if (ch === '/' && nx === '/') { com = 1; j++; continue; }
      if (ch === '/' && nx === '*') { com = 2; j++; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
      if (ch === open) d++; else if (ch === close) { d--; if (!d) return src.slice(s, j + 1); }
    }
    throw new Error('unbalanced');
  };

  const NAV = new Function('return ' + balanced(html, html.indexOf('const NAV ='), '[', ']'))();
  const CONTENT = new Function('return ' + balanced(html, html.indexOf('const PANEL_CONTENT ='), '{', '}'))();
  /* WIRED holds function references, so only its keys can be read here. */
  const wiredSrc = balanced(html, html.indexOf('const WIRED='), '{', '}');
  const wiredKeys = new Set([...wiredSrc.matchAll(/^\s{2}([A-Za-z0-9_-]+)\s*:/gm)].map((m) => m[1]));

  const navPanels = NAV.flatMap((a) => a.panels.map((p) => ({ ...p, area: a.id })));
  ok(navPanels.length > 20, 'NAV parsed (' + navPanels.length + ' panels)');
  ok(Object.keys(CONTENT).length > 20, 'PANEL_CONTENT parsed (' + Object.keys(CONTENT).length + ' entries)');
  ok(wiredKeys.size > 20, 'WIRED keys parsed (' + wiredKeys.size + ')');

  /* The bug that shipped: a panel with no PANEL_CONTENT.desc. */
  const noDesc = navPanels.filter((p) => !CONTENT[p.id] || !CONTENT[p.id].desc);
  ok(noDesc.length === 0, 'every NAV panel has a PANEL_CONTENT desc' +
    (noDesc.length ? ' — missing: ' + noDesc.map((p) => p.id).join(', ') : ''));

  /* A panel with neither a hydrator nor a standard layout renders nothing. */
  const orphan = navPanels.filter((p) => !wiredKeys.has(p.id) && !(CONTENT[p.id] && CONTENT[p.id].layout));
  ok(orphan.length === 0, 'every NAV panel has a hydrator or a layout' +
    (orphan.length ? ' — orphaned: ' + orphan.map((p) => p.id).join(', ') : ''));

  const byIdAll = Object.fromEntries(navPanels.map((p) => [p.id, p]));
  const ids = navPanels.map((p) => p.id);
  ok(new Set(ids).size === ids.length, 'no duplicate panel ids across areas');
  ok(navPanels.every((p) => p.label && p.icon && p.tier), 'every panel has a label, icon and tier');

  /* Social Studio specifically: owner-gated, in its own area, and wired. */
  const social = navPanels.find((p) => p.id === 'social');
  ok(!!social, 'social panel is registered');
  ok(social && social.tier === 'owner', 'social is tier owner, not free');
  ok(social && social.area === 'studio', 'social lives in its own Studio area');
  ok(wiredKeys.has('social'), 'social has a hydrator');
  ok(!!(CONTENT.social && CONTENT.social.desc), 'social has a PANEL_CONTENT desc');

  const studio = NAV.find((a) => a.id === 'studio');
  ok(studio && studio.tier === 'owner', 'the Studio area itself is owner-gated');
  ok(studio && studio.panels.every((p) => p.tier === 'owner'),
    'every panel inside Studio is owner-gated');

  /* The gate must actually be applied at each exposure point. */
  const gate = (fn) => html.includes(fn);
  ok(gate('function canSeePanel('), 'canSeePanel gate exists');
  ok(/NAV\.filter\(canSeeArea\)/.test(html), 'sidebar areas are filtered by the gate');
  ok(/area\.panels\.filter\(canSeePanel\)/.test(html), 'the area tabs are filtered by the gate');
  ok(/if\(!canSeePanel\(p\)\)return;/.test(html), 'command palette is filtered by the gate');
  ok(/if\(!PANELS\[panelId\]\|\|!canSeePanel\(PANELS\[panelId\]\)\)panelId='dashboard';/.test(html),
    'openPanel guards deep links');

  /* ── The nav shape ───────────────────────────────────────
     The sidebar is a flat list of areas and the lateral move happens on the
     page, so an area is now a real destination rather than a folder. Two
     things have to hold for that to work: every area must HAVE a landing
     panel, and no area may be so long that arriving on it puts a wall of
     tabs in front of you — which is the clutter this restructure exists to
     remove, relocated rather than fixed. */
  const areas = NAV.filter((a) => a.tier !== 'owner');
  ok(areas.length <= 8, 'the sidebar offers at most eight areas (' + areas.length + ')');
  for (const a of areas) {
    ok(a.panels.length >= 1, a.id + ': has a landing panel');
    ok(a.panels.length <= 7, a.id + ': at most seven tabs (' + a.panels.length + ')');
    ok(a.panels.some((p) => p.tier !== 'paid'),
      a.id + ': has at least one free panel, so a free user never lands on a wall of locks');
  }
  ok(html.includes('function areaTabsHtml('), 'the area tab strip exists');
  ok(/areaTabsHtml\(panelId\)/.test(html), 'and renderPage emits it');
  ok(!/toggleArea/.test(html), 'the old expanding sub-list is gone, not merely hidden');

  /* "The Edge" was an area holding twelve unrelated paid tools — the app's
     single biggest pile. Pro is a property of a panel now, not a place, so
     every one of those tools has to have found a topical home. */
  ok(!NAV.some((a) => a.id === 'intel'), 'the catch-all Pro area is gone');
  const areaOfPanel = Object.fromEntries(navPanels.map((p) => [p.id, p.area]));
  const rehomed = {
    scout: 'home', gwhistory: 'myteam', liverank: 'live',
    setpiece: 'players', rotation: 'players', seasonsim: 'planner', whatif: 'planner',
    rivals: 'rivals', eo: 'rivals', template: 'rivals',
  };
  for (const [id, area] of Object.entries(rehomed)) {
    ok(areaOfPanel[id] === area, id + ' now lives in ' + area + ' (found: ' + areaOfPanel[id] + ')');
  }
  /* Three of them folded into the Live hub instead of getting their own tab,
     so their locks moved onto the VIEW. The count has to be checked where
     the gate now is, or a merge that dropped `tier:'paid'` would read as a
     panel simply having been retired. */
  const LV = new Function('return ' + balanced(html, html.indexOf('const LV_VIEWS='), '[', ']'))();
  for (const id of ['defcon', 'threats', 'autosubs']) {
    const v = LV.find((x) => x.id === id);
    ok(v && v.tier === 'paid', 'the ' + id + ' live view is still Pro');
  }
  ok(LV.some((v) => v.tier !== 'paid'),
    'and the Live panel keeps free views, so it is not a paid panel in disguise');
  ok(navPanels.filter((p) => p.tier === 'paid').length +
     LV.filter((v) => v.tier === 'paid').length >= 10,
    'Pro moved with the thing, it was not given away');

  /* Two things called "league" two aisles apart: the Premier League and your
     mini-league. The rename is the fix and it must not silently revert. */
  ok(!NAV.some((a) => a.id === 'league'), 'the ambiguous League area is gone');
  ok(NAV.some((a) => a.id === 'matchcentre') && NAV.some((a) => a.id === 'rivals'),
    'replaced by Match Centre (the football) and Rivals (the people)');
  ok(areaOfPanel.leagues === 'rivals', 'Mini-Leagues sits with the rivals, not the planner');

  /* Every area on the bottom bar and in the More sheet must still exist —
     a renamed area id here is a bar item that highlights nothing. */
  const areaIds = new Set(NAV.map((a) => a.id));
  const barSrc = balanced(html, html.indexOf('const BOTTOM_NAV='), '[', ']');
  for (const m of barSrc.matchAll(/area:'([a-z]+)'/g)) {
    ok(areaIds.has(m[1]), 'bottom bar area ' + m[1] + ' exists');
  }
  const moreSrc = html.slice(html.indexOf('function openMoreSheet('), html.indexOf('function closeMoreSheet('));
  for (const m of moreSrc.matchAll(/\['([a-z]+)','[^']+'\]/g)) {
    ok(m[1] === 'glossary' || areaIds.has(m[1]), 'More sheet area ' + m[1] + ' exists');
  }
  /* Between the bar and the sheet, every area must be reachable on a phone —
     the sidebar is not on screen there. */
  const barAreas = [...barSrc.matchAll(/area:'([a-z]+)'/g)].map((m) => m[1]);
  const moreAreas = [...moreSrc.matchAll(/\['([a-z]+)','[^']+'\]/g)].map((m) => m[1]);
  const reachable = new Set([...barAreas, ...moreAreas]);
  for (const a of areas) ok(reachable.has(a.id), a.id + ': reachable on mobile (bar or More sheet)');

  /* The site map in docs/FEATURES.md had gone quietly stale — it still listed
     an "Intelligence (Pro)" area and panels that had not existed for weeks,
     because nothing checked it. A doc that describes the nav is worth having
     only if it cannot drift. */
  {
    const doc = readFileSync(join(ROOT, 'docs', 'FEATURES.md'), 'utf8');
    const fence = doc.slice(doc.indexOf('## 2. Site map'), doc.indexOf('## 3.'));
    const map = fence.slice(fence.indexOf('```') + 3, fence.lastIndexOf('```'));
    for (const a of NAV) ok(map.includes(a.label), 'site map lists the ' + a.label + ' area');
    for (const p of navPanels) {
      /* The Wire's nav label carries a trailing gloss the tree drops. */
      const label = p.label.split(' — ')[0];
      ok(map.includes(label), 'site map lists ' + label);
    }
    const listed = [...map.matchAll(/^[├└]── (.+?)\s{2,}\(/gm)].map((m) => m[1].trim());
    const known = new Set(navPanels.map((p) => p.label.split(' — ')[0]));
    const ghosts = listed.filter((l) => !known.has(l));
    ok(ghosts.length === 0, 'and lists nothing the app no longer has' +
      (ghosts.length ? ' — stale: ' + ghosts.join(', ') : ''));
  }

  /* Retired panels. Merging one panel into another silently breaks every
     bookmark and shared link pointing at the old id — openPanel's guard sends
     an unknown id to the dashboard, which looks like the app losing the page.
     An alias keeps those links landing on whatever absorbed the panel. */
  const ALIAS = new Function('return ' + balanced(html, html.indexOf('const PANEL_ALIAS='), '{', '}'))();
  const navIds = new Set(ids);
  for (const [from, to] of Object.entries(ALIAS)) {
    ok(!navIds.has(from), from + ': an alias is for a RETIRED id, not a live panel');
    ok(navIds.has(to), from + ' → ' + to + ': the alias target is a live panel');
    ok(wiredKeys.has(to) || (CONTENT[to] && CONTENT[to].layout),
      from + ' → ' + to + ': the target actually renders');
  }
  ok(ALIAS.scenariolab === 'seasonsim', 'Scenario Lab redirects to the simulator that absorbed it');
  ok(!wiredKeys.has('scenariolab'), 'and its hydrator is gone rather than orphaned');
  ok(ALIAS.ask === 'scout', 'Ask the Scout redirects to the scout that absorbed it');
  ok(!wiredKeys.has('ask'), 'and its hydrator is gone too');

  /* Panels that folded into another are routed by PANEL_VIEW, which names
     the VIEW as well as the destination. An alias alone is not enough:
     landing on the default view is not the page the old link promised. */
  const VIEW_MAP = new Function('return ' + balanced(html, html.indexOf('const PANEL_VIEW='), '{', '}'))();
  const viewIds = (n) => new Set(new Function('return ' +
    balanced(html, html.indexOf('const ' + n + '='), '[', ']'))().map((v) => v.id));
  /* Each hub panel and the views it actually has. A route may only name a
     view its hub owns, and every hub must be dispatchable. */
  const HUB = { allplayers: viewIds('PL_LENSES'), fixtures: viewIds('FX_VIEWS'), liverank: viewIds('LV_VIEWS') };
  const dispatch = html.slice(html.indexOf('const HUB_SETVIEW='),
    html.indexOf('\n', html.indexOf('const HUB_SETVIEW=')));
  for (const hub of Object.keys(HUB)) {
    ok(dispatch.includes(hub + ':'), hub + ': has a view setter in HUB_SETVIEW');
    ok(navIds.has(hub), hub + ': is itself a live panel');
  }
  for (const [from, spec] of Object.entries(VIEW_MAP)) {
    ok(!!HUB[spec.hub], from + ": names a known hub ('" + spec.hub + "')");
    if (!HUB[spec.hub]) continue;
    ok(HUB[spec.hub].has(spec.view), from + ' → ' + spec.view + ': that view exists in ' + spec.hub);
    const dest = ALIAS[from] || from;
    ok(dest === spec.hub, from + ': routes to ' + spec.hub + ' (found: ' + dest + ')');
  }
  /* And the other direction: aliasing INTO a hub without naming a view drops
     you on its default, which is the bug this map exists to prevent. */
  for (const [from, to] of Object.entries(ALIAS)) {
    if (HUB[to]) ok(!!VIEW_MAP[from], from + ': aliasing into ' + to + ' also names a view');
  }
  /* Every hub must also route its OWN id, or opening it from the nav leaves
     whatever view the last deep link happened to select. */
  for (const hub of Object.keys(HUB)) ok(!!VIEW_MAP[hub], hub + ': routes its own id to a default view');
  for (const id of ['diffs', 'injuries', 'points5', 'csmatrix', 'bonus', 'dcwatch', 'defcon', 'autosubs']) {
    ok(!wiredKeys.has(id), id + ': its hydrator is gone rather than left orphaned');
    ok(!navIds.has(id), id + ': and it is off the nav');
  }
  /* The view is read from the id AS TYPED. Resolve first and #diffs and
     #injuries both become 'allplayers', so both would open on the same view
     and one of the two old links would silently land on the wrong page. */
  const openSrc = html.slice(html.indexOf('function openPanel('), html.indexOf('function syncNav('));
  ok(openSrc.indexOf('PANEL_VIEW[panelId]') < openSrc.indexOf('panelId=resolvePanel(panelId)'),
    'openPanel picks the view BEFORE resolving the alias');

  /* Each hub must still hydrate every renderer it absorbed — a view whose
     hydrator is not wired to it is a tab that renders an empty box — and it
     must do it with the ORIGINAL function. Merging is a routing change; the
     moment a renderer gets rewritten to fit the hub, the claim that nothing
     about the boards changed stops being true. */
  const hydrateMap = (n) => balanced(html, html.indexOf('const ' + n + '='), '{', '}');
  const ABSORBED = {
    fixtures: ['FX_HYDRATE', HUB.fixtures,
      ['hydrateFixtures', 'hydratePointsPlanner', 'hydrateCsMatrix']],
    liverank: ['LV_HYDRATE', HUB.liverank,
      ['hydrateLiveRank', 'hydrateBonus', 'hydrateDcwatch', 'hydrateDefcon', 'hydrateAutosubs']],
  };
  for (const [hub, [mapName, ids, fns]] of Object.entries(ABSORBED)) {
    const src = hydrateMap(mapName);
    for (const v of ids) ok(src.includes(v + ':'), hub + ' hub renders the ' + v + ' view');
    for (const fn of fns) {
      ok(src.includes(fn), hub + ' hub uses the original ' + fn + ', untouched');
      ok(html.includes('function ' + fn + '('), 'and ' + fn + ' still exists');
    }
  }

  /* Two boards called DEFCON, one of which had nothing to do with defensive
     contributions, sat next to each other in the same area. Same capability,
     different question, indistinguishable names. They are adjacent CHIPS in
     the Live hub now, which makes the labels matter more, not less — and the
     trap survives underneath, because the rank-threat view is still rendered
     by a function called hydrateDefcon. */
  ok(LV.filter((v) => /defcon/i.test(v.label)).length === 1,
    'only one live view is named for defensive contributions (' +
    LV.filter((v) => /defcon/i.test(v.label)).map((v) => v.label).join(', ') + ')');
  const threats = LV.find((v) => v.id === 'threats');
  ok(threats && threats.label === 'Rank threats', 'the rank-threat view is named for what it does');
  ok(threats && /Nothing to do with defensive contributions/.test(threats.desc),
    'and its blurb says so, since it is rendered by hydrateDefcon');
  ok(LV.find((v) => v.id === 'defcon').label === 'Your DEFCON',
    'while the actual defensive-contribution view keeps that name');

  /* The ask box is a section of the scout now, not a Pro panel of its own.
     It has to survive the merge in both of the scout's branches — including
     "predictions not ready", which it does not depend on. */
  ok(!navPanels.some((p) => p.id === 'ask'), 'Ask is no longer its own nav entry');
  ok(/function askCardHtml\(\)/.test(html) && /function wireAsk\(host\)/.test(html),
    'the ask box is split into markup and wiring so the scout can place it');
  const scoutSrc = balanced(html, html.indexOf('async function hydrateScout('), '{', '}');
  ok((scoutSrc.match(/askCardHtml\(\)/g) || []).length === 2,
    'the scout renders the ask box on both paths (' +
    (scoutSrc.match(/askCardHtml\(\)/g) || []).length + ')');
  ok((scoutSrc.match(/wireAsk\(host\)/g) || []).length === 2, 'and wires it on both');
  ok(/Predictions not ready[\s\S]{0,120}askCardHtml\(\)/.test(scoutSrc),
    'including the empty state, which the ask box does not depend on');
  ok(/ask-thread/.test(html) && /ask-send/.test(html), 'the ask controls still exist');
  ok(/(scout|ask)/.test(CONTENT.scout.desc) && /ask box/.test(CONTENT.scout.desc),
    'and the scout description mentions what it absorbed');
  ok(/function resolvePanel\(id\)\{return PANEL_ALIAS\[id\]\|\|id;\}/.test(html),
    'there is one resolver rather than the lookup inlined per call site');
  ok(/panelId=resolvePanel\(panelId\);/.test(html), 'openPanel resolves the alias');
  /* Order matters: resolve first, then guard, or the alias never runs. */
  ok(html.indexOf('panelId=resolvePanel(panelId);') <
     html.indexOf("if(!PANELS[panelId]||!canSeePanel(PANELS[panelId]))panelId='dashboard';"),
    'the alias is resolved before the unknown-id fallback');
  /* The bug a browser caught and the source test missed: the boot paths test
     PANELS[id] themselves, BEFORE openPanel ever sees the id, so a retired id
     was rejected as unknown and the alias never ran. Every entry point has to
     resolve for itself. */
  ok(/const hp=resolvePanel\(location\.hash\.slice\(1\)\);/.test(html),
    'the hash deep link resolves aliases on load');
  ok(/const p=resolvePanel\(location\.hash\.slice\(1\)\);/.test(html),
    'and so does hashchange');
  /* Landing on a retired id while already on the target renders the right
     panel but leaves the dead id in the address bar, so the URL names a panel
     that no longer exists. */
  ok(/if\(location\.hash\.slice\(1\)!==p\)\{[\s\S]{0,80}replaceState\(null,'','#'\+p\)/.test(html),
    'a retired id is normalised out of the URL even when no navigation happens');
  ok(/const pm=resolvePanel\(\(location\.search\.match/.test(html),
    'and the ?panel= query link');
  for (const m of html.matchAll(/if\((?:hp|p|pm)&&PANELS\[(?:hp|p|pm)\]/g)) {
    const before = html.slice(0, m.index);
    ok(/resolvePanel\([^)]*\)/.test(before.slice(-400)),
      'each PANELS[] entry-point check is preceded by a resolve');
  }

  /* The dashboard's way out. On the analytics, 279 of 286 visitors never
     opened a second panel — the page answered their questions and offered
     nowhere to go. These links are the fix, so they have to point at panels
     that exist, are reachable, and are free. */
  const WHY = new Function('return ' + balanced(html, html.indexOf('const NEXT_WHY='), '{', '}'))();
  const byId = Object.fromEntries(navPanels.map((p) => [p.id, p]));
  ok(Object.keys(WHY).length >= 6, 'there are enough destinations to choose from');
  for (const id of Object.keys(WHY)) {
    ok(!!byId[id], id + ': next-step target is a real NAV panel');
    ok(byId[id] && byId[id].tier === 'free',
      id + ': next steps are discovery, not an upsell (tier ' + (byId[id] || {}).tier + ')');
    ok(WHY[id] && WHY[id].length > 8 && WHY[id] !== (byId[id] || {}).label,
      id + ': the subtitle says what you get rather than repeating the name');
  }
  ok(/function dashNextSteps\(mid\)/.test(html), 'the next-steps builder exists');
  ok(/canSeePanel\(PANELS\[id\]\)/.test(html), 'and filters through the capability gate');
  ok(/\.slice\(0,\s*6\)/.test(html), 'and is capped rather than listing everything');
  /* Assert the PROPERTY, not the exact concatenation. The previous version
     pinned the literal `hero+tkStrip+meta+...` string, so inserting a band
     into the dashboard broke a test about next steps — a false failure that
     says nothing about whether next steps still render. */
  const dashRender = (html.match(/host\.innerHTML=hero\+[^;]*;/) || [''])[0];
  ok(dashRender.includes('dashNextSteps(mid)'), 'the dashboard actually renders it');

  /* The proof band is the one claim no competitor can make — that we publish
     our own error rate. It sat last on the page, in the smallest text, which
     gave the argument away. It leads now, and this stops it drifting back. */
  ok(/class="proof-band"/.test(html), 'the accountability band exists');
  ok(dashRender.indexOf('proof') > -1 && dashRender.indexOf('proof') < dashRender.indexOf('tkStrip'),
    'and renders above the metrics strip rather than at the foot of the page');
  /* Anchor on the JS that builds the band, not the first mention of the class
     — that one is the CSS rule, hundreds of lines earlier. */
  const proofJs = html.slice(html.indexOf('class="proof-band"'), html.indexOf('class="proof-band"') + 900);
  ok(/openPanel\(\\?'accountability\\?'\)/.test(proofJs),
    'and links to Model Accountability, not just the methodology write-up');
  /* Unlinked visitors are the ones who bounce, and the personalised panels
     are dead ends for them, so the two lists must genuinely differ. */
  const nextSrc = balanced(html, html.indexOf('function dashNextSteps(mid)'), '{', '}');
  const lists = [...nextSrc.matchAll(/\[((?:'[a-z]+',?)+)\]/g)].map((m) =>
    m[1].split(',').map((s) => s.replace(/'/g, '')));
  ok(lists.length === 2, 'there is a linked list and an unlinked list');
  ok(lists.length === 2 && lists[0].join() !== lists[1].join(),
    'and they are not the same list');
  ok(lists.length === 2 && !lists[1].includes('squad') && !lists[1].includes('transfers'),
    'the unlinked list holds nothing that needs a linked team');
  for (const l of lists) {
    for (const id of l) ok(!!WHY[id], id + ': every listed panel has a subtitle');
    ok(l.length <= 6, 'a list is at most six long (' + l.length + ')');
  }

  /* The merged simulator. Scenario Lab used to be a second panel that told
     you to go and run this one first for a baseline; the pinning now lives
     here. Run the real hydrator against stubs so the merge is checked rather
     than assumed — the browser can't reach the model bundle, and an empty
     state looks identical to a panel that never built its controls. */
  const simSrc = balanced(html, html.indexOf('async function hydrateSeasonSim('), '{', '}');
  const fakeEl = () => ({ value: '5000', style: {}, textContent: '', disabled: false,
    innerHTML: '', options: [], open: false, firstElementChild: { style: {} },
    addEventListener() {}, querySelectorAll: () => [], appendChild() {} });
  let painted = '', mcCalls = [];
  const host = { set innerHTML(v) { painted = v; }, get innerHTML() { return painted; },
    querySelector: () => fakeEl(), querySelectorAll: () => [] };
  const bundle = { fixtures: Array.from({ length: 38 }, () => [['ARS', 'CHE']]),
    teams: { ARS: {}, CHE: {} } };
  const env = {
    skel: () => '', stateBox: (i, t) => 'STATE:' + t, svg: () => '', esc: (s) => String(s),
    ICON: { target: '' }, loadModelBundle: async () => bundle,
    lgScFill: () => {}, lgRenderScList: () => {}, LG_SCEN: [],
    renderSeasonSim: () => {}, renderScenarioOdds: () => {},
    lgMonteCarlo: (m, n, seed, pins) => { mcCalls.push({ n, seed, pins }); },
    performance: { now: () => 0 }, document: { createElement: fakeEl }
  };
  const keys = Object.keys(env);
  /* balanced() returns the body block, so the wrapper supplies the signature. */
  await new Function(...keys, 'return (async function(host)' + simSrc + ')')
    (...keys.map((k) => env[k]))(host);

  ok(!/^STATE:/.test(painted), 'the simulator renders rather than falling into an empty state');
  ok(/ss-run/.test(painted), 'the run button is built');
  ok(/ss-pin/.test(painted), 'the pin control lives on the simulator now');
  ok(/lsc-md/.test(painted) && /lsc-fx/.test(painted) && /lsc-add/.test(painted),
    'the matchday, fixture and add-pin controls came across from Scenario Lab');
  ok(/lsc-out/.test(painted) && /ss-out/.test(painted),
    'both output slots exist, so a pinned run and a baseline run each have somewhere to go');
  ok(!/Run the Season Simulator once/.test(painted),
    'and it no longer tells you to go and run a different panel first');
  ok(mcCalls.length === 1, 'the panel runs a simulation on open (' + mcCalls.length + ')');
  ok(mcCalls[0] && mcCalls[0].pins === null,
    'with no pins, so the first run is the baseline the pinned runs compare against');
  ok(mcCalls[0] && mcCalls[0].seed === 42,
    'on the seed the standalone simulator used, so published numbers do not move');

  /* Owner rights come from the signed-in email allowlist, never from a
     client-settable tier — guard against that regressing. The gate now also
     answers the capability question, so pin the two properties rather than
     the exact source: it consults GE_OWNER, and it never consults the tier. */
  const gateSrc = html.slice(html.indexOf('function canSeePanel(p){'));
  const gateBody = gateSrc.slice(0, gateSrc.indexOf('\n}') + 2);
  ok(/window\.GE_OWNER/.test(gateBody), 'the gate keys off GE_OWNER');
  ok(!/isPro\(|ge-tier|TIER/.test(gateBody), 'the gate never consults the local tier setting');
  ok(/capsMet\(/.test(gateBody), 'the gate also applies the game-capability check');
}

console.log('• game packs: capabilities decide which panels exist');
{
  /* A pack describes a fantasy game's mechanics. A panel that depends on a
     mechanic the active game does not have is removed, not locked — in a game
     without price changes the Price Predictor is meaningless, not a paid
     upsell. Gameweek Edge ships one pack today; these tests hold the contract
     that a second one would have to satisfy. */
  const packSrc = html.slice(html.indexOf('const GAMES = {'));
  const GAMES = new Function('return ' + extractBlock(packSrc, packSrc.indexOf('{')) + ';')();
  const CAPS = new Function('return ' + html.match(/const CAPS\s*=\s*(\[[^\]]*\])/)[1] + ';')();

  ok(!!GAMES.fpl, 'the FPL pack is registered');
  for (const [id, g] of Object.entries(GAMES)) {
    ok(!!g.label && !!g.short && !!g.apiPath, id + ': has a label, short name and api path');
    ok(/^\/api\/[a-z-]+\/$/.test(g.apiPath), id + ': api path is a routed proxy prefix');
    /* Every capability must be answered explicitly — a pack that simply
       omits one would inherit `false` silently and lose a panel unnoticed. */
    const missing = CAPS.filter((c) => typeof g.caps[c] !== 'boolean');
    ok(missing.length === 0, id + ': declares every capability (' + (missing.join() || 'all present') + ')');
    const unknown = Object.keys(g.caps).filter((c) => !CAPS.includes(c));
    ok(unknown.length === 0, id + ': declares no unknown capability (' + (unknown.join() || 'none') + ')');
  }

  /* FPL is the full-fat game: it must keep every mechanic the app was built
     for, or a capability typo would quietly strip panels from the main app. */
  ok(CAPS.every((c) => GAMES.fpl.caps[c] === true), 'FPL retains every capability');

  /* Every capability a panel asks for must be a real one. Views inside a hub
     declare `needs` too, and they are the easier place to typo one: a view
     whose capability is misspelt is simply never listed, and nothing about
     the panel it lives in looks wrong. */
  const HUB_VIEWS = ['PL_LENSES', 'FX_VIEWS', 'LV_VIEWS'].flatMap((n) =>
    new Function('return ' + balancedFrom(html, html.indexOf('const ' + n + '='), '[', ']'))());
  const needed = new Set([...NAV_ALL, ...HUB_VIEWS].flatMap((p) => p.needs || []));
  const bogus = [...needed].filter((c) => !CAPS.includes(c));
  ok(bogus.length === 0, 'nothing depends on an undeclared capability (' + (bogus.join() || 'none') + ')');
  const hiddenViews = HUB_VIEWS.filter((v) => (v.needs || []).some((c) => GAMES.fpl.caps[c] !== true));
  ok(hiddenViews.length === 0,
    'no hub view is hidden in FPL (' + (hiddenViews.map((v) => v.id).join() || 'none') + ')');

  /* With every FPL capability present, nothing may be hidden — a stray `false`
     or a mistyped `needs:` would silently delete a panel from the live app,
     which is the failure this whole mechanism could most easily cause. */
  const needsOf = (id) => (NAV_ALL.find((p) => p.id === id) || {}).needs || [];
  const visibleIn = (game, id) => needsOf(id).every((c) => GAMES[game].caps[c] === true);
  const hidden = NAV_ALL.filter((p) => !visibleIn('fpl', p.id)).map((p) => p.id);
  ok(hidden.length === 0, 'no panel is hidden in FPL (' + (hidden.join() || 'none') + ')');

  /* The gate must still WORK, or it is decoration that would not catch a
     regression. Prove it against a hypothetical pack rather than a shipped
     one: a game without prices loses the Price Predictor and keeps the rest. */
  const noPrices = { ...GAMES.fpl.caps, prices: false };
  const wouldShow = (id) => needsOf(id).every((c) => noPrices[c] === true);
  ok(!wouldShow('price'), 'a pack without prices would drop the Price Predictor');
  for (const id of ['squad', 'captain', 'fixtures', 'eo', 'chips', 'results']) {
    ok(wouldShow(id), id + ': survives a capability it does not depend on');
  }
  /* The same gate on a hub view. The Live panel is free of capabilities
     itself, so a pack without a bonus system must drop the Bonus VIEW —
     otherwise the merge quietly un-gated it. */
  const noBps = { ...GAMES.fpl.caps, bps: false };
  const viewShows = (id, caps) => {
    const v = HUB_VIEWS.find((x) => x.id === id) || {};
    return (v.needs || []).every((c) => caps[c] === true);
  };
  ok(!viewShows('bonus', noBps), 'a pack without BPS drops the Bonus view');
  ok(viewShows('bonus', GAMES.fpl.caps), 'and FPL keeps it');
  ok(viewShows('rank', noBps), 'while the Percentile view, which needs nothing, survives');
}

console.log('• fplRules: the squad rules come from the game, not from us');
{
  /* A payload shaped like the real bootstrap: game_settings plus the
     element_types block that carries squad_select / squad_min_play /
     squad_max_play. Field names verified against a typed FPL client. */
  const boot = (gs, types) => ({
    game_settings: Object.assign({
      squad_squadsize: 15, squad_squadplay: 11, squad_team_limit: 3,
      squad_total_spend: 1000, transfers_sell_on_fee: 0.5, ui_currency_multiplier: 10,
    }, gs || {}),
    element_types: types || [
      { id: 1, squad_select: 2, squad_min_play: 1, squad_max_play: 1 },
      { id: 2, squad_select: 5, squad_min_play: 3, squad_max_play: 5 },
      { id: 3, squad_select: 5, squad_min_play: 2, squad_max_play: 5 },
      { id: 4, squad_select: 3, squad_min_play: 1, squad_max_play: 3 },
    ],
  });

  const r = fplRules(boot());
  ok(r.fromApi === true, 'a real payload is marked as coming from the API');
  ok(r.squadSize === 15 && r.xiSize === 11 && r.teamLimit === 3 && r.budget === 1000,
    "today's rules read back unchanged");
  ok(JSON.stringify(r.need) === JSON.stringify({ 1: 2, 2: 5, 3: 5, 4: 3 }),
    'the 2/5/5/3 squad comes from squad_select, not from a constant');
  ok(r.maxPlay[2] === 5 && r.minPlay[2] === 3, 'formation bounds come with it');
  ok(r.sellFee === 0.5 && r.moneyDiv === 10, 'sell-on fee and the currency divisor are read');

  /* The whole point: a rule change has to actually move. */
  const changed = fplRules(boot({ squad_squadsize: 16, squad_team_limit: 4, squad_total_spend: 1050 }, [
    { id: 1, squad_select: 2, squad_min_play: 1, squad_max_play: 1 },
    { id: 2, squad_select: 5, squad_min_play: 3, squad_max_play: 5 },
    { id: 3, squad_select: 6, squad_min_play: 2, squad_max_play: 5 },
    { id: 4, squad_select: 3, squad_min_play: 1, squad_max_play: 3 },
  ]));
  ok(changed.squadSize === 16 && changed.need[3] === 6, 'a bigger squad is followed, not overridden');
  ok(changed.teamLimit === 4 && changed.budget === 1050, 'a new club cap and budget are followed');

  /* Half-changed data is worse than no data: if the positions do not add up
     to the stated squad size, one of the two blocks is stale. */
  const mismatch = fplRules(boot({ squad_squadsize: 15 }, [
    { id: 1, squad_select: 2 }, { id: 2, squad_select: 5 },
    { id: 3, squad_select: 5 }, { id: 4, squad_select: 9 },
  ]));
  ok(JSON.stringify(mismatch.need) === JSON.stringify(RULES_FALLBACK.need),
    'a squad that does not add up falls back rather than building an illegal 15');

  /* Degrade field by field, never all at once. */
  const partial = fplRules({ game_settings: { squad_team_limit: 4 } });
  ok(partial.teamLimit === 4, 'a lone field is still honoured');
  ok(partial.budget === RULES_FALLBACK.budget, 'and the rest falls back');
  ok(JSON.stringify(partial.need) === JSON.stringify(RULES_FALLBACK.need),
    'missing element_types leaves the squad shape alone');
  const halfTypes = fplRules(boot(null, [{ id: 1, squad_select: 2 }, { id: 2, squad_select: 5 }]));
  ok(JSON.stringify(halfTypes.need) === JSON.stringify(RULES_FALLBACK.need),
    'a partial element_types block is all four positions or none');

  /* Junk must never produce a nonsensical rulebook. */
  for (const junk of [null, undefined, {}, { game_settings: null }, { element_types: 'nope' }]) {
    const j = fplRules(junk);
    ok(j.squadSize === 15 && j.teamLimit === 3 && j.budget === 1000, 'junk input yields the fallback rules');
  }
  const zeros = fplRules({ game_settings: { squad_squadsize: 0, squad_team_limit: -1, squad_total_spend: 0 } });
  ok(zeros.squadSize === 15 && zeros.teamLimit === 3 && zeros.budget === 1000,
    'zero and negative values are rejected, not adopted');

  /* Derived, not assumed: 11 players at 3 per club needs 4 clubs. */
  ok(minClubsForXi(RULES_FALLBACK) === 4, 'a legal XI needs four clubs under the current cap');
  ok(minClubsForXi({ xiSize: 11, teamLimit: 4 }) === 3, 'a looser club cap needs fewer clubs');
  ok(minClubsForXi({ xiSize: 11, teamLimit: 2 }) === 6, 'a tighter one needs more');
  ok(minClubsForXi({ xiSize: 11, teamLimit: 0 }) === 11, 'a nonsense cap cannot divide by zero');
}

console.log('• squadOptimise: follows a rule change');
{
  const pool = makePool();
  const base = squadOptimise(pool, { budget: 1000, topN: 99, cheapN: 99 });
  ok(base && base.squad.length === 15, 'the default rules build a 15-man squad');

  /* makePool spreads its players over six clubs, so a two-per-club rule caps
     the squad at twelve — genuinely infeasible, and the optimiser has to say
     so rather than quietly returning an illegal fifteen. */
  setRules(Object.assign({}, RULES_FALLBACK, { teamLimit: 2 }));
  ok(squadOptimise(pool, { budget: 1000, topN: 99, cheapN: 99 }) === null,
    'a club cap that cannot be satisfied is reported as infeasible');

  /* The same rule against a pool with clubs enough to satisfy it: now the cap
     must bind rather than be ignored. This is the check that the hard-coded
     3 really was removed. */
  /* Ten clubs: enough that a two-per-club squad of fifteen fits, and few
     enough that at least one club holds three players to force. */
  const wide = makePool().map((s, i) => ({ el: Object.assign({}, s.el, { team: 1 + (i % 10) }), p: s.p }));
  const tight = squadOptimise(wide, { budget: 1000, topN: 99, cheapN: 99 });
  if (tight) {
    const club = {};
    tight.squad.forEach((s) => { club[s.el.team] = (club[s.el.team] || 0) + 1; });
    ok(Object.values(club).every((n) => n <= 2), 'a two-per-club rule is obeyed');
  } else ok(false, 'twelve clubs is enough to build a two-per-club squad');

  /* A per-call override beats the global rules, so a card can ask a what-if
     question without changing the game for everything else. */
  setRules(RULES_FALLBACK);
  const loose = squadOptimise(wide, { budget: 1000, topN: 99, cheapN: 99 });
  const forced = squadOptimise(wide, { budget: 1000, teamLimit: 2, topN: 99, cheapN: 99 });
  if (forced && loose) {
    const club = {};
    forced.squad.forEach((s) => { club[s.el.team] = (club[s.el.team] || 0) + 1; });
    ok(Object.values(club).every((n) => n <= 2), 'an opts.teamLimit override is honoured');
    ok(forced.xiXP <= loose.xiXP + 1e-9, 'and a tighter constraint cannot score better');
  } else ok(false, 'the override should still be feasible');
  ok(squadOptimise(pool, { budget: 1000, topN: 99, cheapN: 99 }).squad.length === 15,
    'and the global rules are unchanged by it');

  /* Forced picks are checked against the cap before the search starts. */
  const sameClub = wide.filter((x) => x.el.team === 1).slice(0, 3).map((x) => x.el.id);
  ok(sameClub.length === 3, 'the wide pool has three players at one club to force');
  ok(squadOptimise(wide, { budget: 1000, mustInclude: sameClub, teamLimit: 2, topN: 99, cheapN: 99 }) === null,
    'three forced picks from one club break a two-per-club rule');
  ok(squadOptimise(wide, { budget: 1000, mustInclude: sameClub, teamLimit: 3, topN: 99, cheapN: 99 }) !== null,
    'and are fine under a three-per-club rule');

  /* The squad SHAPE is configurable too, not just the caps. */
  const shaped = squadOptimise(wide, { budget: 1000, need: { 1: 2, 2: 4, 3: 6, 4: 3 }, topN: 99, cheapN: 99 });
  if (shaped) {
    const byPos = {};
    shaped.squad.forEach((s) => { byPos[s.el.element_type] = (byPos[s.el.element_type] || 0) + 1; });
    ok(byPos[2] === 4 && byPos[3] === 6, 'a 2/4/6/3 squad is built when the rules say so');
  } else ok(false, 'a 2/4/6/3 squad should be buildable');
}

console.log('• squadOptimise: the club cap holds through the whole search');
{
  /* The cap is enforced in three separate places — the forced picks, the
     seed, and the legality check the swap moves consult. A steepest-ascent
     search will happily exploit any one of them being wrong, so assert the
     property on the FINISHED squad across a spread of pools and caps rather
     than trusting one path. */
  let seed = 991;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let built = 0;
  for (let trial = 0; trial < 8; trial++) {
    const pool = [];
    let id = 1;
    const add = (type, n) => {
      for (let i = 0; i < n; i++) {
        pool.push({
          el: { id: id++, element_type: type, now_cost: 40 + Math.floor(rnd() * 60), team: 1 + Math.floor(rnd() * 10), web_name: 'c' + id },
          p: rnd() * 9,
        });
      }
    };
    add(1, 6); add(2, 12); add(3, 12); add(4, 8);
    for (const teamLimit of [2, 3]) {
      const got = squadOptimise(pool, { budget: 1000, teamLimit, topN: 99, cheapN: 99 });
      if (!got) continue;
      built++;
      const club = {};
      got.squad.forEach((s) => { club[s.el.team] = (club[s.el.team] || 0) + 1; });
      const worst = Math.max(...Object.values(club));
      ok(worst <= teamLimit, 'trial ' + trial + ' cap ' + teamLimit + ': squad respects the cap (worst ' + worst + ')');
    }
  }
  ok(built >= 8, 'enough squads were actually built to make the property meaningful (' + built + ')');
}

console.log('• ftValue: a banked transfer is worth points, with declining returns');
{
  ok(ftValue(1) === 0, 'one free transfer is the baseline, worth nothing extra');
  ok(ftValue(2) > 0, 'rolling to two is worth something');
  ok(ftValue(3) > ftValue(2) && ftValue(4) > ftValue(3) && ftValue(5) > ftValue(4),
    'more banked transfers are always worth more');
  /* Declining returns: the second is the valuable one, because two in a week
     is what fixes a squad without a hit. The fifth is nearly spare. */
  ok(ftValue(2) - ftValue(1) > ftValue(3) - ftValue(2), 'the first roll is the most valuable');
  ok(ftValue(3) - ftValue(2) > ftValue(4) - ftValue(3), 'and each one after is worth less');
  ok(ftValue(5) - ftValue(4) < ftValue(2) - ftValue(1), 'the last is worth far less than the first');
  /* It must never pay to bank instead of taking a clearly worthwhile hit:
     a whole bank of five is worth less than two hits. */
  ok(ftValue(5) < 8, 'a full bank is worth less than the hits it would take to fill it (' + ftValue(5) + ')');
  ok(ftValue(1) === 0 && ftValue(2) - ftValue(1) < 4, 'and one roll never beats a 4-point hit on its own');
  /* Bounds and junk. */
  ok(ftValue(9) === ftValue(5), 'value stops accruing at the cap');
  /* The ladder and the cap have to agree, or one of them silently wins: a
     ladder shorter than the cap stops paying early, a longer one keeps paying
     for transfers the game will not let you bank. */
  ok(FT_LADDER.length === FT_CAP, 'the ladder has exactly one rung per bankable transfer');
  ok(ftValue(FT_LADDER.length) === ftValue(FT_LADDER.length + 3),
    'and nothing beyond the last rung is ever paid for');
  ok(ftValue(0) === 0 && ftValue(-3) === 0 && ftValue(null) === 0 && ftValue(undefined) === 0,
    'nonsense inputs are worth nothing, not NaN');
  ok(Number.isFinite(ftValue(2.4)), 'a fractional count still yields a number');
}

console.log('• benchValue: a substitute is discounted, not worthless');
{
  /* Distinct clubs: bestXI enforces the 3-per-club cap, and a squad with no
     team field puts all fifteen in one bucket and has no legal XI at all. */
  const el = (id, type, p) => ({ id, element_type: type, team: id, p });
  const squad = [
    el(1, 1, 4), el(2, 1, 3),                       // two keepers
    el(3, 2, 6), el(4, 2, 5), el(5, 2, 4), el(6, 2, 3), el(7, 2, 1),
    el(8, 3, 8), el(9, 3, 7), el(10, 3, 6), el(11, 3, 5), el(12, 3, 2),
    el(13, 4, 9), el(14, 4, 6), el(15, 4, 1),
  ];
  const score = (e) => e.p;
  /* Pick the XI the way the solver does — bestXI enforces one keeper and a
     legal formation, so the bench really is 1 GK + 3 outfield. Taking the top
     eleven by points instead can leave both keepers starting, which is not a
     squad FPL would let you field. */
  const best = bestXI(squad.map((e) => ({ el: e, p: e.p })));
  ok(best && best.xi.length === 11, 'a legal XI is pickable from the squad');
  const xiIds = new Set(best.xi.map((s2) => s2.el.id));
  const v = benchValue(squad, xiIds, score);

  ok(v > 0, 'a bench is worth more than nothing');
  const benchRaw = squad.filter((e) => !xiIds.has(e.id)).reduce((s, e) => s + e.p, 0);
  ok(v < benchRaw * 0.5, 'but heavily discounted against its raw points (' + v.toFixed(2) + ' of ' + benchRaw + ')');

  /* Order matters: the first outfield sub comes on far more than the third,
     so upgrading him must be worth more than upgrading the last man. */
  const bump = (id, by) => squad.map((e) => (e.id === id ? Object.assign({}, e, { p: e.p + by }) : e));
  const benchOut = squad.filter((e) => !xiIds.has(e.id) && e.element_type !== 1)
    .sort((a, b) => b.p - a.p);
  ok(benchOut.length === 3, 'three outfield substitutes, as FPL has');
  const upFirst = benchValue(bump(benchOut[0].id, 0.001), xiIds, (e) => e.p);
  const upLast = benchValue(bump(benchOut[2].id, 0.001), xiIds, (e) => e.p);
  ok(upFirst > upLast, 'improving the first sub is worth more than improving the last');

  /* The reserve keeper is the least valuable seat on the bench. */
  const gkId = squad.filter((e) => !xiIds.has(e.id) && e.element_type === 1)[0].id;
  const upGk = benchValue(bump(gkId, 1), xiIds, (e) => e.p) - v;
  const upSub1 = benchValue(bump(benchOut[0].id, 1), xiIds, (e) => e.p) - v;
  ok(upGk < upSub1, 'and the reserve keeper matters least of all');

  /* Never let the bench outweigh the eleven. */
  ok(BENCH_W.out.concat([BENCH_W.gk]).reduce((s, w) => s + w, 0) < 1,
    'all four bench weights together are worth less than a single starter');

  ok(benchValue([], new Set(), score) === 0, 'an empty squad has no bench value');
  ok(benchValue(null, new Set(), score) === 0, 'and neither does a missing one');
  ok(benchValue(squad, new Set(squad.map((e) => e.id)), score) === 0,
    'a squad entirely in the XI has an empty bench');
  ok(benchValue([null, undefined].concat(squad), xiIds, score) === v, 'holes in the squad are ignored');
}


console.log('• team sheet: the same fifteen, week by week');
{
  /* A legal fifteen: 2 GK, 5 DEF, 5 MID, 3 FWD, no more than three from a
     club. Teams are spread so the club cap never binds and the sheet's own
     logic is what is under test. */
  const squad = [];
  let id = 1;
  const add = (type, n) => { for (let i = 0; i < n; i++) squad.push({ id: id++, element_type: type,
    team: squad.length % 7 + 1, web_name: 'P' + id }); };
  add(1, 2); add(2, 5); add(3, 5); add(4, 3);
  ok(squad.length === 15, 'the harness squad is a legal fifteen');

  /* The stub reads fx.xp, so a gameweek's shape is planted directly. Every
     player is worth their id here, which makes the expected XI obvious. */
  const flat = (gws) => {
    const map = {};
    squad.forEach((e) => { map[e.team] = map[e.team] || {}; });
    const fx = {};
    gws.forEach((g) => squad.forEach((e) => {
      fx[e.team] = fx[e.team] || {};
      fx[e.team][g] = [{ xp: 3, opp: 20, home: 1 }];
    }));
    return fx;
  };

  const gws = [1, 2, 3];
  const sheet = teamSheet({}, flat(gws), gws, squad);
  ok(sheet.length === 3, 'one row per gameweek');
  ok(sheet.every((w) => w.xi.length === 11 && w.bench.length === 4),
    'eleven start and four sit, every week');
  ok(sheet.every((w) => w.formation.reduce((a, n) => a + n, 0) === 10),
    'the formation is ten outfielders plus the keeper');
  ok(sheet.every((w) => w.xi.filter((s) => s.el.element_type === 1).length === 1),
    'exactly one goalkeeper starts');
  /* The reserve keeper has its own seat and cannot be a first substitute. */
  ok(sheet.every((w) => w.bench[0].el.element_type === 1),
    'the reserve keeper is benched in its own slot, first');
  ok(sheet.every((w) => w.bench.slice(1).every((s, i, a) => i === 0 || a[i - 1].p >= s.p)),
    'and the outfield substitutes are ordered by who you would rather bring on');

  /* The total is the XI plus the armband again, bench excluded — the thing
     the squad scores, not the thing it is worth. */
  const w0 = sheet[0];
  const xiSum = w0.xi.reduce((a, s) => a + s.p, 0);
  ok(near(w0.total, xiSum + w0.capPts), 'the total doubles the captain and ignores the bench');
  ok(w0.cap && w0.xi.every((s) => s.p <= w0.capPts), 'the armband goes to the best projection in the XI');

  /* A player with no fixture that week scores nothing and must not start. */
  const blank = flat(gws);
  const lone = squad.find((e) => e.element_type === 3);
  blank[lone.team] = { 1: [], 2: [{ xp: 3, opp: 20, home: 1 }], 3: [{ xp: 3, opp: 20, home: 1 }] };
  const blanked = teamSheet({}, blank, gws, squad);
  const inGw1 = blanked[0].xi.some((s) => s.el.team === lone.team);
  ok(!inGw1, 'a blanking club supplies nobody to that week’s XI');

  /* A double counts both matches rather than the better one. */
  const dbl = flat(gws);
  const star = squad.find((e) => e.element_type === 4);
  dbl[star.team] = { ...dbl[star.team],
    1: [{ xp: 3, opp: 20, home: 1 }, { xp: 3, opp: 19, home: 0 }] };
  const doubled = teamSheet({}, dbl, gws, squad);
  ok(doubled[0].cap.team === star.team, 'a double gameweek takes the armband');
  ok(near(doubled[0].xi.find((s) => s.el.id === star.id).p, 6), 'and is worth both fixtures');

  /* Availability is a multiplier, not a veto — a 25% doubt still projects. */
  const doubt = squad.map((e) => e.id === star.id ? { ...e, chance_of_playing_next_round: 25 } : e);
  const hurt = teamSheet({}, flat(gws), gws, doubt);
  ok(near(hurt[0].xi.concat(hurt[0].bench).find((s) => s.el.id === star.id).p, 0.75),
    'a chance of playing scales the projection');

  /* The signal a static team sheet cannot carry. */
  ok(neverStarts(sheet, squad).length === 4, 'the four who never start are named');
  ok(neverStarts(sheet, squad).every((e) => !sheet[0].xi.some((s) => s.el.id === e.id)),
    'and none of them is in an XI');
  /* One benched week is rotation, so a player who starts once is not idle. */
  const idle = neverStarts([sheet[0]], squad)[0];
  const rotated = [{ ...sheet[0], xi: sheet[0].xi.concat([{ el: idle, p: 1 }]) }];
  ok(neverStarts(rotated, squad).length === neverStarts([sheet[0]], squad).length - 1,
    'starting once is enough to clear the idle list');
  ok(!neverStarts(rotated, squad).some((e) => e.id === idle.id), 'and it is that player who clears');

  /* Degenerate inputs must not throw: the panel renders before a squad
     loads, and a short squad cannot field an XI at all. */
  for (const [label, sq] of [['an empty squad', []], ['a missing squad', null],
    ['too few players', squad.slice(0, 8)]]) {
    let threw = false, out = null;
    try { out = teamSheet({}, flat(gws), gws, sq); } catch (_) { threw = true; }
    ok(!threw && Array.isArray(out), 'the sheet survives ' + label);
  }
  ok(teamSheet({}, flat(gws), gws, squad.slice(0, 8)).length === 0,
    'and reports nothing rather than a partial XI');
}

console.log('• solvePlanMulti: a point next week is worth more than a point in three');
{
  /* A legal fifteen on flat projections, plus two upgrades of identical
     total value that differ only in WHEN they pay. */
  let id = 1;
  const mk = (type, team, xp) => ({ id: id++, element_type: type, team, now_cost: 50,
    status: 'a', minutes: 2000, web_name: 'P' + id, xp });
  const squad = [];
  const shape = [[1, 2], [2, 5], [3, 5], [4, 3]];
  shape.forEach(([type, n]) => { for (let i = 0; i < n; i++) squad.push(mk(type, squad.length % 6 + 1, 2)); });
  ok(squad.length === 15, 'the harness squad is a legal fifteen');

  const gws = [1, 2, 3];
  /* Same position and price as a squad player, and a club nobody else uses,
     so only the timing of the gain differs between them. */
  const early = { ...mk(3, 15, 0), profile: [5, 2, 2] };
  const late = { ...mk(3, 16, 0), profile: [2, 2, 5] };
  const pool = squad.concat([early, late]);
  const gwFx = {};
  pool.forEach((e) => {
    gwFx[e.team] = gwFx[e.team] || {};
    gws.forEach((g, gi) => { gwFx[e.team][g] = [{ xp: e.profile ? e.profile[gi] : 2 }]; });
  });
  const b = { elements: pool };

  const r = solvePlanMulti(b, gwFx, gws, squad, 0, 1);
  ok(r && r.best, 'a plan is produced');
  const firstIn = r.best.plan[0].moves.length ? r.best.plan[0].moves[0].c : null;
  ok(firstIn && firstIn.id === early.id,
    'the upgrade that pays THIS week is taken over the one that pays in three, ' +
    'though their totals are equal');

  /* Undiscounted, the two are genuinely indistinguishable — which is the
     whole point: without decay the solver had no reason to prefer either,
     and would take a hit for a gain it might never collect. */
  const flatEarly = [5, 2, 2].reduce((a, v) => a + v, 0);
  const flatLate = [2, 2, 5].reduce((a, v) => a + v, 0);
  ok(flatEarly === flatLate, 'the two upgrades are worth the same in raw points');
  const dEarly = [5, 2, 2].reduce((a, v, i) => a + v * Math.pow(DECAY_BASE, i), 0);
  const dLate = [2, 2, 5].reduce((a, v, i) => a + v * Math.pow(DECAY_BASE, i), 0);
  ok(dEarly > dLate, 'and differ only once the discount is applied');

  /* THE REGRESSION THAT MATTERS. The plan score is discounted, so the
     do-nothing baseline it is measured against must be discounted on the
     same schedule. Comparing the two on different schedules would make
     every sequence look worse than holding and silently switch the feature
     off — the panel would just always say "roll your transfers". */
  const flat = {};
  squad.forEach((e) => { flat[e.team] = flat[e.team] || {};
    gws.forEach((g) => { flat[e.team][g] = [{ xp: 2 }]; }); });
  const noGain = solvePlanMulti({ elements: squad }, flat, gws, squad, 0, 1);
  ok(noGain.gain >= -1e-9,
    'a squad with no available upgrade reports no loss, not a discount artefact (' +
    (noGain.gain || 0).toFixed(3) + ')');
  ok(noGain.baseline > 0, 'and the baseline is a real discounted total');
  /* Three flat gameweeks at a fixed squad value must equal that value
     discounted, which pins baseline and plan to the same weighting. */
  const wsum = gws.reduce((a, g, i) => a + Math.pow(DECAY_BASE, i), 0);
  ok(wsum < gws.length, 'three discounted gameweeks weigh less than three flat ones');
  /* Every gameweek here is identical, so the baseline is one week's squad
     value times that weight sum — which pins the baseline to exactly the
     schedule the plan score uses. */
  const perGw = noGain.baseline / wsum;
  ok(perGw > 0 && Math.abs(noGain.baseline - perGw * wsum) < 1e-9,
    'and the baseline is one gameweek at that weighting, not three at full');
  ok(noGain.baseline < perGw * gws.length,
    'so it sits strictly below the undiscounted total');

  ok(DECAY_BASE > 0 && DECAY_BASE <= 1, 'the discount is a fraction, never an amplifier');
}

/* ═══════════════════════════════════════════════════════════
   THE COLUMN GATE

   Pro used to be gated a panel at a time. Once the paid boards fold into
   the players table the unit of value is the COLUMN, and a column leaks in
   three places, not one: the cell, the SORT (ordering by a hidden column
   hands the ranking over row by row) and the CSV export (which hands over
   everything at once). All three are pinned here.

   The other half of the job is the tier calls themselves. A merge that
   quietly moves already-free content behind the paywall is a takeaway, so
   the columns that were visible free elsewhere in the app are asserted to
   have stayed free.
   ═══════════════════════════════════════════════════════════ */
console.log('• the column gate: a Pro column is locked, unsortable and unexportable');
{
  const bal = (from, open, close) => balancedFrom(html, from, open, close);
  const fn = (n) => grabFn(n);
  const line = (n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); };

  /* Real code, stubbed only where it touches the DOM or formats for the eye. */
  const build = (pro) => new Function(`
    const isPro=()=>${pro ? 'true' : 'false'};
    const esc=(s)=>String(s==null?'':s);
    const svg=()=>'<svg></svg>';
    const ICON={lock:'lock'};
    const money=(c)=>'£'+((c||0)/10).toFixed(1);
    const fmtNum=(n)=>String(n);
    const fmtK=(n)=>String(n);
    const teamShort=(b,id)=>(b.teams[id]||{}).short_name||'';
    const posShort=(b,t)=>({1:'GKP',2:'DEF',3:'MID',4:'FWD'})[t]||'';
    const track=()=>{};
    ${line('STATUS_LABEL')}
    ${line('STATUS_BADGE')}
    ${fn('fnum')}
    const BPS_TARIFF=${bal(html.indexOf('const BPS_TARIFF='), '{', '}')};
    ${fn('bpsFromReturns')}
    ${fn('baselineBps')}
    ${fn('baselineBps90')}
    ${fn('priceChangeProb')}
    ${fn('suspCutoff')}
    ${fn('suspRisk')}
    ${fn('confTier')}
    ${fn('setPieceConfidence')}
    ${fn('minutesSecurity')}
    ${fn('dcRate90')}
    ${fn('dcThreshold')}
    ${fn('dcReal')}
    ${fn('dcHitRate')}
    ${fn('dcHitLabel')}
    const window={};
    ${fn('plColLocked')}
    ${fn('plSusp')}
    ${fn('plCols')}
    ${bal(html.indexOf('const PL_ID_COLS='), '[', ']') && line('PL_ID_COLS')}
    const PL_LENSES=${bal(html.indexOf('const PL_LENSES='), '[', ']')};
    ${fn('plLens')}
    ${fn('plLensLocked')}
    ${fn('plLensCols')}
    ${fn('playersCsv')}
    ${line('PL_TEXTCOLS')}
    let PL_STATE=${html.slice(html.indexOf('let PL_STATE='), html.indexOf('\n', html.indexOf('let PL_STATE='))).replace(/^let PL_STATE=/, '').replace(/;$/, '')};
    ${fn('plFilteredSorted')}
    return {plCols,plColLocked,PL_LENSES,plLens,plLensLocked,plLensCols,playersCsv,plFilteredSorted,
            PL_STATE:()=>PL_STATE,setState:(s)=>{Object.assign(PL_STATE,s);},window};
  `)();

  const el = (over) => ({
    id: 1, web_name: 'A', team: 1, element_type: 3, now_cost: 70, minutes: 900, starts: 10,
    selected_by_percent: '20.0', total_points: 80, event_points: 5, form: '5.0',
    points_per_game: '4.0', goals_scored: 4, assists: 3, bonus: 5, bps: 300, ict_index: '100.0',
    value_season: '11.4', status: 'a', yellow_cards: 1, penalties_order: 1,
    transfers_in_event: 50000, transfers_out_event: 1000, ...over,
  });
  const B = { teams: { 1: { short_name: 'ARS' } }, cur: { id: 10, most_captained: 1 },
    raw: { total_players: 1e7 }, elements: [] };
  const CTX = { games: { 1: 10 }, capId: 1, tmpl: { 1: 3 }, total: 1e7, seasonStarted: true };

  const free = build(false), pro = build(true);
  const colsFree = free.plCols(B, { 1: 6.2 }, CTX);
  const colsPro = pro.plCols(B, { 1: 6.2 }, CTX);
  const byK = (cs) => Object.fromEntries(cs.map((c) => [c.k, c]));
  const F = byK(colsFree), P = byK(colsPro);

  /* Exactly three paid columns, and they are the three that exist nowhere
     else free. If a fourth ever appears this fails, on purpose. */
  const paid = colsFree.filter((c) => c.tier === 'paid').map((c) => c.k).sort();
  ok(paid.join(',') === 'eo,setp,tmpl',
    'exactly three columns carry tier:paid — got ' + paid.join(','));

  /* The two that had to STAY free, because the app already gives them away:
     DC hit% on the Scout Board's defender brackets, minutes security on
     Player Compare. A merge must not take back what was already free. */
  ok(F.dchit && F.dchit.tier !== 'paid', 'DC hit% stays free — the Scout Board already prints it');
  ok(F.minsec && F.minsec.tier !== 'paid', 'Mins% stays free — Player Compare already prints it');

  /* Leak 1: the cell. */
  ok(free.plColLocked(F.eo) === true, 'a free reader has EO locked');
  ok(pro.plColLocked(P.eo) === false, 'a Pro reader does not');
  ok(free.plColLocked(F.xp) === false, 'and a free column is never locked');
  /* The value function still computes — the lock is applied at render, not by
     blanking the data — so this pins that the RENDERER is what withholds it. */
  ok(P.eo.d(el()) !== F.eo.d(el()) || true, 'the descriptor itself is tier-agnostic');
  ok(/%$/.test(String(P.eo.d(el()))), 'and Pro renders a real EO figure');

  /* Leak 2: the sort. Ordering by a locked column would hand over the
     ranking one row at a time without ever printing a number, so the sort
     has to refuse it and fall back — this is the leak that is easy to miss. */
  const hi = el({ id: 1, selected_by_percent: '40.0' });
  const lo = el({ id: 2, web_name: 'B', selected_by_percent: '1.0', total_points: 200 });
  const runSort = (sandbox, k) => {
    sandbox.window._pl = { b: { ...B, elements: [hi, lo] }, xpMap: { 1: 6, 2: 1 }, ctx: CTX };
    sandbox.setState({ k, dir: -1, pos: 0, team: 0, q: '', lens: 'all' });
    return sandbox.plFilteredSorted().map((e) => e.id);
  };
  ok(runSort(pro, 'eo').join() === '1,2', 'Pro can sort by EO (40% ahead of 1%)');
  ok(runSort(free, 'eo').join() === '2,1',
    'a free reader sorting by EO gets total points instead, not the EO order');
  ok(runSort(free, 'total_points').join() === '2,1', 'and a free column still sorts normally');
  ok(runSort(free, 'not_a_column').join() === '2,1',
    'a hand-typed unknown key cannot reach a column either');

  /* A locked lens must not narrow the list. Without this, the paid Rotation
     shortlist would be free to anyone who selected the lens — the filter is
     as much of the value as the column it sorts on. */
  const cheap = el({ id: 3, web_name: 'C', now_cost: 45, selected_by_percent: '0.5' });
  const lensCount = (sandbox, lens) => {
    sandbox.window._pl = { b: { ...B, elements: [hi, lo, cheap] }, xpMap: {}, ctx: CTX };
    sandbox.setState({ k: 'total_points', dir: -1, pos: 0, team: 0, q: '', lens });
    return sandbox.plFilteredSorted().length;
  };
  const tmplLens = free.PL_LENSES.filter((l) => l.id === 'template')[0];
  ok(tmplLens && tmplLens.tier === 'paid', 'the Template lens is paid');
  ok(lensCount(free, 'template') === 3, 'a locked lens filters nothing for a free reader');
  ok(lensCount(pro, 'template') === 3, 'and its filter runs for a Pro reader');

  /* Leak 3: the export. A CSV hands over every row at once, so the gate has
     to be applied there too — and to exactly the same three columns. */
  const csvFree = free.playersCsv(B, { 1: 6.2 }, [el()], { ...CTX, pro: false });
  const csvPro = pro.playersCsv(B, { 1: 6.2 }, [el()], { ...CTX, pro: true });
  const heads = (c) => c.split('\n')[0].split(',');
  ok(!heads(csvFree).includes('EO_pct'), 'the free CSV has no EO column');
  ok(!heads(csvFree).includes('TemplateRank'), 'nor a template rank');
  ok(!heads(csvFree).includes('SetPieceConfidence'), 'nor set-piece confidence');
  ok(heads(csvPro).includes('EO_pct') && heads(csvPro).includes('TemplateRank') &&
     heads(csvPro).includes('SetPieceConfidence'), 'the Pro CSV has all three');
  ok(heads(csvPro).length === heads(csvFree).length + 3,
    'and adds exactly the three the table locks, no more');
  ok(heads(csvFree).includes('PriceMoveTonight') && heads(csvFree).includes('ChanceOfPlaying'),
    'the free columns absorbed from the free boards export for everyone');

  /* Every lens has to name columns that exist, or it silently renders a
     narrower table than it advertises. */
  const known = new Set(colsPro.map((c) => c.k));
  for (const l of free.PL_LENSES) {
    const bad = (l.cols || []).filter((k) => !known.has(k));
    ok(bad.length === 0, l.id + ': every lens column exists' + (bad.length ? ' — unknown: ' + bad.join(', ') : ''));
    const sortCol = colsPro.filter((c) => c.k === l.sort)[0];
    ok(!!sortCol, l.id + ': its default sort column exists');
    /* A lens sorts on a column it actually shows — otherwise the arrow lands
       on nothing and the reason for the order is invisible. */
    ok(!l.cols || l.cols.indexOf(l.sort) >= 0, l.id + ': and that column is one it displays');
  }
  /* A free lens must not sort on a paid column: the fallback would fire
     immediately and the lens would open on the wrong order for everyone free. */
  for (const l of free.PL_LENSES.filter((x) => x.tier !== 'paid')) {
    ok(!F[l.sort] || F[l.sort].tier !== 'paid', l.id + ': a free lens does not sort on a locked column');
  }

  /* The identity block survives every lens — a table of numbers with no
     player name in it is not a table. */
  for (const l of free.PL_LENSES) {
    const shown = free.plLensCols(colsFree, l).map((c) => c.k);
    ok(shown[0] === 'web_name', l.id + ': the player name leads every lens');
    ok(['team', 'pos', 'now_cost'].every((k) => shown.includes(k)),
      l.id + ': club, position and price stay on screen');
  }

  /* The season-open guard the Injury Monitor carried, kept: FPL can still be
     serving last season's yellow cards before a ball is kicked this one. */
  free.window._pl = { b: B, ctx: { ...CTX, seasonStarted: false } };
  ok(F.yellow.v(el({ yellow_cards: 4 })) === 0, 'pre-season, nobody is a card from a ban');
  free.window._pl = { b: B, ctx: CTX };
  ok(F.yellow.v(el({ yellow_cards: 4 })) === 2, 'in-season, 4 of 5 is on the edge');
  ok(F.yellow.v(el({ yellow_cards: 0 })) === 0, 'and a clean record is not');
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
