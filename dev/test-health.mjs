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

console.log('\n' + passes + ' passed, ' + failures + ' failed');
if (failures) process.exit(1);
