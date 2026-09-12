/* The price feed's memory (netlify/lib/price-feed.js): hourly samples in,
   hour-on-hour deltas out, and a day-by-day log of the changes seen.
   Run: node dev/test-price-feed.mjs */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { FLOW_KEEP, LOG_DAYS, recordFlow, flowDeltas, recordChanges } = require('../netlify/lib/price-feed.js');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ok  ' + l); } else { fail++; console.log('  FAIL ' + l); } };
const section = (t) => console.log('\n• ' + t);

section('recordFlow: samples stay aligned to their timestamps');
{
  const el = (id, i, o) => ({ id, transfers_in_event: i, transfers_out_event: o });
  let st = recordFlow(null, [el(1, 100, 10), el(2, 5, 5)], 't1');
  ok(st.ts.length === 1 && st.io[1][0][0] === 100 && st.io[1][0][1] === 10, 'the first sample records in and out for every player');
  st = recordFlow(st, [el(1, 160, 20), el(3, 7, 0)], 't2');
  ok(st.ts.join(',') === 't1,t2', 'timestamps append');
  ok(st.io[1].length === 2 && st.io[1][1][0] === 160, 'a player seen twice has two samples');
  ok(st.io[2].length === 2 && st.io[2][1] === null, 'a player missing from this hour gets a null, not a gap');
  ok(st.io[3].length === 2 && st.io[3][0] === null && st.io[3][1][0] === 7, 'a player joining late is padded behind');
  for (let i = 3; i <= 30; i++) st = recordFlow(st, [el(1, 160 + i, 20)], 't' + i);
  ok(st.ts.length === FLOW_KEEP && st.ts[0] === 't' + (30 - FLOW_KEEP + 1), 'only the last ' + FLOW_KEEP + ' samples are kept');
  ok(!st.io[2] && !st.io[3], 'players with no sample left inside the window are dropped');
  ok(st.io[1].length === FLOW_KEEP, 'kept arrays are trimmed to the same length as the timestamps');
  ok(recordFlow(st, [el(1, 1, 1)], 'x', 3).ts.length === 3, 'the keep count is a parameter');
  const before = JSON.stringify(st);
  recordFlow(st, [el(1, 999, 0)], 'later');
  ok(JSON.stringify(st) === before, 'the previous state is not mutated');
}

section('flowDeltas: what the browser gets is hour-on-hour net, never a raw counter');
{
  const st = { ts: ['t1', 't2', 't3', 't4', 't5'], io: {
    1: [[100, 10], [160, 20], [200, 20], [0, 0], [30, 5]],
    2: [[5, 5], null, [9, 5], [9, 5], [12, 5]],
    3: [[7, 7], [7, 7], [7, 7], [7, 7], [7, 7]] } };
  const d = flowDeltas(st);
  ok(d.ts.join(',') === 't2,t3,t4,t5', 'one timestamp per delta: the sample it ends at');
  ok(d.net[1].join(',') === '50,40,,25', 'net = in gained minus out gained; a counter that went down (a deadline) is a null');
  ok(d.net[2].join(',') === ',,0,3', 'a missing sample yields nulls either side of it');
  ok(!d.net[3], 'a player with nothing but zeros is left out');
  ok(flowDeltas(null).ts.length === 0 && Object.keys(flowDeltas({}).net).length === 0, 'no state is an empty feed');
}

section('recordChanges: the day a change was seen, once');
{
  const c = (id, from, to) => ({ id, n: 'P' + id, t: 'ARS', p: 3, from, to });
  let log = recordChanges(null, [c(1, 50, 51), c(2, 70, 69)], '2026-09-12');
  ok(log.days['2026-09-12'].length === 2 && log.days['2026-09-12'][0].n === 'P1', 'two changes on a day');
  log = recordChanges(log, [c(1, 50, 51), c(3, 40, 41)], '2026-09-12');
  ok(log.days['2026-09-12'].length === 3, 'the same change seen an hour later is not written twice');
  log = recordChanges(log, [c(1, 51, 52)], '2026-09-13');
  ok(Object.keys(log.days).length === 2 && log.days['2026-09-13'][0].from === 51, 'a second day, and a second move of the same player is its own row');
  log = recordChanges(log, [{ id: 9, n: 'x', from: 'n', to: 1 }], '2026-09-13');
  ok(log.days['2026-09-13'].length === 1, 'a row without numbers is refused');
  let big = { days: {} };
  for (let i = 1; i <= LOG_DAYS + 5; i++) big = recordChanges(big, [c(i, 1, 2)], '2026-01-' + String(i).padStart(2, '0'));
  ok(Object.keys(big.days).length === LOG_DAYS, 'only the last ' + LOG_DAYS + ' days are kept');
  ok(recordChanges({ days: { junk: [], '2026-02-01': [] } }, [], '2026-02-02').days.junk === undefined, 'a key that is not a date is dropped');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
