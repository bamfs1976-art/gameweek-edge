/*
 * The fixture grid's squad rows, and the double gameweek they exist to show.
 *
 * Run: node dev/test-fixture-ticker.mjs   (also `npm test`)
 *
 * Why this file exists.
 *
 * The grid built its per-team map with a plain assignment:
 *
 *     (byTeamGw[f.team_h] = byTeamGw[f.team_h] || {})[f.event] = { ... }
 *
 * so when a club played twice in one gameweek the second fixture overwrote
 * the first and one real match vanished with no marker anywhere — not in the
 * cell, not in the run total, not in the rotation strips or the opener
 * planner that read the same map. The panel's own source said so, in the
 * comment above FX_VIEWS explaining why the Clean Sheet Matrix was kept
 * separate: "the grid's per-team map keeps one fixture per gameweek and
 * silently drops the other."
 *
 * A club grid can carry that quietly. A grid with the user's own squad in it
 * cannot, because spotting a double is most of the reason anyone opens one.
 *
 * So the two things are tested together here: the combination rule for a
 * double, and the ordering rule for squad rows. Both are pure and both are
 * named, precisely so this file can reach them — the browser suite in
 * dev/test-ui.mjs then checks that they reach the screen.
 *
 * The single-fixture cases are not padding. The map feeds eight call sites
 * and 380 of the 380 fixtures in a normal season are singles, so the
 * assertion that most matters is that a single still grades, prints and
 * totals EXACTLY as it did before any of this.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/* Same extractor the other suites use: locate a named function, brace-match
   it out, evaluate the real shipping source. Comments are skipped before
   strings so an apostrophe in prose cannot open a phantom string. */
function extractBlock(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  if (open < 0) throw new Error('no opening brace');
  let depth = 0, inStr = null, esc = false, com = 0;
  for (let j = open; j < src.length; j++) {
    const ch = src[j], nx = src[j + 1];
    if (com) {
      if (com === 1 && ch === '\n') com = 0;
      else if (com === 2 && ch === '*' && nx === '/') { com = 0; j++; }
      continue;
    }
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '/' && nx === '/') { com = 1; j++; continue; }
    if (ch === '/' && nx === '*') { com = 2; j++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced braces');
}
function extractFn(src, name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('function not found: ' + name);
  return extractBlock(src, idx);
}
function extractConst(src, name) {
  const idx = src.indexOf('const ' + name + '=');
  if (idx < 0) throw new Error('const not found: ' + name);
  return extractBlock(src, idx) + ';';
}
function extractLine(src, re) {
  const m = src.match(re);
  if (!m) throw new Error('line not found: ' + re);
  return m[0];
}

const ctx = vm.createContext({ console });
vm.runInContext([
  extractLine(html, /const STRENGTH_BANDS=\[[^\]]*\];/),
  extractFn(html, 'strengthGrade'),
  extractLine(html, /function plsimDiff\(pWin\)\{[^}]*\}/),
  extractFn(html, 'fdrAttack'),
  extractFn(html, 'fdrDefence'),
  extractFn(html, 'fdrOfficial'),
  extractConst(html, 'FDR_LENS'),
  extractFn(html, 'fdrLens'),
  extractFn(html, 'fdrCellValue'),
  extractFn(html, 'fdrRunTotal'),
  extractFn(html, 'fdrGrade'),
  extractFn(html, 'fdrOppLabel'),
  extractFn(html, 'fdrCombine'),
  extractFn(html, 'fdrSquadOrder'),
  extractFn(html, 'fdrDraftPicks')
].join('\n'), ctx);

const { fdrCombine, fdrOppLabel, fdrGrade, fdrCellValue, fdrRunTotal, fdrSquadOrder } = ctx;

let pass = 0; const fail = [];
const ok = (cond, label) => { if (cond) pass++; else fail.push(label); };
const eq = (got, want, label) =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${label} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const VIEWS = ['overall', 'attack', 'defence', 'fpl', 'strength'];

/* A fixture cell exactly as hydrateFixtures builds one. */
const cell = (o) => Object.assign({
  opp: 'IPS', diff: 3, fdr: 3, home: true, lam: 1.4, cs: 0.3, win: 0.42,
  s: { edge: 1.0 }
}, o);

/* ── singles must not move ──────────────────────────────────
   Every assertion in this block is "identical to the old behaviour". The
   combination rule is only allowed to exist for doubles. */
{
  const raw = cell({});
  const c = fdrCombine([cell({})]);
  ok(c !== null, 'a one-fixture list combines to a cell rather than null');
  eq(c.n, 1, 'a single reports one fixture');
  for (const k of ['opp', 'diff', 'fdr', 'home', 'lam', 'cs', 'win']) {
    eq(c[k], raw[k], `a single leaves ${k} untouched`);
  }
  for (const v of VIEWS) {
    eq(fdrGrade(v, c), fdrGrade(v, raw), `a single grades identically under ${v}`);
    eq(fdrCellValue(v, c), fdrCellValue(v, raw), `a single prints identically under ${v}`);
    eq(fdrRunTotal(v, [c]), fdrRunTotal(v, [raw]), `a single totals identically under ${v}`);
  }
  ok(!c.g, 'a single carries no separate grade cell — nothing to average');
  eq(fdrCombine([]), null, 'an empty gameweek is null, the way a blank always was');
  eq(fdrCombine(null), null, 'and so is a missing one');
}

/* ── the combination rule ───────────────────────────────────
   Stated once, in one sentence, and tested field by field:
   a cell's number combines the way its own RUN TOTAL already combines.
   Attack, defence and FPL sum across gameweeks, so they sum within one.
   Overall and Strength average across gameweeks, so they average within one.
   A probability that summed would stop being a probability. */
{
  const a = cell({ opp: 'IPS', home: true, lam: 1.4, cs: 0.30, win: 0.42, fdr: 3, s: { edge: 1.2 } });
  const b = cell({ opp: 'FUL', home: false, lam: 1.0, cs: 0.20, win: 0.30, fdr: 2, s: { edge: 0.8 } });
  const d = fdrCombine([a, b]);

  eq(d.n, 2, 'a double reports two fixtures');
  eq(d.each.length, 2, 'and keeps both of them, in order');
  eq(d.each[0].opp, 'IPS', 'the first fixture stays first');
  ok(Math.abs(d.lam - 2.4) < 1e-9, 'expected goals SUM across a double (1.4 + 1.0)');
  ok(Math.abs(d.cs - 0.50) < 1e-9, 'expected clean sheets SUM (0.30 + 0.20)');
  ok(Math.abs(d.win - 0.36) < 1e-9, 'win odds AVERAGE — a probability stays a probability');
  eq(d.fdr, 5, 'the official FDR sums, because its run total sums (3 + 2)');

  /* The reason a grade cell exists at all. */
  /* The strength edge is a per-fixture ratio and there are two of them.
     Keeping the first fixture's and calling it the cell's would be the same
     class of loss this whole change is about, one field further down. */
  ok(d.s && Math.abs(d.s.edge - 1.0) < 1e-9, 'the strength edge averages both fixtures');

  ok(d.g, 'a double carries a per-match grade cell');
  ok(Math.abs(d.g.lam - 1.2) < 1e-9, 'the grade cell holds MEAN expected goals');
  ok(Math.abs(d.g.cs - 0.25) < 1e-9, 'and mean clean-sheet odds');
  eq(d.g.fdr, 3, 'and a mean FDR, rounded back onto the 1-5 scale');
}

/* ── a summed FDR above 5 must survive the lens ─────────────
   The block above uses 3 + 2 = 5, which is the one sum that hides this: the
   FPL lens sanity-checks its rating against 1-5 and falls back to 3 outside
   it, because that check was written for a single raw rating from the API. A
   double summing to 6 was printed as 3, and counted as 3 in the run total —
   the number was wrong in exactly the cell the ×2 badge was drawing
   attention to. Found in a screenshot, not by this file, because the case
   chosen to read nicely sat on the boundary.

   Most real doubles sum above 5. These use 2 + 4 and 5 + 5. */
{
  const a = cell({ opp: 'NEW', home: true, fdr: 2, lam: 1.5, cs: 0.3, win: 0.4 });
  const b = cell({ opp: 'ARS', home: false, fdr: 4, lam: 0.9, cs: 0.15, win: 0.2 });
  const d = fdrCombine([a, b]);
  eq(d.fdr, 6, 'the raw combined rating is the sum (2 + 4)');
  eq(fdrCellValue('fpl', d), '6', 'and the lens PRINTS 6, not the out-of-range fallback');
  eq(fdrGrade('fpl', d), 3, 'while the colour stays on the 1-5 scale (mean of 2 and 4)');
  eq(fdrRunTotal('fpl', [fdrCombine([cell({ fdr: 3 })]), d]), '9',
    'and the run total counts all three fixtures (3 + 2 + 4)');

  /* The ceiling: two 5s is a 10, and 10 is a legitimate reading for a cell
     holding two fixtures. Only a value outside n..5n is garbage. */
  const worst = fdrCombine([cell({ fdr: 5 }), cell({ opp: 'LIV', fdr: 5 })]);
  eq(fdrCellValue('fpl', worst), '10', 'two 5s print as 10, the worst a double can be');
  eq(fdrGrade('fpl', worst), 5, 'and still grade 5, because the scale is per match');

  /* A genuinely corrupt rating still falls back, per fixture. */
  const junk = fdrCombine([cell({ fdr: 0 }), cell({ opp: 'LIV', fdr: 99 })]);
  eq(fdrCellValue('fpl', junk), '6', 'two unusable ratings fall back to 3 each, not to 3 in total');

  /* fdrOfficial's own contract, tested directly rather than through
     fdrCombine. Every cell fdrCombine produces sums n values already forced
     into 1-5, so its result is always inside n..5n and the out-of-range
     branch is unreachable from the app — a mutation run proved it by
     changing that branch and breaking nothing. Reached here on purpose,
     because a defensive branch nothing can test is not a safeguard. */
  eq(ctx.fdrOfficial({ n: 2, fdr: 99 }), 6, 'an out-of-range combined rating falls back to 3 per fixture');
  eq(ctx.fdrOfficial({ n: 2, fdr: 1 }), 6, 'and so does one below the floor for two fixtures');
  eq(ctx.fdrOfficial({ n: 1, fdr: 0 }), 3, 'a single keeps the plain neutral fallback');
  eq(ctx.fdrOfficial({ n: 2, fdr: 2 }), 2, 'two 1s are a legitimate 2, not a fallback');
  eq(ctx.fdrOfficial(null), 3, 'and a missing cell is neutral rather than a throw');
}

/* ── the grade must stay on its scale, for every lens ───────
   fdrGrade's return value becomes a CSS class `fdr-N`. A summed FDR of 8, or
   a summed clean-sheet expectation of 1.4, would paint a cell with a class
   that does not exist — the fixture would render colourless and nobody would
   know why. Grading the per-match mean is what keeps it bounded. */
{
  const hard = cell({ opp: 'ARS', lam: 0.7, cs: 0.10, win: 0.15, fdr: 5, s: { edge: 0.4 } });
  const d = fdrCombine([hard, cell({ opp: 'LIV', lam: 0.8, cs: 0.12, win: 0.18, fdr: 5, s: { edge: 0.5 } })]);
  for (const v of VIEWS) {
    const g = fdrGrade(v, d);
    ok(Number.isInteger(g) && g >= 1 && g <= 5, `${v} grades a double onto 1-5 (got ${g})`);
  }
  /* And the point of the rule: two hard fixtures are still hard. Playing
     Arsenal and Liverpool in one week is not a green cell. */
  ok(fdrGrade('defence', d) >= 4, 'two hard fixtures grade hard on defence, not green for being two');
  ok(fdrGrade('fpl', d) === 5, 'and the official lens keeps calling them a 5');

  /* The mirror case, so this is not just a floor test. */
  const easyA = cell({ opp: 'BUR', lam: 2.3, cs: 0.55, win: 0.62, fdr: 2 });
  const easy = fdrCombine([easyA, cell({ opp: 'SUN', lam: 2.1, cs: 0.52, win: 0.60, fdr: 2 })]);
  eq(fdrGrade('attack', easy), 1, 'two kind fixtures still grade kind on attack');
  eq(fdrGrade('attack', fdrCombine([easyA])), 1, 'as the single does');
}

/* ── the run total is right for the first time ──────────────
   This is the arithmetic the old map got wrong. Two clubs, one with a double
   and one without, and the totals must reflect the fixtures actually played. */
{
  const single = fdrCombine([cell({ lam: 1.4 })]);
  const double = fdrCombine([cell({ lam: 1.4 }), cell({ opp: 'FUL', lam: 1.3 })]);
  eq(fdrRunTotal('attack', [single, single]), '2.80', 'two single gameweeks total their two fixtures');
  eq(fdrRunTotal('attack', [single, double]), '4.10',
    'a gameweek with a double contributes BOTH fixtures to the run total');
  /* The old behaviour, spelled out so the regression is legible: the dropped
     fixture made this read 2.70, understating the run by a whole match. */
  ok(fdrRunTotal('attack', [single, double]) !== '2.70',
    'and not the figure the dropped-fixture map produced');
}

/* ── the label names every fixture ──────────────────────────
   The cell is the only place a double is visible. If the label shows one
   opponent, the fix is invisible to the person it was made for. */
{
  const home = fdrCombine([cell({ opp: 'IPS', home: true })]);
  const away = fdrCombine([cell({ opp: 'IPS', home: false })]);
  eq(fdrOppLabel(home), 'IPS', 'a home single is just the opponent');
  eq(fdrOppLabel(away), 'IPS (a)', 'an away single is marked (a)');
  eq(fdrOppLabel(away, true), 'IPS(a)', 'the tight form drops the space for the narrow strips');

  const d = fdrCombine([cell({ opp: 'IPS', home: false }), cell({ opp: 'FUL', home: true })]);
  eq(fdrOppLabel(d), 'IPS (a) + FUL', 'a double names both, each with its own venue');
  ok(fdrOppLabel(d).includes('FUL'), 'the second fixture is not the one that disappears');
  ok(fdrOppLabel(d).includes('IPS'), 'and neither is the first');
  eq(fdrOppLabel(null), '—', 'a blank gameweek labels as a dash');

  /* Venue is per fixture, not per cell. A club can play away then home in the
     same week, and one (a) covering both would be a false statement about a
     real match. */
  const mixed = fdrCombine([cell({ opp: 'AVL', home: true }), cell({ opp: 'BOU', home: false })]);
  eq(fdrOppLabel(mixed), 'AVL + BOU (a)', 'the (a) attaches to the away leg only');
}

/* ── squad row order ────────────────────────────────────────
   FPL sends picks with `position` 1-15: 1-11 are the XI in formation order,
   12-15 the bench in substitution order. The rows must read the way the
   manager's own team page reads, or the ticker is a different team. */
{
  const els = {};
  for (let i = 1; i <= 15; i++) els[100 + i] = { id: 100 + i, web_name: 'P' + i, team: i, now_cost: 45 + i, element_type: i <= 1 ? 1 : i <= 6 ? 2 : i <= 11 ? 3 : 4 };
  /* Deliberately shuffled, because the API's order is not guaranteed and the
     old club grid never had to care. */
  const picks = [12, 3, 15, 1, 7, 11, 2, 14, 5, 9, 4, 13, 8, 6, 10]
    .map((pos) => ({ element: 100 + pos, position: pos, is_captain: pos === 4, is_vice_captain: pos === 7, multiplier: pos <= 11 ? 1 : 0 }));

  const rows = fdrSquadOrder(picks, els);
  eq(rows.length, 15, 'all fifteen picks become rows');
  eq(rows.map((r) => r.pick.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    'rows come back in the squad order the API states, whatever order it sent them in');
  eq(rows.filter((r) => !r.bench).length, 11, 'eleven rows are the XI');
  eq(rows.filter((r) => r.bench).length, 4, 'four are the bench');
  eq(rows[10].bench, false, 'position 11 is the last of the XI');
  eq(rows[11].bench, true, 'position 12 is the first of the bench');
  eq(rows.filter((r) => r.pick.is_captain).length, 1, 'the captain is carried through');
  eq(rows.find((r) => r.pick.is_captain).el.web_name, 'P4', 'and it is the right player');
  ok(rows.every((r) => r.el && r.el.now_cost), 'every row resolved to an element with a price');

  /* A pick the bootstrap has never heard of is dropped, not rendered as a
     blank row with a price of undefined. This happens for real: a player
     removed from the game mid-season stays in an old picks payload. */
  const withGhost = fdrSquadOrder(picks.concat([{ element: 9999, position: 16 }]), els);
  eq(withGhost.length, 15, 'a pick with no element behind it is dropped rather than drawn empty');
  eq(fdrSquadOrder(null, els), [], 'no picks at all is an empty list, not a throw');
  eq(fdrSquadOrder(picks, null), [], 'and neither is a missing element map');
}

/* ── the saved draft, before any picks exist ────────────────
   The squad rows shipped unusable in the one week they were most wanted.
   They render from loadPicks(mid, b.cur.id), and before the first deadline of
   a season b.cur is GW1 and the FPL API does not publish picks for a
   gameweek whose deadline has not passed — it 404s. The catch swallowed it,
   squadPicks stayed null, and the toggle never appeared. Nothing caught it
   because the mock had GW1 finished and GW2 next, so picks always existed:
   the harness could not have found this, which is the same fault as the mock
   having no double gameweek in it.

   The app already stores the user's own draft under ge-draft-v1, so that is
   the fallback. It is fifteen element IDs and nothing else — no XI, no bench
   order, no captain — so it must NOT be dressed up as a submitted squad. */
{
  const els = {};
  const shape = [1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4];
  shape.forEach((t, i) => { els[200 + i] = { id: 200 + i, web_name: 'D' + i, team: (i % 8) + 1, now_cost: 40 + i, element_type: t }; });
  /* Saved in whatever order the draft builder happened to hold them. */
  const ids = [212, 200, 207, 203, 214, 209, 201, 205, 210, 202, 213, 206, 211, 204, 208];

  const picks = ctx.fdrDraftPicks(ids, els);
  eq(picks.length, 15, 'a saved draft becomes fifteen pseudo-picks');
  eq(picks.map((p) => els[p.element].element_type), [1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4],
    'ordered by position — keepers, defenders, midfielders, forwards');
  eq(picks.map((p) => p.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    'numbered 1-15 so the row builder has something to sort on');
  ok(picks.every((p) => !p.is_captain && !p.is_vice_captain),
    'and NO captain — a draft has not named one, and inventing an armband would be fabricating the plan');

  /* The rule that keeps a draft honest: fifteen drafted players are not an
     XI plus a bench. Claiming the last four are benched would be this app
     telling the user a team-sheet decision they have not made. */
  const rows = fdrSquadOrder(picks, els, false);
  eq(rows.length, 15, 'all fifteen draft rows render');
  eq(rows.filter((r) => r.bench).length, 0, 'none of them is marked benched');
  const submitted = fdrSquadOrder(picks, els, true);
  eq(submitted.filter((r) => r.bench).length, 4,
    'while a real submitted squad still splits eleven and four');
  eq(fdrSquadOrder(picks, els).filter((r) => r.bench).length, 4,
    'and the default stays the submitted behaviour, so nothing already shipped moves');

  /* Ids the bootstrap no longer knows — a draft saved before a player left
     the game. Dropped, not drawn blank, same as a stale pick. */
  eq(ctx.fdrDraftPicks([9999, 200], els).length, 1, 'an unknown draft id is dropped');
  eq(ctx.fdrDraftPicks([], els).length, 0, 'an empty draft is no rows');
  eq(ctx.fdrDraftPicks(null, els).length, 0, 'and a missing one does not throw');
}

/* ── the source itself ──────────────────────────────────────
   The rule above is only worth anything if the map is actually built through
   it. fdrCombine is pure and testable; the loop that feeds it lives inside
   hydrateFixtures and is not, so this asserts against the source that the
   overwriting form is gone. It is a blunt check and it is the only one that
   can see the line that caused the bug. */
{
  ok(!/\[f\.event\]\s*=\s*\{opp:/.test(html),
    'the per-team map no longer assigns a single cell per gameweek (the overwriting form is gone)');
  ok(/fdrCombine\(/.test(html), 'and something calls fdrCombine');
  const fx = html.indexOf('const FX_VIEWS=');
  ok(fx > 0 && !/silently drops the other/.test(html.slice(Math.max(0, fx - 2200), fx)),
    'the FX_VIEWS note no longer claims the grid drops half of a double');
}

console.log(`checks passed ${pass}/${pass + fail.length}`);
fail.forEach((f) => console.log('  FAIL ' + f));
process.exit(fail.length ? 1 : 0);
