/* Reading in-play events out of the FPL feed (netlify/lib/live-events.js):
   which fixtures still count, goals that survive VAR, and substitutions
   inferred from minutes that stopped moving.
   Run: node dev/test-live-events.mjs */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  HOLD_MS, SETTLE_MS, OFF_STALL_MINUTES,
  liveScope, holdVolatile, observe, trackMinutes,
} = require('../netlify/lib/live-events.js');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ok  ' + l); } else { fail++; console.log('  FAIL ' + l); } };
const section = (t) => console.log('\n• ' + t);

const fx = (id, o) => Object.assign({ id, started: true, finished: false, finished_provisional: false, minutes: 0 }, o);

section('liveScope: the whistle ends a fixture, not the bonus confirmation');
{
  const T0 = 1_000_000;
  const list = [
    fx(1),                                          /* being played */
    fx(2, { started: false }),                      /* not kicked off */
    fx(3, { finished_provisional: true }),          /* whistle gone, bonus not confirmed */
  ];
  const a = liveScope(list, null, T0);
  ok(a.active.map((f) => f.id).join(',') === '1,3', 'a fixture in play and one just finished are both in scope');
  ok(!a.active.some((f) => f.id === 2), 'a fixture that has not kicked off is out of scope');
  ok(a.seen['3'] === T0 && !a.seen['1'], 'only the finished fixture has a whistle time remembered');

  const b = liveScope(list, a.seen, T0 + SETTLE_MS - 1);
  ok(b.active.map((f) => f.id).join(',') === '1,3', 'the finished fixture stays in scope through the settle window');
  ok(b.seen['3'] === T0, 'and keeps its original whistle time rather than restarting the clock');

  const c = liveScope(list, b.seen, T0 + SETTLE_MS + 1);
  ok(c.active.map((f) => f.id).join(',') === '1', 'once the window passes it drops out for good');

  /* The old filter was `started && !finished`. FPL leaves `finished` false
     until bonus is confirmed, so that fixture would still be in scope. */
  ok(list[2].finished === false, 'the fixture it drops is one FPL still reports as unfinished');

  const gone = liveScope([fx(1)], { 9: T0 }, T0);
  ok(!('9' in gone.seen), 'a fixture no longer in the feed is forgotten, so the memory prunes itself');
}

section('holdVolatile: a goal counts once it has survived the hold');
{
  const T0 = 5_000_000;
  const feed = (g, a) => ({ 10: { goals_scored: g, assists: a || 0 } });

  const seed = holdVolatile(null, feed(1), T0);
  ok(seed.confirmed[10].g === 1, 'with no memory the feed is taken as already true, so a first run seeds rather than announces');
  ok(!seed.hold.by[10].pg, 'and nothing is left pending from a seed');

  let h = holdVolatile(seed.hold, feed(2), T0);
  ok(h.confirmed[10].g === 1, 'a new goal does not count immediately');
  ok(h.hold.by[10].pg.v === 2 && h.hold.by[10].pg.t === T0, 'it is held with the moment it appeared');

  h = holdVolatile(h.hold, feed(2), T0 + HOLD_MS - 1);
  ok(h.confirmed[10].g === 1, 'still not counted a moment before the hold is up');

  h = holdVolatile(h.hold, feed(2), T0 + HOLD_MS);
  ok(h.confirmed[10].g === 2, 'counted once the hold has passed');
  ok(!h.hold.by[10].pg, 'and it stops being pending');

  /* The whole point: chalked off inside the window, never announced. */
  let v = holdVolatile(seed.hold, feed(2), T0);
  v = holdVolatile(v.hold, feed(1), T0 + 30_000);
  ok(v.confirmed[10].g === 1, 'a goal taken away inside the hold never counts at all');
  ok(!v.hold.by[10].pg, 'and leaves nothing pending behind it');

  /* Taken away after it counted: the caller must be able to see the fall. */
  let r = holdVolatile(seed.hold, feed(2), T0);
  r = holdVolatile(r.hold, feed(2), T0 + HOLD_MS);
  ok(r.confirmed[10].g === 2, 'a goal that counted');
  r = holdVolatile(r.hold, feed(1), T0 + HOLD_MS + 60_000);
  ok(r.confirmed[10].g === 1, 'falls back when VAR takes it away, so the caller can say so');

  const hold = holdVolatile(seed.hold, feed(1, 1), T0);
  ok(hold.confirmed[10].a === 0 && hold.hold.by[10].pa.v === 1, 'assists are held on their own, separately from goals');

  const quiet = holdVolatile({ by: {} }, { 11: { goals_scored: 0, assists: 0 } }, T0);
  ok(!('11' in quiet.hold.by), 'a player with nothing to remember is not stored, so the row stays small');
  ok(quiet.confirmed[11].g === 0, 'but he still reads as zero rather than missing');
}

section('observe: per-fixture minutes, never the gameweek total');
{
  const mins = (fid, v) => ({ fixture: fid, stats: [{ identifier: 'minutes', points: 2, value: v }] });
  const els = [
    /* A double gameweek: 65 in one match and 20 in the other, 85 in total. */
    { id: 7, stats: { minutes: 85 }, explain: [mins(1, 65), mins(2, 20)] },
    { id: 8, stats: { minutes: 0 }, explain: [mins(1, 0)] },
    { id: 9, stats: { minutes: 90 }, explain: [mins(99, 90)] },
  ];
  const rows = observe(els, [fx(1, { minutes: 70 }), fx(2, { minutes: 25 })]);
  const seven = rows.filter((r) => r.pid === '7');
  ok(seven.length === 2, 'a player in two fixtures gives one reading per fixture');
  ok(seven[0].minutes === 65 && seven[1].minutes === 20, 'each reading is that fixture alone, not the 85 on his gameweek total');
  ok(seven[0].clock === 70 && seven[1].clock === 25, 'and carries its own fixture clock');
  ok(!rows.some((r) => r.pid === '8'), 'a player who has not been on the pitch is left out');
  ok(!rows.some((r) => r.pid === '9'), 'a fixture that is not in scope is ignored');
  ok(observe(null, null).length === 0 && observe([{ id: 1 }], [fx(1)]).length === 0, 'missing or empty input is an empty reading');
}

section('trackMinutes: off the pitch is minutes that stopped while the clock ran on');
{
  const row = (minutes, clock, pid = '7', fid = '1') => ({ pid, fid, minutes, clock });

  let t = trackMinutes(null, [row(60, 60)]);
  ok(t.off.length === 0, 'a first reading never reports anybody off');

  t = trackMinutes(t.track, [row(65, 65)]);
  ok(t.off.length === 0 && t.track.seen['7:1'][1] === 65, 'minutes still advancing resets the mark to now');

  t = trackMinutes(t.track, [row(65, 65 + OFF_STALL_MINUTES - 1)]);
  ok(t.off.length === 0, 'a short stall is not enough: the feed updates in steps');
  ok(t.track.seen['7:1'][1] === 65, 'and the mark stays where the minutes last moved');

  t = trackMinutes(t.track, [row(65, 65 + OFF_STALL_MINUTES)]);
  ok(t.off.join(',') === '7', 'once the clock has run on past the threshold he is off');

  t = trackMinutes(t.track, [row(65, 80)]);
  ok(t.off.join(',') === '7', 'and stays reported while the stall lasts, so a missed run still catches it');

  /* Half time: the match clock freezes too, so no gap ever opens. */
  let ht = trackMinutes(null, [row(45, 45)]);
  for (let i = 0; i < 5; i++) ht = trackMinutes(ht.track, [row(45, 45)]);
  ok(ht.off.length === 0, 'half time reports nobody off, because the clock stops as well');

  /* Came on as a substitute, then came off. Minutes are low throughout, so
     a raw "minutes behind the clock" test would call him off immediately. */
  let sub = trackMinutes(null, [row(5, 65)]);
  sub = trackMinutes(sub.track, [row(15, 75)]);
  ok(sub.off.length === 0, 'a substitute still playing is not reported off despite low minutes');
  sub = trackMinutes(sub.track, [row(15, 75 + OFF_STALL_MINUTES)]);
  ok(sub.off.join(',') === '7', 'and is caught when he comes off in turn');

  const late = trackMinutes({ seen: { '7:1': [65, 65] } }, [row(65, 95)]);
  ok(late.off.length === 0, 'past the end of normal time nothing is reported, where stoppage makes the comparison unreliable');

  const dgw = trackMinutes(
    { seen: { '7:1': [65, 65], '7:2': [20, 20] } },
    [row(65, 65 + OFF_STALL_MINUTES, '7', '1'), row(30, 30, '7', '2')],
  );
  ok(dgw.off.join(',') === '7', 'the two matches of a double gameweek are tracked apart');
  ok(dgw.track.seen['7:2'][0] === 30, 'and the one still being played keeps its own mark');

  const two = trackMinutes(
    { seen: { '7:1': [65, 65], '8:1': [70, 70] } },
    [row(65, 80, '7'), row(70, 80, '8')],
  );
  ok(two.off.sort().join(',') === '7,8', 'more than one player can come off in the same run');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
