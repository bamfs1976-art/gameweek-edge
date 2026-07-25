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
const grabConst = (n) => {
  const i = html.indexOf('const ' + n + '=');
  return html.slice(i, html.indexOf('\n', i));
};

const { squadOptimise, bestXI } = new Function(
  grabFn('bestXI') + '\n' + grabConst('SQUAD_NEED') + '\n' + grabFn('squadOptimise') +
  '\nreturn {squadOptimise,bestXI};'
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
  ok(/NAV\.filter\(canSeePanel\)/.test(html), 'sidebar areas are filtered by the gate');
  ok(/area\.panels\.filter\(canSeePanel\)/.test(html), 'sidebar panels are filtered by the gate');
  ok(/if\(!canSeePanel\(p\)\)return;/.test(html), 'command palette is filtered by the gate');
  ok(/if\(!PANELS\[panelId\]\|\|!canSeePanel\(PANELS\[panelId\]\)\)panelId='dashboard';/.test(html),
    'openPanel guards deep links');

  /* Owner rights come from the signed-in email allowlist, never from a
     client-settable tier — guard against that regressing. */
  ok(/function canSeePanel\(p\)\{return !ownerOnly\(p\)\|\|!!window\.GE_OWNER;\}/.test(html),
    'the gate keys off GE_OWNER, not the local tier setting');
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
