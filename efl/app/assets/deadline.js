/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — deadlines, reminders and the pre-deadline checklist.

   Pure functions only: no DOM, no fetch, no storage, no clock unless one
   is passed. dev/test-efl-deadline.mjs runs every one of them in Node.

   ── WHY A CALENDAR FILE AND NOT A NOTIFICATION ──────────────
   A web page cannot schedule a notification for tomorrow evening. Without
   a server sending push messages, a browser alert fires only while the
   site is open, which is exactly when nobody needs reminding. A calendar
   file works on every phone, needs no permission and stores nothing about
   anyone, so it is the reminder this app offers.

   ── WHY THE REMINDER IS ITS OWN EVENT ──────────────────────
   Google Calendar drops the alarms inside an imported file and applies the
   user's default notification to each event instead. So the reminder is
   an event in its own right, placed at the reminder time: whatever a
   calendar does with alarms, the event lands when it should. The alarm is
   kept for the calendars that honour it.
   ═══════════════════════════════════════════════════════════ */

import { runSummary, squadAdvice } from './model.js';
import { squadWarnings } from './availability.js';

export const TIME_ZONE = 'Europe/London';
export const SITE = 'https://gameweekedge.co.uk';

/** Reminder choices. `eve` is the default: 7pm UK time the day before. */
export const REMIND_OPTIONS = {
  eve: { label: '7pm the evening before', hoursBefore: null },
  24: { label: '24 hours before', hoursBefore: 24 },
  3: { label: '3 hours before', hoursBefore: 3 }
};
export const DEFAULT_REMIND = 'eve';
/** Inside this window the countdown bar turns amber. */
export const URGENT_HOURS = 24;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/* ── Which deadline ──────────────────────────────────────── */

/** The first round whose deadline is still ahead, or null. */
export function nextDeadline(rounds, now) {
  const at = now == null ? Date.now() : now;
  return (rounds || [])
    .filter((r) => r.lockoutAt && Date.parse(r.lockoutAt) > at)
    .sort((a, b) => Date.parse(a.lockoutAt) - Date.parse(b.lockoutAt))[0] || null;
}

/** Every round still to lock, soonest first. */
export function upcomingDeadlines(rounds, now) {
  const at = now == null ? Date.now() : now;
  return (rounds || [])
    .filter((r) => r.lockoutAt && Date.parse(r.lockoutAt) > at)
    .sort((a, b) => Date.parse(a.lockoutAt) - Date.parse(b.lockoutAt));
}

/* ── Words for time ──────────────────────────────────────── */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "2 days 4 hours", "3 hours 12 minutes", "12 minutes", "under a minute". */
export function countdownText(ms) {
  if (!(ms > 0)) return 'passed';
  if (ms < MIN) return 'under a minute';
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const mins = Math.floor((ms % HOUR) / MIN);
  if (days) return hours ? `${plural(days, 'day')} ${plural(hours, 'hour')}` : plural(days, 'day');
  if (hours) return mins ? `${plural(hours, 'hour')} ${plural(mins, 'minute')}` : plural(hours, 'hour');
  return plural(mins, 'minute');
}

/** "Sat 21 Nov, 11:00", in UK time whatever the reader's own zone. */
export function fmtDeadline(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'date not published';
  const d = new Date(t);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TIME_ZONE });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TIME_ZONE });
  return `${day.replace(/,/g, '')}, ${time}`;
}

/** The UK clock's offset from UTC at an instant, in minutes (0 or 60). */
export function londonOffsetMinutes(t) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.round((asUtc - Math.floor(t / MIN) * MIN) / MIN);
}

/** The instant of the reminder for a deadline. */
export function reminderAt(lockoutIso, when = DEFAULT_REMIND) {
  const lock = Date.parse(lockoutIso);
  if (!Number.isFinite(lock)) return null;
  const opt = REMIND_OPTIONS[when] || REMIND_OPTIONS[DEFAULT_REMIND];
  if (opt.hoursBefore != null) return lock - opt.hoursBefore * HOUR;
  /* 7pm UK time on the UK calendar day before the deadline. The offset is
     read at the reminder itself, so a deadline the day after the clocks
     change still gets 7pm on the clock, not 6 or 8. */
  const offset = londonOffsetMinutes(lock);
  const local = new Date(lock + offset * MIN);
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - 1, 19, 0);
  return guess - londonOffsetMinutes(guess - 60 * MIN) * MIN;
}

/* ── The calendar file ───────────────────────────────────── */

const icsDate = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold to 75 octets per line, as RFC 5545 asks. */
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = '';
  let curLen = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    if (curLen + len > (out.length ? 74 : 75)) { out.push(cur); cur = ''; curLen = 0; }
    cur += ch; curLen += len;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/**
 * One file, one reminder event per round still to lock.
 *
 * UIDs are fixed per round, and SEQUENCE rises with each export, so
 * downloading again after a deadline moves updates the events in place
 * rather than adding a second set.
 *
 * @returns {{ics:string, count:number, lastRound:number|null}}
 */
export function buildIcs(rounds, opts = {}) {
  const now = opts.now == null ? Date.now() : opts.now;
  const when = REMIND_OPTIONS[opts.when] ? opts.when : DEFAULT_REMIND;
  const list = upcomingDeadlines(rounds, now)
    .map((r) => ({ r, at: reminderAt(r.lockoutAt, when) }))
    .filter(({ at }) => at != null && at > now);
  const sequence = Math.floor(now / MIN) % 2147483647;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gameweek Edge//Fantasy EFL deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Fantasy EFL deadlines'
  ];
  for (const { r, at } of list) {
    const deadline = fmtDeadline(r.lockoutAt);
    const guessed = r.lockoutSource !== 'official';
    lines.push(
      'BEGIN:VEVENT',
      `UID:fantasy-efl-round-${r.round}-reminder@gameweekedge.co.uk`,
      `SEQUENCE:${sequence}`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(at)}`,
      `DTEND:${icsDate(at + 15 * MIN)}`,
      `SUMMARY:${icsText(`Fantasy EFL round ${r.round}: deadline ${deadline}`)}`,
      `DESCRIPTION:${icsText(`Round ${r.round} locks ${deadline} UK time`
        + (guessed ? ' (taken from the first kick-off, as the official deadline was not published)' : '')
        + `. Check your seven: ${SITE}/fantasy-efl/checklist/`)}`,
      `URL:${SITE}/fantasy-efl/checklist/`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(`Fantasy EFL round ${r.round} deadline ${deadline}`)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return {
    ics: lines.map(fold).join('\r\n') + '\r\n',
    count: list.length,
    lastRound: list.length ? list[list.length - 1].r.round : null
  };
}

/* ── The checklist ───────────────────────────────────────── */

/**
 * Everything the checklist page shows, from the same functions the rest
 * of the app uses, so it cannot disagree with the ticker or the rater.
 *
 * @param {Object} ctx      buildContext()
 * @param {string[]} ids    the saved seven
 * @param {Object} opts     { scored, flags, lookahead }
 */
export function checklist(ctx, ids, opts = {}) {
  const flags = opts.flags || new Map();
  const lookahead = opts.lookahead || 6;
  const advice = squadAdvice(ctx, ids, { scored: opts.scored, limit: 0 });
  const picks = advice.picks;

  const clubIds = [...new Set(picks.map((r) => r.player.clubId))];
  const runs = Object.fromEntries(clubIds.map((id) => [id, runSummary(ctx, id, lookahead)]));

  const players = picks.map((rec) => {
    const run = runs[rec.player.clubId];
    const thisRound = run.rounds.find((r) => r.round === ctx.currentRound)
      || { round: ctx.currentRound, blank: true, double: false, matches: [] };
    return { rec, player: rec.player, flag: flags.get(rec.player.id) || null, round: thisRound };
  });

  /* Blanks and doubles from the round after this one onwards, for clubs
     you hold. This round's are already on each player's row. */
  const ahead = [];
  for (const id of clubIds) {
    for (const r of runs[id].rounds) {
      if (r.round <= ctx.currentRound) continue;
      if (r.blank || r.double) ahead.push({ clubId: id, round: r.round, kind: r.blank ? 'blank' : 'double' });
    }
  }
  ahead.sort((a, b) => a.round - b.round || a.clubId.localeCompare(b.clubId));

  const warnings = squadWarnings(ctx, ids, flags);
  const blanking = players.filter((p) => p.round.blank);
  const doubling = players.filter((p) => p.round.double);

  /* The ticks, in the order a manager checks them. Each is a sentence,
     not a colour, so it reads the same to a screen reader. */
  const items = [
    { key: 'count', ok: picks.length === 7,
      text: picks.length === 7 ? 'Seven players picked' : `${picks.length} of 7 players picked` },
    { key: 'rules', ok: picks.length === 7 && advice.legal,
      text: picks.length < 7 ? 'Rules check waits for a full seven'
        : advice.legal ? 'Formation and two-per-club limit are legal' : advice.issues.join('; ') },
    { key: 'flags', ok: picks.length > 0 && !warnings.length,
      text: warnings.length ? `${warnings.length} flagged in your seven` : 'No availability flags on your seven' },
    { key: 'fixtures', ok: picks.length > 0 && !blanking.length,
      text: blanking.length ? `${blanking.length} with no game this round` : 'Everyone has a game this round' }
  ];

  return {
    round: ctx.currentRound,
    count: picks.length,
    unknown: advice.unknown,
    items,
    players,
    warnings,
    blanking,
    doubling,
    ahead
  };
}
