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
  extractFn(html, 'applyAutoSubs'),
  extractFn(html, 'rivalSquadRows'),
  extractFn(html, 'rivalGwTotal'),
  extractFn(html, 'rivalChipSummary'),
  extractFn(html, 'fplChipWindows'),
  extractFn(html, 'chipStatus'),
  extractFn(html, 'elementExtras')
].join('\n'), ctx);

const { rivalLivePts, applyAutoSubs, rivalSquadRows, rivalGwTotal, rivalChipSummary,
  fplChipWindows, chipStatus, elementExtras } = ctx;

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

/* ── the ring versus the count ─────────────────────────────────────
   A screenshot of the owner's OWN team showed four bench players ringed as
   "theirs only" — players he certainly owns. The ring was comparing the whole
   squad against my ELEVEN, so anyone on a bench was a differential by
   construction. Two questions, two sets: the ring asks whether I own him at
   all, the header asks how much of their XI is in mine. */
{
  const mineXi = new Set([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);
  const mineAll = new Set([...mineXi, 111, 112, 113, 114]);
  const r = rivalSquadRows(mkPicks(), mkLive(allTwo()), mineXi, mineAll);
  ok(r.bench.every((x) => x.shared === true),
    'bench players I own are ringed as owned, not as differentials');
  eq(r.shared, 11, 'and the header still counts XI against XI');
  eq(r.differentials, 0, 'so an identical XI has no differentials');
}
{
  /* A player of theirs who is in my squad but on my bench: I own him, so the
     ring says so, but he is not in my XI, so he is still a differential in
     the header's sense. Both statements are true at once. */
  const mineXi = new Set([200]);
  const mineAll = new Set([200, 100]);
  const r = rivalSquadRows(mkPicks(), mkLive(allTwo()), mineXi, mineAll);
  ok(r.xi[0].shared === true, 'owned-but-benched still rings as owned');
  eq(r.shared, 0, 'and does not count toward the shared XI');
  eq(r.differentials, 11, 'so he is a differential by the header\u2019s measure');
}
{
  /* Omitting the fourth argument must behave exactly as before — one set for
     both questions — so nothing that calls it the old way silently changes. */
  const one = new Set([100, 101]);
  const r = rivalSquadRows(mkPicks(), mkLive(allTwo()), one);
  ok(r.xi[0].shared === true, 'with no squad set, the XI set answers both');
  eq(r.shared, 2, 'and the count is unchanged');
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

/* ── Chip windows ────────────────────────────────────────────────────
   The payload shape below is copied from a real bootstrap-static, measured
   22 Aug 2026: eight rows, one per chip per half. Invented shapes are how a
   parser passes its tests and fails on the live feed. */
const CHIPS_REAL = [
  { id: 1, name: 'wildcard', number: 1, start_event: 2,  stop_event: 19, chip_type: 'transfer' },
  { id: 2, name: 'wildcard', number: 1, start_event: 20, stop_event: 38, chip_type: 'transfer' },
  { id: 3, name: 'freehit',  number: 1, start_event: 2,  stop_event: 19, chip_type: 'transfer' },
  { id: 4, name: 'bboost',   number: 1, start_event: 1,  stop_event: 19, chip_type: 'team' },
  { id: 5, name: '3xc',      number: 1, start_event: 1,  stop_event: 19, chip_type: 'team' },
  { id: 6, name: 'freehit',  number: 1, start_event: 20, stop_event: 38, chip_type: 'transfer' },
  { id: 7, name: 'bboost',   number: 1, start_event: 20, stop_event: 38, chip_type: 'team' },
  { id: 8, name: '3xc',      number: 1, start_event: 20, stop_event: 38, chip_type: 'team' },
];
{
  const w = fplChipWindows({ chips: CHIPS_REAL });
  eq(Object.keys(w).sort(), ['3xc', 'bboost', 'freehit', 'wildcard'], 'four chip names off the real payload');
  eq(w.wildcard, [{ start: 2, stop: 19, type: 'transfer' }, { start: 20, stop: 38, type: 'transfer' }],
     'wildcard carries both halves, in gameweek order');
  eq(w.bboost[0].start, 1, 'bench boost opens in GW1 where the wildcard opens in GW2');

  /* Rows sorted out of order upstream must still come back in order — the
     real payload happens to list freehit's second half after 3xc's first. */
  const shuffled = fplChipWindows({ chips: [...CHIPS_REAL].reverse() });
  eq(shuffled.wildcard.map((x) => x.start), [2, 20], 'windows sort by gameweek regardless of payload order');

  eq(fplChipWindows({}), {}, 'no chips key yields no windows rather than throwing');
  eq(fplChipWindows(null), {}, 'a null payload yields no windows');
  eq(fplChipWindows({ chips: [{ name: 'x', start_event: 9, stop_event: 3 }] }), {},
     'a window that ends before it starts is dropped, not stored inverted');
  eq(fplChipWindows({ chips: [{ name: null, start_event: 1, stop_event: 2 }] }), {},
     'a row with no name is dropped');
  eq(fplChipWindows({ chips: [{ name: 'wildcard', start_event: 'x', stop_event: 19 }] }), {},
     'a non-numeric gameweek is dropped rather than becoming NaN');
}

/* ── Chip status: the two-half rule is the whole point ───────────────── */
{
  const w = fplChipWindows({ chips: CHIPS_REAL });
  const played = [{ name: 'wildcard', event: 5 }];
  const st = chipStatus(played, w, 8);
  const wc = st.filter((x) => x.name === 'wildcard');
  eq(wc.map((x) => x.state), ['played', 'upcoming'],
     'a wildcard played in GW5 spends the FIRST half only — the second is still to come');
  eq(wc[0].event, 5, 'and the played half records the gameweek it went on');

  /* THE FAILURE THIS EXISTS TO PREVENT. Matching on chip NAME alone would
     mark both halves used the moment one was, which is the confident-wrong
     number the old card refused to print. */
  ok(wc[1].state !== 'played', 'the second wildcard is NOT marked played by the first');

  const late = chipStatus(played, w, 25);
  const wcLate = late.filter((x) => x.name === 'wildcard');
  eq(wcLate.map((x) => x.state), ['played', 'available'],
     'past GW20 the second wildcard becomes available, the first stays spent');

  const none = chipStatus([], w, 25);
  eq(none.filter((x) => x.name === 'wildcard').map((x) => x.state), ['expired', 'available'],
     'an unplayed first-half chip EXPIRES at GW20 rather than staying available');

  const noGw = chipStatus([], w, null);
  ok(noGw.every((x) => x.state === 'unknown'),
     'with no gameweek the state is unknown, not guessed as available');

  eq(chipStatus([{ name: 'wildcard', event: 25 }], w, 30)
      .filter((x) => x.name === 'wildcard').map((x) => x.state), ['expired', 'played'],
     'a wildcard played in GW25 spends the SECOND half, not the first');

  ok(st.every((x, i, a) => i === 0 || a[i - 1].start <= x.start), 'rows come back in gameweek order');
  ok(st.every((x) => typeof x.label === 'string' && x.label.length),
     'every row carries a human label, not the API code');
}

/* ── rivalChipSummary: silence when the windows are unknown ─────────── */
{
  const hist = { chips: [{ name: 'wildcard', event: 5 }] };
  const w = fplChipWindows({ chips: CHIPS_REAL });

  const withW = rivalChipSummary(hist, { active_chip: null }, w, 8);
  ok(Array.isArray(withW.status) && withW.status.length === 8, 'with windows, every chip half is reported');
  ok(withW.remaining.length === 7, 'seven halves remain after one wildcard is spent');

  /* An absent chips[] must not produce an empty "nothing left" list, and must
     not produce an "all available" one either. It reverts to the honest blank
     the card showed before any of this was derivable. */
  const noW = rivalChipSummary(hist, { active_chip: null }, {}, 8);
  ok(noW.status === null, 'no windows means no claim about what is left');
  ok(noW.remaining === null, 'and no remaining list to render');
  eq(noW.played.map((c) => c.event), [5], 'while what was PLAYED is still reported — that part is a fact');

  const undef = rivalChipSummary(hist, { active_chip: null });
  ok(undef.status === null, 'called the old way, with no windows argument, it behaves the old way');
}

/* ── Auto-subs: the field that was read nowhere ──────────────────────
   A starter who does not play is replaced by a bench player and the SUB's
   points count. We read multiplier off the picks, so an auto-subbed squad
   was summed as if the absent player had played and the sub had not. */
{
  /* 11 starters (positions 1-11) and 4 bench (12-15). Player 5 blanks,
     player 12 comes on. Live points make the swap visible: the absent player
     is worth 0, the sub is worth 9. */
  const mkPicks = (subs, mutate) => {
    const picks = [];
    for (let i = 1; i <= 15; i++) {
      picks.push({ element: 100 + i, position: i, multiplier: i <= 11 ? 1 : 0,
        is_captain: i === 1, is_vice_captain: i === 2 });
    }
    if (mutate) mutate(picks);
    return { picks, automatic_subs: subs || [] };
  };
  const live = { elements: [] };
  for (let i = 1; i <= 15; i++) live.elements.push({ id: 100 + i, stats: { total_points: i === 5 ? 0 : (i === 12 ? 9 : 2) } });

  const none = rivalSquadRows(mkPicks([]), live, new Set(), new Set());
  /* 10 starters at 2 plus the blanker at 0 = 20. */
  eq(none.live, 20, 'without auto-subs the XI sums as submitted');
  eq(none.autoSubs, 0, 'and reports no substitutions');

  const withSub = rivalSquadRows(
    mkPicks([{ element_out: 105, element_in: 112 }]), live, new Set(), new Set());
  eq(withSub.live, 29, 'the substitute’s 9 points count and the absent player’s 0 does not');
  eq(withSub.autoSubs, 1, 'and the card is told one substitution was applied');
  /* THE SUM ALONE CANNOT SEE THIS. The absent player scores 0, so leaving him
     counting changes no total — mutation testing found that removing his
     benching was undetectable. Count the counting players instead: eleven
     score, not twelve. */
  eq(withSub.liveOf, 11, 'exactly eleven players count after the swap, not twelve');
  ok(withSub.xi.every((r) => r.id !== 105), 'the absent player is off the XI entirely');
  ok(withSub.bench.some((r) => r.id === 105), 'and is on the bench, where the reader can see him');

  /* THE CASE THAT WOULD BE WORSE THAN THE BUG. If FPL has already rewritten
     the picks — starter benched, sub counting — applying the swap again
     would bench the substitute and restore the player who never played.
     I could not verify which way FPL reports it, so this is the guard that
     makes the fix correct under either answer. */
  const already = mkPicks([{ element_out: 105, element_in: 112 }], (p) => {
    p[4].multiplier = 0; p[4].position = 12;
    p[11].multiplier = 1; p[11].position = 5;
  });
  const done = rivalSquadRows(already, live, new Set(), new Set());
  eq(done.live, 29, 'an already-applied swap is NOT applied twice');
  eq(done.autoSubs, 0, 'and is not reported as something we did');

  /* Substitutes are never captained. Transferring a captain’s multiplier to
     the incoming player would double a score he never had. */
  const capOut = rivalSquadRows(
    mkPicks([{ element_out: 101, element_in: 112 }], (p) => { p[0].multiplier = 2; }),
    live, new Set(), new Set());
  const sub = capOut.xi.find((r) => r.id === 112);
  ok(sub && sub.mult === 1, 'an incoming substitute comes on at 1x, not the captain’s multiplier');

  /* Structural safety. */
  const before = mkPicks([{ element_out: 105, element_in: 112 }]);
  const snapshot = JSON.stringify(before);
  applyAutoSubs(before);
  ok(JSON.stringify(before) === snapshot, 'the original picks object is not mutated');

  eq(applyAutoSubs({ picks: [], automatic_subs: [] }).autoSubsApplied, undefined,
     'no subs leaves the payload untouched');
  ok(applyAutoSubs(null) === null, 'a null payload does not throw');
  eq(rivalSquadRows(mkPicks([{ element_out: 999, element_in: 112 }]), live, new Set(), new Set()).autoSubs, 0,
     'a substitution naming a player who is not in the squad is ignored');
  eq(rivalSquadRows(mkPicks([{ element_out: 105, element_in: 105 }]), live, new Set(), new Set()).autoSubs, 0,
     'a substitution of a player for himself is ignored');
  eq(rivalSquadRows({ picks: [], automatic_subs: 'nope' }, live, new Set(), new Set()).autoSubs, 0,
     'a string automatic_subs is ignored rather than throwing');
  /* A string happens to degrade safely — for..of walks its characters and
     finds no matching players. A non-iterable OBJECT does not: that is where
     the Array.isArray guard actually earns its place, and the string case
     alone left the guard untested. */
  let threw = false;
  try { rivalSquadRows(mkPicks(null, null), live, new Set(), new Set()); } catch (_) { threw = true; }
  ok(!threw, 'a null automatic_subs does not throw');
  threw = false;
  try {
    rivalSquadRows({ picks: [], automatic_subs: { element_out: 105 } }, live, new Set(), new Set());
  } catch (_) { threw = true; }
  ok(!threw, 'a non-iterable object automatic_subs does not throw');

  /* Two subs in one gameweek is normal and both must land. */
  const two = rivalSquadRows(
    mkPicks([{ element_out: 105, element_in: 112 }, { element_out: 106, element_in: 113 }]),
    live, new Set(), new Set());
  eq(two.autoSubs, 2, 'two substitutions both apply');
}

console.log(`rivals — ${pass}/${pass + fail.length} checks passed`);
if (fail.length) { fail.forEach((f) => console.log('  FAIL  ' + f)); process.exit(1); }
