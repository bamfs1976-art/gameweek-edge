/*
 * Offline tests for the Social Studio posting order.
 *
 * socSchedule turns the deadlines the app already holds into "post this card,
 * this evening". The failure modes are all quiet ones — a schedule that looks
 * plausible and is wrong is worse than no schedule, because it gets followed:
 *
 *   - a slot in the past, so the panel opens telling you to post yesterday
 *   - the same card twice inside a fortnight, which reads as a broken queue
 *   - a card in the rota that did not render this session, so the schedule
 *     promises a post with no graphic behind it
 *   - a clock change moving 18:30 to 17:30, because the offset was computed
 *     in milliseconds rather than in days
 *
 * The last one is the reason this file injects `now` and fabricates deadlines
 * rather than testing against whatever today happens to be.
 *
 * Run: node dev/test-social-schedule.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let failed = 0;
const fail = (m) => { console.error('  FAIL ' + m); failed++; };
const ok = (m) => console.log('  ok   ' + m);
const eq = (a, b, m) => a === b ? ok(m) : fail(m + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b));

/* Lift the scheduler and its tables out of the page. Balanced-brace scan,
   quote-aware, same approach the other extraction tests use. */
function slice(from, to) {
  const a = html.indexOf(from);
  if (a < 0) throw new Error('could not find ' + from);
  const b = html.indexOf(to, a);
  if (b < 0) throw new Error('could not find ' + to);
  return html.slice(a, b);
}
const src = slice('const SOC_ROTA=', 'function socPlanCard(');
const ctx = new Function(src + '\nreturn {SOC_ROTA,SOC_PIN,SOC_WEEKS,SOC_SHOTS,socPostTimes,socSchedule,socWhen};')();
const { SOC_ROTA, SOC_PIN, SOC_SHOTS, socPostTimes, socSchedule } = ctx;

/* ── The rota must name real cards ───────────────────────────────────
   A typo here is invisible: the id simply never matches, the card silently
   never gets scheduled, and the rotation quietly shortens. */
const specSrc = html.slice(html.indexOf('function socialSpecs('),
  html.indexOf('function renderSocialCard('));
const presets = new Set([...specSrc.matchAll(/\bpush\('([a-z0-9-]+)'\s*,/g)].map(m => m[1]));
['ladder-1', 'ladder-2', 'ladder-3', 'ladder-4'].forEach(id => presets.add(id));
for (const id of SOC_ROTA) if (!presets.has(id)) fail('rota names "' + id + '", which is not a preset');
if (!presets.has(SOC_PIN)) fail('pinned card "' + SOC_PIN + '" is not a preset');
if (new Set(SOC_ROTA).size !== SOC_ROTA.length) fail('rota contains a duplicate');
if (SOC_ROTA.includes(SOC_PIN)) fail('the pinned card is also in the rota — it would be scheduled twice');
if (!failed) ok('rota: ' + SOC_ROTA.length + ' cards, all real, no duplicates, pin held out');

/* ── A fabricated season ─────────────────────────────────────────────
   Saturday 11:00 deadlines, a week apart. Local time, because that is what
   the app reads and what the clock change acts on. */
function season(startISO, n) {
  const events = [];
  const d = new Date(startISO);
  for (let i = 0; i < n; i++) {
    const e = new Date(d.getTime());
    e.setDate(e.getDate() + i * 7);
    events.push({ id: i + 1, deadline_time: e.toISOString() });
  }
  return { events };
}

const b = season('2026-09-05T10:00:00Z', 8);          /* Sat deadlines */
const now = new Date('2026-09-01T09:00:00Z').getTime();
const plan = socSchedule(b, now, null);

/* ── Nothing in the past, and the order is the order ─────────────── */
eq(plan.every(s => s.at.getTime() > now), true, 'every slot is in the future');
eq(plan.every((s, i) => !i || plan[i - 1].at <= s.at), true, 'slots come back in ascending date order');
/* Two kinds of slot repeat by design — the pinned captaincy call and the
   screenshot posts. Everything else is the rota, and the rota must not. */
const SHOTS = new Set(ctx.SOC_SHOTS.map((s) => s.id));
const rotaSlots = plan.filter(s => s.id !== SOC_PIN && !SHOTS.has(s.id));
eq(new Set(rotaSlots.map(s => s.id)).size, rotaSlots.length, 'no rota card is scheduled twice');
if (!plan.length) fail('a season with eight upcoming deadlines produced no schedule');

/* ── One post a day ──────────────────────────────────────────────────
   The failure this catches is not hypothetical: driven by a congested
   fixture list the first cut of this scheduler put three cards on the same
   evening, which is not a queue anyone can follow. */
const dayKey = (d) => d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
eq(new Set(plan.map(s => dayKey(s.at))).size, plan.length, 'no two posts share a day');

/* Deadlines four days apart — a midweek round. This is the shape that made
   this-gameweek's D−1 collide with next gameweek's D−3. */
const tight = { events: [1, 2, 3, 4, 5].map((i) => {
  const d = new Date('2026-09-05T10:00:00Z');
  d.setDate(d.getDate() + (i - 1) * 4);
  return { id: i, deadline_time: d.toISOString() };
}) };
const tightPlan = socSchedule(tight, new Date('2026-09-01T09:00:00Z').getTime(), null);
eq(new Set(tightPlan.map(s => dayKey(s.at))).size, tightPlan.length,
  'a congested fixture list still yields one post a day');
eq(tightPlan.length > 0, true, 'and a congested fixture list still yields a schedule');
/* A contested day goes to the nearest deadline. Ranking the pinned card
   first instead starved the rotation — captaincy slots for gameweeks weeks
   away took the days belonging to cards due for the next one, and a congested
   list scheduled almost nothing else. */
eq(tightPlan.filter(s => s.id === SOC_PIN).length > 0, true,
  'the captaincy call survives a congested week');
eq(tightPlan.filter(s => s.id !== SOC_PIN).length > 0, true,
  'and a congested week does not become nothing but captaincy calls');
eq(tightPlan.every((s, i) => !i || tightPlan[i - 1].gw <= s.gw), true,
  'a congested plan still runs in gameweek order');

/* ── The captaincy call is every week, two days out ──────────────── */
const pinned = plan.filter(s => s.id === SOC_PIN);
eq(pinned.every(s => s.off === 2), true, 'the captaincy call is always two days out');
/* It is the anchor of the week, so it repeats. Showing it once would tell the
   owner to post it in September and then apparently never again. On an
   ordinary weekly fixture list nothing contests its day, so it should appear
   for every gameweek in the window. */
eq(pinned.length, new Set(plan.map(s => s.gw)).size,
  'on a weekly fixture list the captaincy call is scheduled every gameweek');
eq(new Set(pinned.map(s => s.gw)).size, pinned.length, 'and never twice in the same gameweek');

/* ── The GW Debrief ──────────────────────────────────────────────────
   A screenshot post, not a card, and weekly like the captaincy call. It sits
   five days out so it lands on the Monday of an ordinary Saturday-deadline
   week — the gameweek just gone is still raw. */
const SHOT_IDS = new Set(SOC_SHOTS.map((s) => s.id));
const shots = plan.filter((s) => SHOT_IDS.has(s.id));
eq(shots.length > 0, true, 'the debrief is in the queue');
eq(shots.every((s) => s.shot === true), true, 'and is flagged as a screenshot, not a card');
eq(shots.every((s) => s.at.getDay() === 1), true,
  'a Saturday deadline puts the debrief on a Monday');
/* One per gameweek, but not necessarily for the FIRST one in the window: at
   five days out its slot is often already behind us when the panel opens,
   and a queue that lists a past evening is worse than one that skips it. */
eq(new Set(shots.map((s) => s.gw)).size, shots.length, 'never twice in the same gameweek');
const gwCount = new Set(plan.map((s) => s.gw)).size;
eq(shots.length >= gwCount - 1, true,
  'and it recurs every gameweek whose slot has not already passed (' + shots.length + '/' + gwCount + ')');
/* It has no rendered card, so a restricted card set must not drop it — that
   is the whole difference between a screenshot post and a Studio one. */
eq(socSchedule(b, now, new Set(['captains'])).some((s) => SHOT_IDS.has(s.id)), true,
  'the debrief survives even when no other card rendered');

/* ── A slot may not reach back past the previous deadline ────────────
   Five days out is longer than a congested gap between gameweeks. Without a
   guard the debrief for GW(n+1) lands before GW(n)'s deadline — telling the
   owner to publish a debrief for a gameweek that has not been played. */
for (const s of tightPlan) {
  const idx = tight.events.findIndex((e) => e.id === s.gw);
  if (idx <= 0) continue;
  const prev = Date.parse(tight.events[idx - 1].deadline_time);
  if (s.at.getTime() <= prev) {
    fail('GW' + s.gw + ' ' + s.id + ' is scheduled before GW' + tight.events[idx - 1].id + "'s deadline");
  }
}
if (!failed) ok('no slot is scheduled before the deadline of the gameweek it follows');

/* ── Offsets land on the right weekday ───────────────────────────── */
for (const s of plan) {
  const dl = new Date(b.events.find(e => e.id === s.gw).deadline_time);
  const days = Math.round((dl - s.at) / 86400000);
  if (days !== s.off) {
    fail('GW' + s.gw + ' slot claims -' + s.off + 'd but lands ' + days + ' days before the deadline');
  }
}
if (!failed) ok('every slot lands the stated number of days before its deadline');

/* ── Times ───────────────────────────────────────────────────────── */
eq(socPostTimes(new Date('2026-09-06T12:00:00')).x, '19:00', 'Sunday posts earlier on X');
eq(socPostTimes(new Date('2026-09-09T12:00:00')).x, '18:30', 'weekdays use the evening slot');
eq(plan.every(s => /^\d\d:\d\d$/.test(s.xTime) && /^\d\d:\d\d$/.test(s.bTime)), true,
  'every slot carries an X time and a Bluesky time');
eq(plan.every(s => s.bTime >= s.xTime), true, 'Bluesky is never scheduled before X');

/* ── The clock change ────────────────────────────────────────────────
   The UK leaves BST on 25 Oct 2026. A slot three days before a deadline on
   the far side of that boundary must still read 18:30 local, which it only
   does if the offset was applied in days rather than in milliseconds. */
const dst = socSchedule(season('2026-10-31T12:00:00Z', 2),
  new Date('2026-10-20T09:00:00Z').getTime(), null);
if (!dst.length) fail('the clock-change season produced no schedule');
for (const s of dst) {
  const hhmm = String(s.at.getHours()).padStart(2, '0') + ':' + String(s.at.getMinutes()).padStart(2, '0');
  if (hhmm !== s.xTime) fail('across the clock change a slot reads ' + hhmm + ' but claims ' + s.xTime);
}
if (!failed) ok('slots keep their wall-clock time across the end of BST');

/* ── Only cards that actually rendered ───────────────────────────── */
const have = new Set(['captains', 'defcon', 'set-pieces']);
const narrow = socSchedule(b, now, have);
/* Screenshot posts are exempt — there is no rendered card to be missing. */
eq(narrow.every(s => have.has(s.id) || SHOT_IDS.has(s.id)), true,
  'a restricted card set never schedules a CARD that is missing');
eq(narrow.length > 0, true, 'a restricted card set still produces a schedule');

/* ── Degenerate inputs return nothing, rather than throwing ──────── */
for (const [label, arg] of [['no events', { events: [] }], ['no bootstrap', null],
  ['events without deadlines', { events: [{ id: 1 }] }]]) {
  let got;
  try { got = socSchedule(arg, now, null); } catch (e) { fail(label + ' threw: ' + e.message); continue; }
  if (!Array.isArray(got) || got.length) fail(label + ' should produce an empty schedule');
}
/* A season that has entirely finished is the same case — every deadline is
   behind us, so there is nothing to queue. */
if (socSchedule(b, new Date('2027-01-01T00:00:00Z').getTime(), null).length)
  fail('a finished season should produce an empty schedule');
if (!failed) ok('empty, missing and finished seasons all return an empty schedule');

console.log(failed ? '\n' + failed + ' failure(s)' : '\nsocial schedule: all good');
process.exit(failed ? 1 : 0);
