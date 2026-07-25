/*
 * Offline tests for the three scouting features added from the creator-graphic
 * review: the multi-gameweek captain planner, the DefCon price brackets, and
 * the value board (fair price vs actual price).
 *
 * Each is a pure function of a bootstrap plus fixtures, so we stub the model
 * layer (buildHorizon / fixtureXP) with controlled values. That makes the
 * ranking, double-gameweek summing, bracket splitting and positional
 * benchmarking deterministic and independent of the match model, which
 * test-core already covers.
 *
 * Run: node dev/test-scouting.mjs   (wired into npm test)
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
const grabConst = (n) => {
  const i = html.indexOf('const ' + n + '=');
  const end = html.indexOf('\n', i);
  return html.slice(i, end);
};

let failures = 0, passes = 0;
const ok = (c, label) => { if (c) passes++; else { failures++; console.error('  ✗ ' + label); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

/* ── 1. Captain planner ───────────────────────────────────────────────── */
console.log('• captainPlan: best armband per upcoming gameweek');
{
  /* Horizon: team 1 plays GW1 and GW2 (with a DOUBLE in GW2), team 2 plays
     GW1 only (blanks GW2), team 3 plays GW2 only (blanks GW1). */
  const HZ = {
    1: [{ event: 1 }, { event: 2 }, { event: 2 }],
    2: [{ event: 1 }],
    3: [{ event: 2 }],
  };
  /* Each fixture is worth the player's own `rate`, so a double doubles it. */
  const captainPlan = new Function(
    'function buildHorizon(){return ' + JSON.stringify(HZ) + ';}\n' +
    'function fixtureXP(b,el,fx){return el.rate;}\n' +
    grabFn('captainEligible') + '\n' +
    grabFn('captainPlan') + '\nreturn captainPlan;'
  )();

  const el = (id, team, rate, extra) => Object.assign(
    { id, team, rate, element_type: 4, status: 'a', chance_of_playing_next_round: null, web_name: 'p' + id }, extra || {});
  const b = {
    elements: [
      el(1, 1, 3.0),          // team 1: doubles in GW2 -> 6.0 there
      el(2, 2, 5.0),          // team 2: best single in GW1, blanks GW2
      el(3, 3, 4.0),          // team 3: blanks GW1
      el(4, 1, 1.0),
      el(5, 1, 0.9, { element_type: 2 }),                       // DEF -> ineligible
      el(6, 1, 9.9, { status: 'i' }),                           // injured -> ineligible
      el(7, 1, 9.8, { chance_of_playing_next_round: 25 }),      // doubtful -> ineligible
    ],
  };
  const plan = captainPlan(b, [], 7);

  ok(plan.length === 2, 'covers both gameweeks in the horizon');
  ok(plan[0].gw === 1 && plan[1].gw === 2, 'gameweeks come back in order');

  const gw1 = plan[0].picks;
  ok(gw1[0].el.id === 2, 'GW1 top pick is the best single-fixture score');
  ok(near(gw1[0].xp, 5.0), 'GW1 top xP is the single fixture value');
  ok(!gw1.some(p => p.el.team === 3), 'a club that blanks is absent from that gameweek');
  ok(gw1.every(p => p.legs === 1), 'GW1 legs count is one');

  const gw2 = plan[1].picks;
  ok(gw2[0].el.id === 1, 'GW2 top pick is the doubler, not the higher single rate');
  ok(near(gw2[0].xp, 6.0), 'a double gameweek sums both legs');
  ok(gw2[0].legs === 2, 'the double is tagged with two legs');
  ok(!gw2.some(p => p.el.team === 2), 'the blanking club drops out of GW2');

  ok(plan.every(r => r.picks.length <= 3), 'never returns more than three picks');
  ok(!plan.some(r => r.picks.some(p => [5, 6, 7].includes(p.el.id))),
    'defenders, injured and doubtful players are all filtered out');

  /* N caps the number of gameweeks, not just the fixtures per club. */
  ok(captainPlan(b, [], 1).length === 1, 'N caps the gameweeks returned');
  /* No fixtures at all -> empty, so the card hides pre-season. */
  const empty = new Function(
    'function buildHorizon(){return {};}\n' +
    'function fixtureXP(){return 1;}\n' +
    grabFn('captainEligible') + '\n' +
    grabFn('captainPlan') + '\nreturn captainPlan;')();
  ok(empty(b, [], 7).length === 0, 'no fixtures published yields an empty plan');
}

/* ── 2. DefCon price brackets ─────────────────────────────────────────── */
console.log('• dcByBracket: best defensive returner at each price point');
{
  const mk = new Function(
    grabFn('dcRate90') + '\n' + grabFn('dcThreshold') + '\n' + grabFn('dcReal') + '\n' +
    grabFn('dcHitRate') + '\n' + grabFn('dcHitLabel') + '\n' + grabFn('dcPerStartLabel') + '\n' +
    grabConst('DC_BRACKETS') + '\n' + grabFn('dcByBracket') + '\n' +
    'return {dcByBracket,dcHitRate,dcHitLabel,dcReal,dcPerStartLabel,dcRate90};'
  )();

  const d = (id, cost, dc90, extra) => Object.assign({
    id, now_cost: cost, element_type: 2, status: 'a', minutes: 900,
    defensive_contribution_per_90: dc90, web_name: 'd' + id,
  }, extra || {});

  const els = [
    d(1, 65, 14), d(2, 62, 9),                    // 6.0m+ band
    d(3, 55, 13), d(4, 58, 8),                    // 5.5m band
    d(5, 50, 12),                                 // 5.0m band
    d(6, 45, 11),                                 // 4.5m band
    d(7, 40, 15),                                 // 4.0m band
    d(8, 44, 20, { minutes: 90 }),                // too few minutes
    d(9, 44, 20, { status: 'u' }),                // left the club
    d(10, 44, 20, { element_type: 3 }),           // midfielder, not a defender
    d(11, 44, 0),                                 // no defensive rate at all
  ];
  const groups = mk.dcByBracket(els);
  const byLabel = Object.fromEntries(groups.map(g => [g.label, g.players.map(p => p.id)]));

  ok(groups.length === 5, 'all five price bands are populated');
  ok(byLabel['£6.0m+'][0] === 1, '6.0m+ band is led by the higher hit rate');
  ok(byLabel['£5.5m'].join() === '3,4', '5.5m band splits on price correctly');
  ok(byLabel['£5.0m'].join() === '5', 'a 5.0m defender lands in the 5.0m band');
  ok(byLabel['£4.5m'].join() === '6', 'a 4.5m defender lands in the 4.5m band');
  ok(byLabel['£4.0m'].join() === '7', 'anything under 4.5m lands in the bottom band');

  const all = groups.flatMap(g => g.players.map(p => p.id));
  ok(!all.includes(8), 'low-minutes players are excluded');
  ok(!all.includes(9), 'players who left the club are excluded');
  ok(!all.includes(10), 'midfielders are excluded from a defender board');
  ok(!all.includes(11), 'players with no defensive rate are excluded');
  ok(groups.every(g => g.players.length <= 5), 'each band is capped at five');

  /* Bands must not overlap: every player appears exactly once. */
  ok(new Set(all).size === all.length, 'price bands are mutually exclusive');

  /* Hit rate: real per-match data wins over the estimate, and is labelled
     without a tilde; the estimate keeps its tilde so it never reads as fact. */
  const real = d(20, 50, 5, { _ci: { dcs: 10, dchr: 0.7, dcps: 11.2 } });
  ok(mk.dcReal(real), 'a large enough Core Insights sample counts as real');
  ok(near(mk.dcHitRate(real), 0.7), 'real hit rate is used verbatim');
  ok(mk.dcHitLabel(real) === '70%', 'a real rate is labelled without a tilde');
  ok(mk.dcPerStartLabel(real) === '11.2', 'per-start comes from the real sample');

  const thin = d(21, 50, 5, { _ci: { dcs: 2, dchr: 0.9 } });
  ok(!mk.dcReal(thin), 'a thin sample does not count as real');
  ok(mk.dcHitLabel(thin).startsWith('~'), 'an estimated rate is prefixed with a tilde');

  /* The estimate must be monotonic in the per-90 rate and sit either side of
     the positional threshold (DEF 10, MID/FWD 12). */
  ok(mk.dcHitRate(d(22, 50, 14)) > mk.dcHitRate(d(23, 50, 6)), 'estimate rises with the per-90 rate');
  ok(near(mk.dcHitRate(d(24, 50, 10)), 0.5), 'a defender exactly on 10 estimates at 50%');
  const mid = { element_type: 3, minutes: 900, defensive_contribution_per_90: 12 };
  ok(near(mk.dcHitRate(mid), 0.5), 'a midfielder exactly on 12 estimates at 50%');

  /* Falls back to season total over minutes when the per-90 field is absent. */
  ok(near(mk.dcRate90({ defensive_contribution: 10, minutes: 90 }), 10),
    'per-90 falls back to the season total over minutes');
}

/* ── 3. Value board ───────────────────────────────────────────────────── */
console.log('• valueBoard: fair price vs actual, benchmarked per position');
{
  /* Every club has one fixture; each player scores their own `rate`. */
  const HZ = { 1: [{ event: 1 }] };
  const valueBoard = new Function(
    'function buildHorizon(){return ' + JSON.stringify(HZ) + ';}\n' +
    'function fixtureXP(b,el,fx){return el.rate;}\n' +
    grabFn('valueBoard') + '\nreturn valueBoard;'
  )();

  /* Three forwards priced 5/10/15 all returning 1 point per 1.0m except the
     middle one, which is the median and therefore defines the fair rate. */
  const p = (id, type, cost, rate) => ({
    id, element_type: type, now_cost: cost, team: 1, status: 'a', rate, web_name: 'p' + id,
  });
  const rows = valueBoard({
    elements: [
      p(1, 4, 50, 10),    // 2.0 xP per £m -> underpriced vs a 1.0 median
      p(2, 4, 100, 10),   // 1.0 -> the median forward, so fair == price
      p(3, 4, 150, 10),   // 0.667 -> overpriced
      p(4, 1, 50, 99),    // goalkeeper: outfield only, must be dropped
      p(5, 4, 50, 0),     // no projection at all, dropped
    ],
  }, [], 6);

  ok(rows.length === 3, 'goalkeepers and zero-projection players are excluded');
  ok(!rows.some(r => r.el.id === 4), 'goalkeepers are outside the outfield board');

  const by = Object.fromEntries(rows.map(r => [r.el.id, r]));
  ok(near(by[2].delta, 0), 'the median player is priced exactly fairly');
  ok(near(by[2].fair, 10), 'fair price for the median equals its actual price');
  ok(by[1].delta < 0, 'the high-output cheap player reads as underpriced');
  ok(by[3].delta > 0, 'the low-output expensive player reads as overpriced');
  ok(near(by[1].fair, 10) && near(by[1].price, 5), 'fair price uses the positional median rate');
  ok(near(by[1].delta, -5), 'the gap is actual price minus fair price');
  ok(near(by[3].delta, 5), 'overpriced gap is symmetric in this setup');

  ok(rows[0].el.id === 1 && rows[rows.length - 1].el.id === 3,
    'sorted from most underpriced to most overpriced');

  /* Positions are benchmarked SEPARATELY: a defender scoring less per pound
     than a forward must not be branded overpriced just for being a defender. */
  const mixed = valueBoard({
    elements: [
      p(1, 4, 100, 20), p(2, 4, 100, 20), p(3, 4, 100, 20),   // forwards: 2.0 per £m
      p(4, 2, 100, 5), p(5, 2, 100, 5), p(6, 2, 100, 5),      // defenders: 0.5 per £m
    ],
  }, [], 6);
  ok(mixed.every(r => near(r.delta, 0)),
    'every player at their own positional median is priced fairly, across positions');
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
