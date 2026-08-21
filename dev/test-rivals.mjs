/*
 * Opening a rival's team — the arithmetic behind it.
 *
 * Run: node dev/test-rivals.mjs   (also `npm test`)
 *
 * The Rivals panel already fetched every rival's picks in order to count the
 * shared XI; it just threw the squad away afterwards. Showing it is mostly
 * rendering, and rendering is not what goes wrong here. Two things are:
 *
 * 1. THE MULTIPLIER. A rival's points are not the sum of their players'
 *    points. The captain doubles (triples under a Triple Captain), the bench
 *    scores nothing, and after auto-subs a bench player can score one. All of
 *    that is on the pick as `multiplier`, and reconstructing it from
 *    `is_captain` would be wrong in precisely the gameweeks anyone opens this
 *    panel to look at.
 *
 * 2. THE MISSING ROW. event/{gw}/live carries a row per element, but a player
 *    the feed has not mentioned yet and a player who has scored nothing are
 *    the same number — zero — and completely different facts. Treating the
 *    first as the second produces a total that looks authoritative and is
 *    short. So an unknown is null, never zero, and it is excluded from the
 *    total rather than counted as a blank.
 *
 * The shared/differential split is tested too, because that is the reason
 * this is a RIVALS view rather than a team viewer: the question is not "what
 * did they score" but "what did they have that I did not".
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

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

function extractLine(src, re) {
  const m = src.match(re);
  if (!m) throw new Error('line not found: ' + re);
  return m[0];
}

const ctx = vm.createContext({ console, Date, isNaN, parseFloat, Math });
vm.runInContext([
  extractLine(html, /const CHIP_API_LABEL=\{[^}]*\};/),
  extractLine(html, /const POS_PLURAL=\{[^}]*\};/),
  extractFn(html, 'rivalLivePts'),
  extractFn(html, 'rivalSquadRows'),
  extractFn(html, 'rivalGwTotal'),
  extractFn(html, 'rivalChipSummary'),
  extractFn(html, 'elementExtras')
].join('\n'), ctx);

const { rivalLivePts, rivalSquadRows, rivalGwTotal, rivalChipSummary, elementExtras } = ctx;

let pass = 0; const fail = [];
const ok = (cond, label) => { if (cond) pass++; else fail.push(label); };
const eq = (got, want, label) =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${label} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

/* A legal 15: 2 GK, 5 DEF, 5 MID, 3 FWD, positions 1..15, XI is 1..11. */
const mkPicks = (over = {}) => ({
  picks: Array.from({ length: 15 }, (_, i) => ({
    element: 100 + i,
    position: i + 1,
    multiplier: i < 11 ? 1 : 0,
    is_captain: false,
    is_vice_captain: false,
    ...(over[i + 1] || {})
  }))
});

/* live.elements as the API ships it: an array of {id, stats}. */
const mkLive = (map) => ({ elements: Object.keys(map).map((id) => ({ id: +id, stats: { total_points: map[id] } })) });

const allTwo = () => { const m = {}; for (let i = 0; i < 15; i++) m[100 + i] = 2; return m; };

/* ── the multiplier ───────────────────────────────────────────────── */
{
  const picks = mkPicks({ 3: { multiplier: 2, is_captain: true }, 4: { is_vice_captain: true } });
  const r = rivalSquadRows(picks, mkLive(allTwo()), []);
  eq(r.xi.length, 11, 'eleven in the XI');
  eq(r.bench.length, 4, 'four on the bench');
  /* Ten at 2 plus a captain at 4. Not 22. */
  eq(r.live, 24, 'captain doubles in the total');
  eq(r.xi[2].pts, 4, 'the captain row carries the doubled figure');
  eq(r.xi[2].base, 2, 'and keeps the undoubled figure alongside it');
  ok(r.xi[2].captain === true, 'captain flag survives');
  ok(r.xi[3].vice === true, 'vice flag survives');
}
{
  /* Triple Captain. If the multiplier were inferred from is_captain this
     would read 24 and be four points light in the one week it matters. */
  const picks = mkPicks({ 3: { multiplier: 3, is_captain: true } });
  const r = rivalSquadRows(picks, mkLive(allTwo()), []);
  eq(r.live, 26, 'a tripled captain is tripled, not doubled');
}
{
  /* A benched captain scores nothing. multiplier 0 with is_captain true is a
     real combination and the flag must not override the number. */
  const picks = mkPicks({ 12: { multiplier: 0, is_captain: true } });
  const r = rivalSquadRows(picks, mkLive(allTwo()), []);
  eq(r.live, 22, 'a captain on the bench adds nothing to the XI total');
  ok(r.bench[0].captain === true, 'and is still shown as their captain');
}
{
  /* Auto-subbed bench player: position 12, multiplier 1.

     This assertion used to read "the XI total is the XI" and expected 22.
     That was wrong, and a screenshot of a real rival proved it: totalling
     starters drops whoever actually came on. A substitute who played is worth
     points to them, and the multiplier already says so. */
  const picks = mkPicks({ 12: { multiplier: 1 } });
  const r = rivalSquadRows(picks, mkLive(allTwo()), []);
  eq(r.bench[0].pts, 2, 'an auto-subbed bench player scores');
  eq(r.live, 24, 'and his points are IN the total — eleven at 2 plus the sub at 2');
  eq(r.liveOf, 12, 'twelve players counted, not eleven');
}
{
  /* BENCH BOOST. Every bench player has multiplier 1, so all fifteen score.
     Totalling the XI would have dropped four players' points in the exact
     week a rival spent a chip to get them — which is what the card did, in
     front of a Bench Boost, while the league table beside it disagreed. */
  const picks = mkPicks({ 12: { multiplier: 1 }, 13: { multiplier: 1 },
    14: { multiplier: 1 }, 15: { multiplier: 1 } });
  const r = rivalSquadRows(picks, mkLive(allTwo()), []);
  eq(r.live, 30, 'a bench boost counts all fifteen');
  eq(r.liveOf, 15, 'and says fifteen were counted');
  eq(r.xi.length, 11, 'while the pitch is still the eleven');
  eq(r.bench.length, 4, 'and the bench is still the bench');
}
{
  /* Normal week: bench multiplier 0 contributes nothing, so the same rule
     gives the old answer. The fix must not inflate an ordinary gameweek. */
  const r = rivalSquadRows(mkPicks(), mkLive(allTwo()), []);
  eq(r.live, 22, 'without a chip the bench still adds nothing');
  eq(r.liveOf, 11, 'and only eleven count');
}

/* ── which number is their gameweek score ─────────────────────────
   The reported bug: a rival on nine points showed 0, because FPL leaves
   entry_history.points at 0 until a gameweek finishes and the card believed
   it over its own rows. */
{
  const squad = { live: 9 };
  const running = rivalGwTotal({ points: 0 }, squad, false);
  eq(running.value, 9, 'mid-gameweek, the live sum wins over a zero from FPL');
  ok(running.live === true, 'and it is flagged as a running number');
  ok(/Live total/.test(running.label), 'and labelled as one, not as FPL\u2019s figure');
}
{
  /* Once the gameweek is done FPL's number is the authority — it includes
     auto-subs and bonus we may not have summed. */
  const done = rivalGwTotal({ points: 63 }, { live: 58 }, true);
  eq(done.value, 63, 'a finished gameweek takes the official total');
  ok(done.live === false, 'and is not flagged live');
  ok(/from FPL/.test(done.label), 'and says where it came from');
}
{
  /* A finished gameweek that genuinely scored nothing must still show 0 —
     the fix must not turn "prefer live when running" into "never show 0". */
  eq(rivalGwTotal({ points: 0 }, { live: 0 }, true).value, 0, 'a real zero survives');
}
{
  /* No entry_history at all: fall back rather than render undefined. */
  eq(rivalGwTotal(null, { live: 12 }, true).value, 12, 'missing history falls back to the live sum');
  eq(rivalGwTotal(null, null, false).value, 0, 'and missing everything is 0, not NaN');
}

/* ── the missing row ──────────────────────────────────────────────── */
{
  const m = allTwo();
  delete m[102];                                   /* feed has not mentioned him */
  const r = rivalSquadRows(mkPicks(), mkLive(m), []);
  eq(r.xi[2].base, null, 'an unmentioned player is null, not zero');
  eq(r.xi[2].pts, null, 'and his contribution is unknown, not zero');
  eq(r.live, 20, 'the total sums only what was reported');
  eq(r.liveKnown, 10, 'and says how many rows it had');
  eq(r.liveOf, 11, 'out of how many it wanted');
}
{
  /* A real zero must still count as known, or a blanking player would be
     indistinguishable from a missing one — the same conflation in reverse. */
  const m = allTwo(); m[102] = 0;
  const r = rivalSquadRows(mkPicks(), mkLive(m), []);
  eq(r.xi[2].base, 0, 'a genuine zero is zero');
  eq(r.liveKnown, 11, 'and is counted as known');
}
{
  const r = rivalSquadRows(mkPicks(), null, []);
  eq(r.live, 0, 'no live feed at all totals zero');
  eq(r.liveKnown, 0, 'with nothing claimed as known');
  eq(r.xi[0].base, null, 'and every row unknown');
}
{
  /* The object-keyed shape, in case the feed is ever handed to us pre-indexed. */
  eq(rivalLivePts({ elements: { 7: { stats: { total_points: 9 } } } }, 7), 9, 'object-keyed live is read too');
  eq(rivalLivePts({ elements: [] }, 7), null, 'absent from an empty array is null');
  eq(rivalLivePts(null, 7), null, 'no feed is null');
  eq(rivalLivePts({ elements: [{ id: 7, stats: {} }] }, 7), null, 'a row with no total_points is null, not zero');
}

/* ── shared versus differential ───────────────────────────────────── */
{
  const mine = new Set([100, 101, 102]);
  const r = rivalSquadRows(mkPicks(), mkLive(allTwo()), mine);
  eq(r.shared, 3, 'three shared');
  eq(r.differentials, 8, 'eight differentials');
  ok(r.xi[0].shared === true, 'a shared player is flagged');
  ok(r.xi[3].shared === false, 'a differential is not');
  /* Bench overlap is deliberately not counted: the existing panel says
     "n/11 shared" and this must agree with it rather than quietly differ. */
  eq(r.shared + r.differentials, 11, 'shared plus differential is the XI, not the squad');
}
{
  const r = rivalSquadRows(mkPicks(), mkLive(allTwo()), [100, 101, 102]);
  eq(r.shared, 3, 'a plain array works as well as a Set');
}

/* ── shapes that should not throw ─────────────────────────────────── */
{
  eq(rivalSquadRows(null, null, null).xi.length, 0, 'no picks yields an empty XI rather than an error');
  eq(rivalSquadRows({ picks: [] }, null, null).bench.length, 0, 'empty picks yields an empty bench');
  /* Out-of-order picks: the API sends them ordered, but the panel sorts
     because one out-of-order response would silently reorder the pitch. */
  const shuffled = { picks: mkPicks().picks.slice().reverse() };
  const r = rivalSquadRows(shuffled, mkLive(allTwo()), []);
  eq(r.xi.map((x) => x.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'picks are sorted by position');
}

/* ── chips: what they are spending, and what they have spent ──────── */
{
  const h = { chips: [{ name: 'wildcard', event: 3 }, { name: '3xc', event: 1 }] };
  const r = rivalChipSummary(h, { active_chip: 'bboost' });
  eq(r.active, 'bboost', 'the live chip comes off the picks');
  eq(r.activeLabel, 'Bench Boost', 'and is shown in English, not as an API code');
  eq(r.played.map((c) => c.event), [1, 3], 'history is ordered by gameweek, not by feed order');
  eq(r.played.map((c) => c.label), ['Triple Captain', 'Wildcard'], 'and labelled');
}
{
  /* The two feeds answer different questions and must not be conflated: a
     chip played THIS week is in both, one played in GW3 only in history. */
  const r = rivalChipSummary({ chips: [{ name: 'freehit', event: 7 }] }, { active_chip: 'freehit' });
  eq(r.active, 'freehit', 'active is still reported');
  eq(r.played.length, 1, 'and the same chip appears once in the history, not twice');
}
{
  const r = rivalChipSummary(null, null);
  eq(r.active, null, 'no picks means no active chip');
  eq(r.played, [], 'no history means no played chips');
  eq(r.activeLabel, null, 'and nothing to label');
}
{
  const r = rivalChipSummary({ chips: [{ name: 'wildcard' }] }, { active_chip: 'mystery' });
  eq(r.activeLabel, 'mystery', 'an unknown chip code falls back to the code rather than blanking');
  eq(r.played[0].event, null, 'a chip with no gameweek keeps a null rather than inventing one');
}

/* ── fields the feed sends that the app never read ────────────────── */
const POOL = { elements: Array.from({ length: 7 }, (_, i) => ({ element_type: i < 4 ? 3 : 2 })) };
const find = (rows, label) => rows.find((r) => r.label === label);
{
  const e = { element_type: 3, ep_this: '4.6', value_form: '1.2', starts_per_90: '0.94',
    clean_sheets_per_90: '0.21', threat_rank_type: 2, influence_rank_type: 5,
    now_cost_rank_type: 1, squad_number: 7, birth_date: '2000-01-01' };
  const rows = elementExtras(POOL, e, Date.parse('2026-08-21'));
  eq(find(rows, 'FPL expected points, this GW').value, '4.6', 'ep_this is surfaced');
  ok(/their model/.test(find(rows, 'FPL expected points, this GW').note),
    'and attributed, so it is not mistaken for ours');
  eq(find(rows, 'Starts per 90').value, '0.94', 'the per-90 FPL computes is shown');
  eq(find(rows, 'Threat rank').value, '2 of 4', 'ranks are positional, counted against the real pool');
  ok(/midfielders/.test(find(rows, 'Threat rank').note), 'and say which position');
  eq(find(rows, 'Squad number').value, 7, 'squad number is shown');
  eq(find(rows, 'Age').value, 26, 'birth_date becomes an age, not a date');
  ok(!find(rows, 'Saves per 90'), 'an outfielder gets no saves rate');
}
{
  const e = { element_type: 1, saves_per_90: '3.10', clean_sheets_per_90: '0.40' };
  const rows = elementExtras(POOL, e, Date.parse('2026-08-21'));
  eq(find(rows, 'Saves per 90').value, '3.10', 'a keeper does');
}
{
  /* Absent is absent. A missing field must not become a zero, a dash or an
     empty row — the card should simply not carry it. */
  const rows = elementExtras(POOL, { element_type: 3 }, Date.parse('2026-08-21'));
  eq(rows.length, 0, 'an element with none of these fields yields no rows');
}
{
  const rows = elementExtras(POOL, { element_type: 3, ep_this: '0.0', threat_rank_type: 0 },
    Date.parse('2026-08-21'));
  eq(find(rows, 'FPL expected points, this GW').value, '0.0', 'a genuine zero xP is shown');
  ok(!find(rows, 'Threat rank'), 'but a zero rank is not a rank, so it is omitted');
}
{
  /* The two deliberate omissions. Both are present on the element and must
     stay off the card until their meaning or framing is settled. */
  const e = { element_type: 3, region: 15, price_change_percent: '12.4',
    price_change_projections: [1, 2], birth_date: 'not-a-date' };
  const rows = elementExtras(POOL, e, Date.parse('2026-08-21'));
  ok(!rows.some((r) => /region/i.test(r.label)), 'region is not surfaced — its meaning is unmeasured');
  ok(!rows.some((r) => /price change|projection/i.test(r.label)),
    'projected price changes are not surfaced bare');
  ok(!find(rows, 'Age'), 'an unparseable birth date yields no age rather than NaN');
}
{
  const rows = elementExtras(POOL, { element_type: 3, birth_date: '1900-01-01' },
    Date.parse('2026-08-21'));
  ok(!find(rows, 'Age'), 'an implausible age is dropped rather than printed');
}
eq(elementExtras(null, null, 0), [], 'no element yields no rows rather than throwing');

console.log(`rivals — ${pass}/${pass + fail.length} checks passed`);
if (fail.length) { fail.forEach((f) => console.log('  FAIL  ' + f)); process.exit(1); }
