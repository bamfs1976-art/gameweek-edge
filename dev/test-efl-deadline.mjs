/*
 * Fantasy EFL — deadline, reminder and checklist tests.
 *
 *   1. Rounds carry their deadlines from both sources, and say which kind.
 *   2. The next deadline, the countdown words and UK time are right,
 *      across the clocks changing.
 *   3. The calendar file is valid RFC 5545 that a calendar will import,
 *      with stable UIDs so a second download updates rather than doubles.
 *   4. The checklist reports a saved seven the same way the rest of the
 *      app would.
 *   5. Every page carries the bar and the new route.
 *
 * Run: node dev/test-efl-deadline.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { buildSampleSnapshot } from '../efl/app/assets/sample-data.js';
import { normaliseSnapshot, mapOfficialRounds, normaliseRound, loadRounds, resetSnapshotCache } from '../efl/app/assets/provider.js';
import { buildContext, playerScore, buildSquad } from '../efl/app/assets/model.js';
import { buildFlags, applyManualAvailability } from '../efl/app/assets/availability.js';
import * as dl from '../efl/app/assets/deadline.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'efl', 'app');
let passed = 0;
const ok = async (name, fn) => {
  try { await fn(); passed += 1; } catch (err) { console.error(`✗ ${name}`); throw err; }
};

const raw = buildSampleSnapshot();
const snap = normaliseSnapshot(raw, raw.source);

/* ── 1. Rounds ───────────────────────────────────────── */

await ok('the official feed\'s lockout becomes an official deadline', () => {
  const { rounds } = mapOfficialRounds([
    { roundNumber: 5, status: 'scheduled', lockoutDate: '2026-11-21T11:00:00Z', games: [] },
    { roundNumber: 4, status: 'completed', lockoutDate: '2026-11-14T11:00:00Z', games: [] },
    { roundNumber: 6, status: 'scheduled', lockoutDate: 'nonsense', games: [] }
  ], {}, Date.parse('2026-11-15T00:00:00Z'));
  const r5 = rounds.find((r) => r.round === 5);
  assert.equal(r5.lockoutAt, '2026-11-21T11:00:00.000Z');
  assert.equal(r5.lockoutSource, 'official');
  assert.equal(rounds.find((r) => r.round === 4).completed, true);
  const r6 = rounds.find((r) => r.round === 6);
  assert.equal(r6.lockoutAt, null, 'an unreadable date is not a deadline');
});

await ok('a source with no deadlines uses each round\'s first kick-off and says so', () => {
  assert.ok(snap.rounds.length > 30);
  assert.ok(snap.rounds.every((r) => r.lockoutSource === 'first-kickoff'));
  const first = snap.fixtures.filter((f) => f.round === 20).map((f) => Date.parse(f.kickoff)).sort((a, b) => a - b)[0];
  assert.equal(Date.parse(snap.rounds.find((r) => r.round === 20).lockoutAt), first);
});

await ok('a malformed round degrades rather than throws', () => {
  const r = normaliseRound({ round: 'x', lockoutAt: {} });
  assert.equal(r.lockoutAt, null);
  assert.equal(r.lockoutSource, 'first-kickoff');
});

/* ── 2. Time ─────────────────────────────────────────── */

const rounds = [
  { round: 1, lockoutAt: '2026-11-07T11:00:00.000Z', lockoutSource: 'official' },
  { round: 2, lockoutAt: '2026-11-21T11:00:00.000Z', lockoutSource: 'official' },
  { round: 3, lockoutAt: '2026-11-28T11:00:00.000Z', lockoutSource: 'official' },
  { round: 4, lockoutAt: null, lockoutSource: 'first-kickoff' }
];
const NOW = Date.parse('2026-11-14T12:00:00Z');

await ok('the next deadline is the first one still ahead', () => {
  assert.equal(dl.nextDeadline(rounds, NOW).round, 2);
  assert.equal(dl.nextDeadline(rounds, Date.parse('2026-12-01T00:00:00Z')), null);
  assert.equal(dl.upcomingDeadlines(rounds, NOW).length, 2);
});

await ok('the countdown reads as plain English', () => {
  const H = 3600e3;
  assert.equal(dl.countdownText(2 * 24 * H + 4 * H + 5 * 60e3), '2 days 4 hours');
  assert.equal(dl.countdownText(24 * H), '1 day');
  assert.equal(dl.countdownText(3 * H + 12 * 60e3), '3 hours 12 minutes');
  assert.equal(dl.countdownText(1 * H), '1 hour');
  assert.equal(dl.countdownText(12 * 60e3), '12 minutes');
  assert.equal(dl.countdownText(30e3), 'under a minute');
  assert.equal(dl.countdownText(-1), 'passed');
});

await ok('deadlines print in UK time, whatever the machine\'s zone', () => {
  assert.equal(dl.fmtDeadline('2026-11-21T11:00:00Z'), 'Sat 21 Nov, 11:00', 'GMT in winter');
  assert.equal(dl.fmtDeadline('2026-08-15T10:00:00Z'), 'Sat 15 Aug, 11:00', 'BST in summer');
});

await ok('7pm the evening before lands at 7pm on the UK clock, both sides of a clock change', () => {
  const at = (iso) => new Date(dl.reminderAt(iso, 'eve')).toISOString();
  assert.equal(at('2026-11-21T11:00:00Z'), '2026-11-20T19:00:00.000Z', 'winter: 7pm GMT');
  assert.equal(at('2026-08-15T10:00:00Z'), '2026-08-14T18:00:00.000Z', 'summer: 7pm BST');
  /* Clocks go back early on Sun 25 Oct 2026. A Sunday deadline's eve is
     Saturday, still on BST. */
  assert.equal(at('2026-10-25T12:00:00Z'), '2026-10-24T18:00:00.000Z', 'eve before the change');
  assert.equal(at('2026-10-26T19:00:00Z'), '2026-10-25T19:00:00.000Z', 'eve after the change');
  assert.equal(dl.reminderAt('2026-11-21T11:00:00Z', 24), Date.parse('2026-11-20T11:00:00Z'));
  assert.equal(dl.reminderAt('2026-11-21T11:00:00Z', 3), Date.parse('2026-11-21T08:00:00Z'));
});

/* ── 3. The calendar file ────────────────────────────── */

const { ics, count, lastRound } = dl.buildIcs(rounds, { now: NOW, when: 'eve' });
const lines = ics.split('\r\n');

await ok('the calendar file is well formed', () => {
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines[lines.length - 2], 'END:VCALENDAR');
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'every line ends CRLF');
  assert.ok(lines.includes('VERSION:2.0'));
  assert.ok(lines.some((l) => l.startsWith('PRODID:')));
  assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, lines.filter((l) => l === 'END:VEVENT').length);
  for (const l of lines) assert.ok(new TextEncoder().encode(l).length <= 75, `line over 75 octets: ${l}`);
});

await ok('one reminder per round still ahead, at the chosen time', () => {
  assert.equal(count, 2);
  assert.equal(lastRound, 3);
  assert.ok(lines.includes('DTSTART:20261120T190000Z'), 'round 2 at 7pm the evening before');
  assert.ok(!ics.includes('round-1-'), 'a passed round is left out');
  assert.ok(!ics.includes('round-4-'), 'a round with no deadline is left out');
});

await ok('UIDs are stable and SEQUENCE rises, so a re-download updates in place', () => {
  const later = dl.buildIcs(rounds, { now: NOW + 3600e3, when: '24' });
  const uids = (s) => s.split('\r\n').filter((l) => l.startsWith('UID:')).sort();
  assert.deepEqual(uids(later.ics), uids(ics));
  const seq = (s) => Number(s.split('\r\n').find((l) => l.startsWith('SEQUENCE:')).slice(9));
  assert.ok(seq(later.ics) > seq(ics));
});

await ok('text is escaped and an estimated deadline says so', () => {
  const est = dl.buildIcs([{ round: 9, lockoutAt: '2026-12-05T15:00:00Z', lockoutSource: 'first-kickoff' }], { now: NOW });
  const unfolded = est.ics.replace(/\r\n /g, '');
  assert.match(unfolded, /first kick-off/);
  assert.match(unfolded, /SUMMARY:Fantasy EFL round 9: deadline Sat 5 Dec\\, 15:00/);
});

/* ── 4. The checklist ────────────────────────────────── */

const ctx = buildContext(snap);
const scored = ctx.players.map((p) => playerScore(ctx, p));
const best = buildSquad(ctx, { scored });
const seven = best.picks.map((r) => r.player.id);

await ok('the model\'s own seven passes every check it can', () => {
  const ck = dl.checklist(ctx, seven, { scored, flags: new Map() });
  assert.equal(ck.count, 7);
  assert.equal(ck.items.find((i) => i.key === 'count').ok, true);
  assert.equal(ck.items.find((i) => i.key === 'rules').ok, true);
  assert.equal(ck.items.find((i) => i.key === 'flags').ok, true);
  assert.equal(ck.players.length, 7);
  assert.ok(ck.players.every((p) => p.round.round === ctx.currentRound));
});

await ok('an empty or short seven is reported, not crashed on', () => {
  const none = dl.checklist(ctx, [], { scored });
  assert.equal(none.count, 0);
  assert.ok(none.items.every((i) => !i.ok));
  const three = dl.checklist(ctx, seven.slice(0, 3), { scored });
  assert.match(three.items[0].text, /3 of 7/);
});

await ok('a flagged player in the seven fails the availability check', () => {
  const victim = seven[0];
  const { snapshot } = applyManualAvailability(snap, { entries: [{
    playerId: victim, status: 'out', note: 'Knee', checkedAt: new Date().toISOString(), expiresAfterRound: snap.currentRound
  }] });
  const c2 = buildContext(snapshot);
  const ck = dl.checklist(c2, seven, { flags: buildFlags(c2) });
  assert.equal(ck.items.find((i) => i.key === 'flags').ok, false);
  assert.equal(ck.warnings[0].player.id, victim);
});

await ok('blanks and doubles ahead are found for held clubs only', () => {
  /* The sample season puts a blank two rounds ahead and a double four
     ahead in every division. Hold a player from a club in each. */
  const blankRound = ctx.currentRound + 2;
  const run = (id) => ctx.fixtures.filter((f) => f.round === blankRound && (f.homeId === id || f.awayId === id)).length;
  const blankClub = ctx.clubs.find((c) => run(c.id) === 0);
  const pick = ctx.players.find((p) => p.clubId === blankClub.id);
  const ck = dl.checklist(ctx, [pick.id], { scored });
  assert.ok(ck.ahead.some((a) => a.clubId === blankClub.id && a.round === blankRound && a.kind === 'blank'));
  assert.ok(ck.ahead.every((a) => a.clubId === blankClub.id));
});

/* ── 5. Loader and pages ─────────────────────────────── */

await ok('the bar\'s light loader reads rounds.json alone on the official feed', async () => {
  resetSnapshotCache();
  const asked = [];
  const fakeFetch = async (url) => {
    asked.push(url);
    return { ok: true, status: 200, json: async () => [{ roundNumber: 2, status: 'scheduled', lockoutDate: '2099-01-01T11:00:00Z', games: [] }] };
  };
  const { rounds: got } = await loadRounds({ fetch: fakeFetch, force: true, window: { EFL_CONFIG: { provider: 'official' } } });
  assert.deepEqual(asked, ['/api/efl/rounds']);
  assert.equal(got[0].lockoutSource, 'official');
});

await ok('every page carries the countdown bar after its own module, and the checklist tab', () => {
  for (const f of ['index.html', 'checklist/index.html', 'fixtures/index.html', 'players/index.html',
    'availability/index.html', 'clubs/index.html', 'record/index.html', 'how-to-play/index.html',
    'admin/availability/index.html']) {
    const html = readFileSync(join(APP, f), 'utf8');
    assert.match(html, /<p class="dl-bar" id="deadline-bar" hidden><\/p>/, `${f}: no bar`);
    const page = html.search(/assets\/page-[a-z-]+\.js/);
    const bar = html.indexOf('assets/deadline-bar.js');
    assert.ok(page > 0 && bar > page, `${f}: the bar must load after the page module`);
    assert.ok(html.includes('href="/fantasy-efl/checklist/"'), `${f}: no checklist link`);
  }
});

await ok('no em dashes in the new reader-facing copy', () => {
  for (const f of ['checklist/index.html', 'assets/deadline.js', 'assets/deadline-bar.js', 'assets/page-checklist.js']) {
    const src = readFileSync(join(APP, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!src.includes('—'), `${f} has an em dash`);
  }
});

console.log(`✓ Fantasy EFL deadlines: ${passed} checks passed`);
