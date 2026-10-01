/*
 * Offline test for the prediction-logger health check
 * (netlify/functions/predictions-health.js → computeHealth). Exercises every
 * season-calendar state from a mock bootstrap + prediction stats — no FPL
 * network, no Supabase.
 *
 * Run: node dev/test-health.mjs   (wired into npm test)
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { computeHealth, seasonLabel } = require(join(ROOT, 'netlify', 'functions', 'predictions-health.js'));

let failures = 0, passes = 0;
const ok = (c, label) => { if (c) passes++; else { failures++; console.error('  ✗ ' + label); } };
console.log('• prediction-logger health check');

const DAY = 86400000;
const T0 = Date.parse('2026-08-15T12:00:00Z');
const boot2627 = { events: [
  { id: 1, deadline_time: '2026-08-21T17:30:00Z', finished: false },
  { id: 2, deadline_time: '2026-08-28T17:30:00Z', finished: false },
] };

ok(seasonLabel(boot2627.events) === '2026/27', 'season label derived from the earliest deadline');

/* Logging: predictions already exist for the live season. */
const hLog = computeHealth(boot2627, { '2026/27': { n: 320, graded: 0, lastWrite: '2026-08-15T11:00:00Z' } }, T0);
ok(hLog.status === 'logging' && hLog.healthy, 'writes present → logging + healthy');
ok(hLog.predictions === 320 && hLog.season === '2026/27', 'reports the season prediction count');
ok(typeof hLog.detail === 'string' && hLog.detail.length > 0, 'carries a human-readable detail line');

/* Between seasons: no upcoming gameweek at all. */
const bootDone = { events: [{ id: 38, deadline_time: '2026-05-20T14:00:00Z', finished: true }] };
const hBetween = computeHealth(bootDone, {}, Date.parse('2026-07-01T00:00:00Z'));
ok(hBetween.status === 'between-seasons' && hBetween.healthy, 'no upcoming GW → between-seasons (not an error)');

/* Pre-season: upcoming GW more than 10 days out, nothing logged. */
const hPre = computeHealth(boot2627, {}, Date.parse('2026-08-05T00:00:00Z'));
ok(hPre.status === 'preseason' && hPre.upcomingGw === 1 && hPre.healthy, 'GW1 >10 days out, empty → preseason');

/* Expected-soon: within 10 days of the deadline, still nothing logged. */
const hSoon = computeHealth(boot2627, {}, Date.parse('2026-08-18T00:00:00Z'));
ok(hSoon.status === 'expected-soon' && hSoon.healthy, 'within 10 days, empty → expected-soon (still ok)');

/* Stale: the deadline has passed and nothing was ever logged — the alarm. */
const hStale = computeHealth(boot2627, {}, Date.parse('2026-08-22T00:00:00Z'));
ok(hStale.status === 'stale' && !hStale.healthy, 'deadline passed with no writes → stale + UNhealthy');

/* Season isolation: last season's rows do not count as this season logging. */
const hOldOnly = computeHealth(boot2627, { '2025/26': { n: 5000, graded: 5000, lastWrite: '2026-05-20T00:00:00Z' } }, Date.parse('2026-08-18T00:00:00Z'));
ok(hOldOnly.status === 'expected-soon' && hOldOnly.predictions === 0, 'only prior-season rows → current season still shows nothing logged');

/* Paging past the PostgREST response cap. The server returns at most 1,000
   rows per request whatever .limit() asks for, so both reads of
   gwedge_predictions must page with .range() until a short page. The fake
   client enforces that cap: a single unpaged read would see 1,000 rows. */
(async () => {
  console.log('• paging gwedge_predictions past the 1,000-row cap');
  const { fetchGraded } = require(join(ROOT, 'netlify', 'functions', 'model-calibration.js'));
  const { fetchAll } = require(join(ROOT, 'netlify', 'functions', 'predictions-health.js'));
  const CAP = 1000;
  const fakeSb = (rows, failAt) => ({ from: () => {
    let graded = false, calls = 0;
    const q = {
      select: () => q, order: () => q,
      not: () => { graded = true; return q; },
      limit: (n) => Promise.resolve({ data: rows.slice(0, Math.min(n, CAP)), error: null }),
      range: (a, b) => {
        calls++;
        if (failAt != null && a >= failAt) return Promise.resolve({ data: null, error: { message: 'boom' } });
        const src = graded ? rows.filter((r) => r.actual != null) : rows;
        return Promise.resolve({ data: src.slice(a, Math.min(b + 1, a + CAP)), error: null });
      },
    };
    return q;
  } });

  /* 2,663 rows logged, 2,273 graded: the live shape after GW5 of 2026/27. */
  const rows = [];
  for (let i = 0; i < 2663; i++) rows.push({ season: '2026/27', gw: 1 + Math.floor(i / 533), element: i, xp: 2, haul_prob: 0.05, actual: i < 2273 ? 1 : null, created_at: '2026-09-' + String(1 + (i % 28)).padStart(2, '0') + 'T00:00:00Z' });

  const single = await fakeSb(rows).from().select().not().limit(50000);
  ok(single.data.length === CAP, 'control: an unpaged .limit(50000) read stops at the 1,000-row cap');

  const g = await fetchGraded(fakeSb(rows));
  ok(!g.error && g.rows.length === 2273, 'calibration reads every graded row (2,273), not the first 1,000');
  const a = await fetchAll(fakeSb(rows));
  ok(!a.error && a.rows.length === 2663, 'health check counts every logged row (2,663)');
  ok(a.rows.filter((r) => r.actual != null).length === 2273, 'health check graded count is the full 2,273');

  const exact = await fetchGraded(fakeSb(rows.slice(0, 2000)));
  ok(exact.rows.length === 2000, 'a table that is an exact multiple of the page size is read in full');
  const empty = await fetchGraded(fakeSb([]));
  ok(!empty.error && empty.rows.length === 0, 'an empty table returns no rows and no error');
  const failed = await fetchAll(fakeSb(rows, 1000));
  ok(failed.error && !failed.rows, 'an error on a later page is reported, not a silent partial count');

  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  if (failures) process.exit(1);
})();
