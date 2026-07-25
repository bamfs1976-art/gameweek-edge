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

/* ── 4. Return consistency ────────────────────────────────────────────── */
console.log('• consistency: return spread when a player actually plays');
{
  const consistency = new Function(grabFn('consistency') + '\nreturn consistency;')();
  const h = (total_points, minutes = 90) => ({ total_points, minutes });

  /* A flat 5 every week has no spread at all. */
  const flat = consistency([h(5), h(5), h(5), h(5), h(5), h(5)]);
  ok(near(flat.ppg, 5), 'a flat return line averages its own value');
  ok(near(flat.sd, 0), 'no variation gives a zero standard deviation');
  ok(near(flat.cv, 0), 'coefficient of variation is zero when the spread is');
  ok(flat.profile === 'steady', 'a flat line is classified steady');
  ok(flat.haulRate === 0 && flat.blankRate === 0, 'no hauls and no blanks on a flat 5');

  /* Same mean, wildly different shape: four blanks then two 15s. */
  const spiky = consistency([h(0), h(0), h(0), h(0), h(15), h(15)]);
  ok(near(spiky.ppg, 5), 'the spiky line has the same mean as the flat one');
  ok(spiky.sd > flat.sd, 'the spiky line has a larger spread on identical PPG');
  ok(spiky.profile === 'explosive', 'a blank-or-haul line is classified explosive');
  ok(near(spiky.haulRate, 2 / 6), 'haul rate counts returns of 10 or more');
  ok(near(spiky.blankRate, 4 / 6), 'blank rate counts returns of 2 or fewer');

  /* Population SD, checked against a hand-computed case: mean 5,
     deviations -5,-5,-5,-5,10,10 -> variance (4*25 + 2*100)/6 = 50. */
  ok(near(spiky.sd, Math.sqrt(50)), 'standard deviation matches the hand calculation');
  ok(near(spiky.cv, Math.sqrt(50) / 5), 'cv is the spread over the mean');

  /* Blanked appearances count; DID-NOT-PLAY weeks must not, or a benched
     player would look falsely volatile when the issue is minutes. */
  const withDnps = consistency([h(5), h(5), h(5), h(5), h(0, 0), h(0, 0), h(0, 0)]);
  ok(withDnps.n === 4, 'zero-minute gameweeks are excluded from the sample');
  ok(near(withDnps.ppg, 5), 'excluding DNPs leaves the appearance average intact');
  ok(near(withDnps.sd, 0), 'DNPs do not manufacture a spread');

  /* A cameo that returns nothing IS a blank, because he played. */
  const cameo = consistency([h(5), h(5), h(5), h(1, 12)]);
  ok(cameo.n === 4, 'a short cameo still counts as an appearance');
  ok(cameo.blanks === 1, 'a scoreless cameo counts as a blank');

  /* Thin samples must refuse to answer rather than guess. */
  ok(consistency([h(5), h(5), h(5)]) === null, 'fewer than four appearances returns null');
  ok(consistency([]) === null, 'an empty history returns null');
  ok(consistency(null) === null, 'a missing history returns null');
  ok(consistency([h(9, 0), h(9, 0), h(9, 0), h(9, 0), h(9, 0)]) === null,
    'a history of DNPs only returns null');

  /* The window argument takes the most RECENT appearances. */
  const recent = consistency([h(0), h(0), h(0), h(0), h(6), h(6), h(6), h(6)], 4);
  ok(recent.n === 4 && near(recent.ppg, 6), 'the window slices the latest appearances');

  /* Classification boundaries: cv <= 0.6 steady, >= 1.0 explosive. */
  ok(consistency([h(10), h(10), h(10), h(4)]).profile === 'steady', 'a tight spread reads steady');
  ok(['balanced', 'explosive'].includes(consistency([h(12), h(2), h(8), h(1)]).profile),
    'a mixed line is not classified steady');

  /* A zero-scoring line must not divide by zero into a bogus profile. */
  const allZero = consistency([h(0), h(0), h(0), h(0)]);
  ok(allZero.cv === 0 && allZero.profile === 'steady', 'an all-zero line has a defined profile');
}

/* ── 5. Price ladder ──────────────────────────────────────────────────── */
console.log('• priceLadder: strongest option at each half-million band');
{
  const HZ = { 1: [{ event: 1 }], 2: [{ event: 1 }] };
  const priceLadder = new Function(
    'function buildHorizon(){return ' + JSON.stringify(HZ) + ';}\n' +
    'function fixtureXP(b,el,fx){return el.rate;}\n' +
    'const money=c=>"£"+(c/10).toFixed(1);\n' +
    grabFn('priceLadder') + '\nreturn priceLadder;'
  )();

  const p = (id, cost, rate, extra) => Object.assign(
    { id, now_cost: cost, element_type: 2, team: 1, status: 'a', rate, web_name: 'p' + id }, extra || {});

  const ladder = priceLadder({
    elements: [
      p(1, 45, 3), p(2, 47, 5), p(3, 49, 1), p(4, 44, 9),   // 4.5 band: 45,47,49 (44 is 4.0)
      p(5, 50, 4), p(6, 54, 2),                             // 5.0 band
      p(7, 60, 7),                                          // 6.0 band
      p(8, 50, 9, { element_type: 3 }),                     // wrong position
      p(9, 50, 9, { status: 'u' }),                         // left the club
      p(10, 50, 0),                                         // no projection
      p(11, 50, 9, { team: 3 }),                            // club has no fixtures
    ],
  }, [], 2, 2, 6);   // perBand 2, so the three-deep 4.5 band proves the cap

  const byLabel = Object.fromEntries(ladder.map(g => [g.label, g.players.map(x => x.el.id)]));
  ok(ladder.map(g => g.label).join() === '£6.0,£5.0,£4.5,£4.0',
    'bands come back most expensive first, and only where players exist');
  ok(byLabel['£4.5'].join() === '2,1', 'a band is ranked by projection and capped at perBand');
  ok(byLabel['£4.5'].length === 2, 'perBand caps the picks per band');
  ok(byLabel['£4.0'].join() === '4', 'a 4.4m player falls into the 4.0 band, not 4.5');
  ok(byLabel['£5.0'].join() === '5,6', '5.0 to 5.4 group into one half-million band');
  ok(byLabel['£6.0'].join() === '7', 'the top band holds the 6.0m player');

  const all = ladder.flatMap(g => g.players.map(x => x.el.id));
  ok(!all.includes(8), 'other positions are excluded');
  ok(!all.includes(9), 'players who left the club are excluded');
  ok(!all.includes(10), 'players with no projection are excluded');
  ok(!all.includes(11), 'players whose club has no fixtures are excluded');
  ok(new Set(all).size === all.length, 'price bands are mutually exclusive');

  /* Band boundaries: 4.9 must stay in 4.5, 5.0 must start a new band. */
  const edge = priceLadder({ elements: [p(1, 49, 1), p(2, 50, 1)] }, [], 2, 3, 6);
  ok(edge.length === 2, 'a half-million boundary splits into two bands');
  ok(edge[0].label === '£5.0' && edge[1].label === '£4.5', 'the boundary lands on the right side');

  /* No fixtures published at all -> empty, so the card hides pre-season. */
  const none = new Function(
    'function buildHorizon(){return {};}\nfunction fixtureXP(){return 1;}\n' +
    'const money=c=>"£"+(c/10).toFixed(1);\n' +
    grabFn('priceLadder') + '\nreturn priceLadder;')();
  ok(none({ elements: [p(1, 45, 3)] }, [], 2, 3, 6).length === 0,
    'no fixtures published yields an empty ladder');
}

/* ── Baseline BPS ─────────────────────────────────────────────────────
   Strips the BPS awarded for goals, assists, clean sheets, saves, penalties
   and cards out of a season total, leaving what a player banks from open
   play. Every count subtracted is exact, so the arithmetic must be exact —
   this metric ends up on public graphics. */
console.log('• baselineBps: BPS left once the returns are stripped out');
{
  /* BPS_TARIFF spans several lines, so pull it with the brace matcher rather
     than the single-line const grabber. */
  const tariffSrc = extractBlock(html, html.indexOf('const BPS_TARIFF='));
  const B = new Function(
    tariffSrc + '\n' + grabFn('bpsFromReturns') + '\n' + grabFn('baselineBps') + '\n' +
    grabFn('baselineBps90') + '\n' + grabFn('bonusPerStart') + '\n' + grabFn('bpsLeaders') + '\n' +
    'return {BPS_TARIFF,bpsFromReturns,baselineBps,baselineBps90,bonusPerStart,bpsLeaders};'
  )();

  const p = (o) => Object.assign({
    id: 1, element_type: 3, minutes: 900, starts: 10, bps: 0, bonus: 0,
    goals_scored: 0, assists: 0, clean_sheets: 0, saves: 0, penalties_saved: 0,
    penalties_missed: 0, own_goals: 0, yellow_cards: 0, red_cards: 0, status: 'a',
  }, o);

  ok(B.bpsFromReturns(p({})) === 0, 'a player with no returns has no return BPS');
  ok(B.bpsFromReturns(p({ element_type: 4, goals_scored: 2 })) === 48, 'a forward goal is 24 BPS');
  ok(B.bpsFromReturns(p({ element_type: 3, goals_scored: 2 })) === 36, 'a midfielder goal is 18 BPS');
  ok(B.bpsFromReturns(p({ element_type: 2, goals_scored: 2 })) === 24, 'a defender goal is 12 BPS');
  ok(B.bpsFromReturns(p({ assists: 3 })) === 27, 'an assist is 9 BPS');
  ok(B.bpsFromReturns(p({ element_type: 2, clean_sheets: 4 })) === 48, 'a defender clean sheet is 12 BPS');
  ok(B.bpsFromReturns(p({ element_type: 3, clean_sheets: 4 })) === 0, 'a midfielder clean sheet earns no BPS');
  ok(B.bpsFromReturns(p({ element_type: 1, saves: 10 })) === 6, 'saves score 2 BPS per completed three');
  ok(B.bpsFromReturns(p({ element_type: 1, saves: 2 })) === 0, 'a part-completed set of saves scores nothing');
  ok(B.bpsFromReturns(p({ yellow_cards: 2 })) === -6, 'a yellow card costs 3 BPS');
  ok(B.bpsFromReturns(p({ red_cards: 1 })) === -9, 'a red card costs 9 BPS');
  ok(B.bpsFromReturns(p({ own_goals: 1 })) === -6, 'an own goal costs 6 BPS');

  /* The headline decomposition: baseline is the remainder, exactly. */
  const mid = p({ element_type: 3, bps: 400, goals_scored: 5, assists: 6, yellow_cards: 3 });
  const ret = 5 * 18 + 6 * 9 + 3 * -3;            // 90 + 54 - 9 = 135
  ok(B.bpsFromReturns(mid) === ret, 'return BPS sums every component (' + ret + ')');
  ok(B.baselineBps(mid) === 400 - ret, 'baseline is the season total minus the returns');
  ok(near(B.baselineBps90(mid), (400 - ret) * 90 / 900), 'per 90 scales by minutes');

  /* Two players on identical BPS but different return mixes must separate —
     that is the entire point of the metric. */
  const grinder = p({ element_type: 3, bps: 300, goals_scored: 0, assists: 0 });
  const scorer = p({ element_type: 3, bps: 300, goals_scored: 8, assists: 4 });
  ok(B.baselineBps(grinder) > B.baselineBps(scorer),
    'on equal BPS, the player who did not return has the higher baseline');

  /* Guards: never negative, never divide by zero, never crash on a stub. */
  ok(B.baselineBps(p({ bps: 10, element_type: 4, goals_scored: 5 })) === 0,
    'baseline clamps at zero rather than going negative');
  ok(B.baselineBps90(p({ minutes: 0, bps: 50 })) === 0, 'no minutes means no per-90');
  ok(B.baselineBps(null) === 0 && B.baselineBps90({}) === 0, 'missing input is handled');
  ok(B.bpsFromReturns(null) === 0, 'null player has no return BPS');
  ok(B.bonusPerStart(p({ bonus: 12, starts: 8 })) === 1.5, 'bonus per start divides by starts');
  ok(B.bonusPerStart(p({ bonus: 5, starts: 0 })) === 0, 'no starts means no bonus per start');

  /* Missing fields must read as zero, not NaN — bootstrap omits fields for
     players who have never recorded that action. */
  const bare = { id: 9, element_type: 2, minutes: 900, bps: 200 };
  ok(B.bpsFromReturns(bare) === 0, 'absent counts are treated as zero');
  ok(B.baselineBps(bare) === 200 && isFinite(B.baselineBps90(bare)),
    'a player with only bps and minutes still computes');

  /* Leaderboard: minutes gate, ordering, and exclusion of departed players. */
  const pool = [
    p({ id: 1, bps: 300, minutes: 900 }),
    p({ id: 2, bps: 600, minutes: 900 }),
    p({ id: 3, bps: 900, minutes: 200 }),              // below the minutes gate
    p({ id: 4, bps: 900, minutes: 900, status: 'u' }), // left the club
    p({ id: 5, bps: 0, minutes: 900 }),                // no BPS at all
  ];
  const lead = B.bpsLeaders(pool, 450, 10);
  ok(lead.map(r => r.el.id).join() === '2,1', 'leaders are gated, ranked and filtered');
  ok(lead[0].b90 > lead[1].b90, 'sorted by baseline per 90, descending');
  ok(B.bpsLeaders(pool, 450, 1).length === 1, 'the result count is capped');
}

/* ── Club bonus leaders ───────────────────────────────────────────────
   Answers which player at a club actually banks the bonus. Ordering matters
   in two places at once — players within a club, and clubs against each
   other — so both are pinned down here. */
console.log('• clubBonusLeaders: who banks the bonus at each club');
{
  const tariffSrc = extractBlock(html, html.indexOf('const BPS_TARIFF='));
  const C = new Function(
    tariffSrc + '\n' + grabFn('bpsFromReturns') + '\n' + grabFn('baselineBps') + '\n' +
    grabFn('baselineBps90') + '\n' + grabFn('bonusPerStart') + '\n' +
    grabFn('clubBonusLeaders') + '\nreturn clubBonusLeaders;'
  )();
  const p = (id, team, bonus, o) => Object.assign({
    id, team, bonus, element_type: 3, minutes: 900, starts: 10, bps: 300,
    goals_scored: 0, assists: 0, clean_sheets: 0, saves: 0, status: 'a',
  }, o || {});

  const els = [
    p(1, 1, 20), p(2, 1, 30), p(3, 1, 10), p(4, 1, 5),   // club 1 total 65
    p(5, 2, 40), p(6, 2, 4),                             // club 2 total 44
    p(7, 3, 9),                                          // club 3 total 9
    p(8, 3, 99, { minutes: 100 }),                       // below the minutes gate
    p(9, 3, 99, { status: 'u' }),                        // left the club
  ];
  const g = C(els, 3, 270);

  ok(g.map(x => x.team).join() === '1,2,3', 'clubs ordered by total squad bonus');
  ok(g[0].total === 65, 'club total sums every qualifying player, not just the top three');
  ok(g[0].players.map(x => x.el.id).join() === '2,1,3', 'players ranked by bonus within a club');
  ok(g[0].players.length === 3, 'only the top three per club are returned');
  const all = g.flatMap(x => x.players.map(x2 => x2.el.id));
  ok(!all.includes(8), 'low-minutes players are excluded');
  ok(!all.includes(9), 'players who left the club are excluded');
  ok(g.find(x => x.team === 3).total === 9, 'excluded players do not inflate the club total');
  ok(C(els, 1, 270)[0].players.length === 1, 'the per-club count is configurable');
  ok(C([], 3, 270).length === 0, 'an empty league yields no groups');

  /* Baseline BPS breaks a tie on bonus, so two players level on bonus are
     separated by the underlying rate rather than by array order. */
  const tie = [
    p(1, 1, 10, { bps: 200 }),
    p(2, 1, 10, { bps: 500 }),
  ];
  ok(C(tie, 2, 270)[0].players[0].el.id === 2, 'equal bonus is broken by baseline BPS');

  /* Each entry carries what the card prints. */
  ok(g[0].players.every(x => typeof x.bonus === 'number' &&
    typeof x.b90 === 'number' && typeof x.perStart === 'number'),
    'every entry carries bonus, baseline per 90 and bonus per start');
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
