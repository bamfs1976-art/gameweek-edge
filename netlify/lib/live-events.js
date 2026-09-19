/* Gameweek Edge — reading in-play match events out of the FPL feed.

   The live push sender (netlify/functions/push-live.js) turns the official
   feed into personal alerts. Three things in that feed are harder than they
   look, and all three are solved here so they can be tested without a
   network or a subscriber:

   liveScope     which fixtures still justify work. FPL's `finished` flag
                 does not flip at the final whistle; it waits for bonus to
                 be confirmed, which can lag by hours.
                 `finished_provisional` is the whistle.

   holdVolatile  a goal is not a fact the moment it appears. VAR can take
                 it away again, and the feed has no "under review" flag, so
                 the only confirmation available is that the count is still
                 there a little later. Goals and assists are therefore held
                 before they count as announced, and a count that falls
                 after it was announced is reported as a correction.

   trackMinutes  FPL publishes no substitution event at all: no "off X, on
                 Y", nothing. A player who is off the pitch is visible only
                 as minutes that have stopped advancing while the match
                 clock keeps going.

   Everything here is pure, takes its clock as an argument and is shared
   with dev/test-live-events.mjs. Nothing in this file fetches, writes or
   notifies. */

/* How long a new goal or assist is held before it counts as real. The cost
   is that every alert lands this much later; the benefit is that a goal
   chalked off inside the window is never announced at all. Shorter than a
   publisher would use, because a personal alert is worth more early. */
const HOLD_MS = 90 * 1000;

/* A fixture stays in scope this long after the whistle so the last bonus
   movement still reaches subscribers, then drops out for good. */
const SETTLE_MS = 10 * 60 * 1000;

/* Minutes the match clock must advance, with a player's own minutes frozen,
   before he counts as off the pitch. Generous on purpose: the feed updates
   in steps, and a wrong "he is off" is worse than a late one. */
const OFF_STALL_MINUTES = 6;

/* Past this point on the clock the answer stops being useful and stoppage
   time makes the comparison unreliable, so no substitution is reported. */
const OFF_MAX_CLOCK = 88;

/* Fixtures worth reading this run, and the whistle times to remember.
   `prevSeen` maps fixture id to the moment we first saw it provisionally
   finished; it is returned updated and holds nothing for fixtures still
   being played, so it prunes itself. */
function liveScope(fixtures, prevSeen, nowMs, settleMs) {
  const ms = settleMs == null ? SETTLE_MS : settleMs;
  const seen = {};
  const active = [];
  for (const f of fixtures || []) {
    if (!f || !f.started) continue;
    if (!f.finished_provisional) { active.push(f); continue; }
    const fid = String(f.id);
    const first = Number((prevSeen || {})[fid]) || nowMs;
    seen[fid] = first;
    if (nowMs - first < ms) active.push(f);
  }
  return { active, seen };
}

/* Goals and assists, held until they have survived `holdMs`.

   `prevHold` is this function's own memory. `statsById` maps player id to
   the stats block from event/{gw}/live. Returns the counts safe to treat as
   announced, and the memory to store back.

   With no memory to compare against, whatever the feed says is taken as
   already true: a first run seeds a baseline rather than announcing the
   match so far. A count that falls below one already confirmed is passed
   straight through, so the caller sees it go down and can say so. */
function holdVolatile(prevHold, statsById, nowMs, holdMs) {
  const ms = holdMs == null ? HOLD_MS : holdMs;
  const seed = !prevHold || !prevHold.by;
  const prev = (prevHold && prevHold.by) || {};
  const by = {};
  const confirmed = {};

  for (const pid of Object.keys(statsById || {})) {
    const s = statsById[pid] || {};
    const raw = { g: Number(s.goals_scored) || 0, a: Number(s.assists) || 0 };
    const was = prev[pid] || {};
    const row = { g: Number(was.g) || 0, a: Number(was.a) || 0 };

    for (const [key, pendKey] of [['g', 'pg'], ['a', 'pa']]) {
      if (seed) { row[key] = raw[key]; continue; }
      if (raw[key] <= row[key]) { row[key] = raw[key]; continue; }
      const pend = was[pendKey];
      if (pend && Number(pend.v) === raw[key]) {
        if (nowMs - Number(pend.t) >= ms) row[key] = raw[key];
        else row[pendKey] = { v: raw[key], t: Number(pend.t) };
      } else {
        row[pendKey] = { v: raw[key], t: nowMs };
      }
    }

    confirmed[pid] = { g: row.g, a: row.a };
    if (row.g || row.a || row.pg || row.pa) by[pid] = row;
  }

  return { confirmed, hold: { by } };
}

/* One reading per player per live fixture: his minutes in that fixture and
   what the match clock says.

   Read from explain[], never from the element's own stats block. stats is
   the gameweek total, so in a double gameweek it sums two matches and the
   comparison against one match's clock is meaningless. explain[] is per
   fixture, which is what makes this safe. */
function observe(liveElements, fixtures) {
  const clock = {};
  for (const f of fixtures || []) if (f && f.id != null) clock[String(f.id)] = Number(f.minutes) || 0;

  const out = [];
  for (const el of liveElements || []) {
    if (!el || el.id == null) continue;
    for (const ex of el.explain || []) {
      const fid = String(ex && ex.fixture);
      if (!(fid in clock)) continue;
      const entry = (ex.stats || []).find((s) => s && s.identifier === 'minutes');
      const minutes = Number(entry && entry.value) || 0;
      if (minutes <= 0) continue;              /* never on the pitch */
      out.push({ pid: String(el.id), fid, minutes, clock: clock[fid] });
    }
  }
  return out;
}

/* Who has left the pitch, from minutes that have stopped moving.

   `prevTrack` remembers, per player per fixture, his minutes and the clock
   reading when those minutes last changed. Once the clock has run on by
   OFF_STALL_MINUTES with his own total unmoved, he is off.

   Half time needs no special case: the match clock freezes there too, so
   the gap never opens. Coming on as a substitute needs none either, because
   this asks whether minutes are still advancing, not whether he started. */
function trackMinutes(prevTrack, observations, stallMinutes, maxClock) {
  const stall = stallMinutes == null ? OFF_STALL_MINUTES : stallMinutes;
  const cap = maxClock == null ? OFF_MAX_CLOCK : maxClock;
  const prev = (prevTrack && prevTrack.seen) || {};
  const seen = {};
  const off = new Set();

  for (const o of observations || []) {
    const key = o.pid + ':' + o.fid;
    const was = prev[key];
    if (!was || Number(was[0]) !== o.minutes) {
      seen[key] = [o.minutes, o.clock];        /* still ticking, reset the mark */
      continue;
    }
    seen[key] = was;
    if (o.clock >= cap) continue;
    if (o.clock - Number(was[1]) >= stall) off.add(o.pid);
  }

  return { track: { seen }, off: Array.from(off) };
}

module.exports = {
  HOLD_MS, SETTLE_MS, OFF_STALL_MINUTES, OFF_MAX_CLOCK,
  liveScope, holdVolatile, observe, trackMinutes,
};
