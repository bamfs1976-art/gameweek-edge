/*
 * The FPL season ledger.
 *
 * The twin of dev/test-efl-record.mjs. The ledger claims "these are the
 * picks we made BEFORE the deadline, and this is how they did", and every
 * way that claim could quietly become false is tested here:
 *
 *   1. THE REFUSALS — after the deadline, twice, and days too early.
 *   2. THE GRADING — the eleven's points, the captain's rank, the price
 *      hits, and "not graded" where the feed has no input.
 *   3. THE PUBLISHED SHAPE — what /record and the app scorecard read.
 *   4. THE FILES ON DISK — every committed entry was recorded before its
 *      deadline, and a graded one was graded after it.
 *
 * Synthetic, no network, no clock.
 *
 * Run: node dev/test-fpl-record.mjs   (wired into npm test)
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const lib = await import(join(ROOT, 'scripts/record/lib.mjs'));
const metrics = await import(join(ROOT, 'scripts/record/metrics.mjs'));
const publish = await import(join(ROOT, 'scripts/record/publish-record.mjs'));

let checks = 0;
const ok = (label, fn) => { fn(); checks += 1; void label; };
const HOUR = 3600000;
const NOW = Date.parse('2026-09-12T09:00:00Z');
const ev = (id, hoursFromNow, extra = {}) => ({ id, deadline_time: new Date(NOW + hoursFromNow * HOUR).toISOString(), finished: false, ...extra });

/* ── 1. The refusals ─────────────────────────────────── */
ok('picks may be recorded inside the window', () => {
  const v = lib.canRecord({ event: ev(4, 20), existing: null, now: NOW });
  assert.equal(v.ok, true);
});
ok('picks may NOT be recorded once the deadline has passed', () => {
  const v = lib.canRecord({ event: ev(4, -0.5), existing: null, now: NOW });
  assert.equal(v.ok, false);
  assert.match(v.reason, /not a prediction/);
});
ok('a recorded gameweek is never re-recorded', () => {
  const v = lib.canRecord({ event: ev(4, 10), existing: { gw: 4, recordedAt: '2026-09-11T09:00:00Z' }, now: NOW });
  assert.equal(v.ok, false);
  assert.match(v.reason, /append-only/);
});
ok('picks are not recorded days out', () => {
  const v = lib.canRecord({ event: ev(4, 120), existing: null, now: NOW });
  assert.equal(v.ok, false);
  assert.match(v.reason, /too early/);
});
ok('the open gameweek is the earliest unfinished one still ahead', () => {
  const events = [ev(3, -50, { finished: true }), ev(5, 200), ev(4, 30)];
  assert.equal(lib.openEvent(events, NOW).id, 4);
  assert.equal(lib.openEvent([ev(3, -50, { finished: true })], NOW), null);
});
ok('a gameweek is gradable only once FPL has finished and checked it', () => {
  assert.equal(lib.eventSettled([{ id: 4, finished: true, data_checked: true }], 4), true);
  assert.equal(lib.eventSettled([{ id: 4, finished: true, data_checked: false }], 4), false);
  assert.equal(lib.eventSettled([{ id: 4, finished: false }], 4), false);
  const g = lib.gradable([{ gw: 4, result: null }, { gw: 3, result: { x: 1 } }], [{ id: 4, finished: true, data_checked: true }, { id: 3, finished: true, data_checked: true }]);
  assert.deepEqual(g.map((e) => e.gw), [4]);
});

/* ── 2. The grading ──────────────────────────────────── */
const entry = {
  gw: 4, recordedAt: '2026-09-11T20:00:00Z', deadlineAt: '2026-09-12T10:00:00Z', hoursBeforeDeadline: 14,
  picks: {
    totw: { formation: '3-4-3', modelTotal: 60, players: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => ({ id: String(i), name: 'P' + i, team: 'T', position: 'MID', xp: 5 })) },
    captain: { id: '3', name: 'P3', team: 'T', xp: 9, alternatives: [] },
    prices: [{ id: '1', name: 'P1', team: 'T', dir: 'rise', prob: 80, cost: 50 }, { id: '2', name: 'P2', team: 'T', dir: 'fall', prob: 70, cost: 60 },
      { id: '9', name: 'P9', team: 'T', dir: 'rise', prob: 60, cost: 40 }],
    naiveXI: { formation: '4-4-2', players: [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map((i) => ({ id: String(i), name: 'N' + i, form: 3 })) }
  },
  result: null
};
const live = { elements: [] };
for (let i = 1; i <= 30; i++) live.elements.push({ id: i, stats: { total_points: i === 3 ? 12 : i <= 11 ? 4 : i === 25 ? 15 : 2, minutes: i === 30 ? 0 : 90 } });
const bootNow = {
  events: [{ id: 4, average_entry_score: 45, highest_score: 110 }],
  elements: [{ id: 1, now_cost: 51 }, { id: 2, now_cost: 60 }, { id: 9, now_cost: 39 }]
};
const res = metrics.gradeEntry(entry, live, bootNow, '2026-09-14T09:00:00Z');

ok('the XI is graded on the eleven\'s official points, undoubled', () => {
  assert.equal(res.totw.total, 4 * 10 + 12);
  assert.equal(res.totw.withCaptain, 52 + 12);
  assert.equal(res.totw.unresolved, 0);
});
ok('the average manager score is read from the feed and compared', () => {
  assert.equal(res.totw.average, 45);
  assert.equal(res.totw.beatAverage, true);
});
ok('the form XI fixed before the gameweek is the second bar', () => {
  assert.equal(res.totw.naive, 11 * 2);
  assert.equal(res.totw.beatNaive, true);
});
ok('the captain is ranked among players who played, ties above him counted', () => {
  assert.equal(res.captain.points, 12);
  assert.equal(res.captain.rank, 2);       /* player 25 scored 15 */
  assert.equal(res.captain.of, 29);        /* player 30 did not play */
});
ok('a price call is a hit only when the price moved the way it said', () => {
  const byId = Object.fromEntries(res.prices.rows.map((r) => [r.id, r]));
  assert.equal(byId['1'].hit, true);       /* rise, 50 → 51 */
  assert.equal(byId['2'].hit, false);      /* fall, unchanged */
  assert.equal(byId['9'].hit, false);      /* rise, fell */
  assert.equal(res.prices.hits, 1);
  assert.equal(res.prices.graded, 3);
});
ok('a missing input is "not graded", never an estimate', () => {
  const r = metrics.gradeEntry({ ...entry, picks: { ...entry.picks, naiveXI: null } }, live, { events: [{ id: 4, average_entry_score: 0 }], elements: [] });
  assert.equal(r.totw.average, null);
  assert.equal(r.totw.beatAverage, null);
  assert.equal(r.totw.naive, null);
  assert.equal(r.totw.beatNaive, null);
  assert.equal(r.prices.graded, 0);
  assert.equal(r.prices.rate, null);
});
ok('the season summary counts what was graded and nothing else', () => {
  const s = metrics.seasonSummary([{ ...entry, result: res }, { ...entry, gw: 5, result: null }]);
  assert.equal(s.recorded, 2);
  assert.equal(s.graded, 1);
  assert.equal(s.totw.beatAverage, 1);
  assert.equal(s.captain.medianRank, 2);
  assert.equal(s.prices.hits, 1);
});

/* ── 3. The published shape ──────────────────────────── */
ok('the public record carries picks, points and the season, and no universe', () => {
  const pub = publish.buildPublicRecord([{ ...entry, universe: { columns: [], rows: [[1]] }, result: res }], '2026-09-14T10:00:00Z');
  assert.equal(pub.gameweeks.length, 1);
  const g = pub.gameweeks[0];
  assert.equal(g.graded, true);
  assert.equal(g.totw.players[2].points, 12);
  assert.equal(g.result.captain.rank, 2);
  assert.equal(g.prices[0].hit, true);
  assert.equal('universe' in g, false);
  assert.equal(pub.season.graded, 1);
  assert.equal(pub.ledgerUpdatedAt, '2026-09-14T09:00:00Z');
  assert.ok(pub.method && pub.method.notGraded);
});
ok('an unplayed gameweek publishes its picks with no result', () => {
  const pub = publish.buildPublicRecord([entry]);
  assert.equal(pub.gameweeks[0].graded, false);
  assert.equal(pub.gameweeks[0].result, null);
  assert.equal(pub.season.graded, 0);
});

/* ── 4. The files on disk ────────────────────────────── */
ok('every committed entry was recorded before its deadline and graded after it', () => {
  const dir = join(ROOT, 'data', 'record');
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((n) => /^gw-\d+\.json$/.test(n))) {
    const e = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    assert.ok(Date.parse(e.recordedAt) < Date.parse(e.deadlineAt), f + ' was recorded after its deadline');
    assert.ok(e.hoursBeforeDeadline > 0 && e.hoursBeforeDeadline <= lib.RECORD_WINDOW_HOURS, f + ' outside the window');
    assert.equal(e.picks.totw.players.length, 11, f + ' does not carry eleven');
    if (e.result) assert.ok(Date.parse(e.result.gradedAt) > Date.parse(e.deadlineAt), f + ' was graded before its deadline');
  }
});

console.log(`fpl record: ${checks} checks passed`);
