/* Gameweek Edge — the price feed's memory, kept by the hourly push sender.

   FPL publishes transfer counts and prices as they stand now and nothing
   about how they got there. The hourly sender already reads the bootstrap
   every hour, so it is the one place a history can be written down without
   a second fetch. Two records, both in gwedge_push_state:

   price_flow  the last FLOW_KEEP hourly samples of every player's
               transfers in and out this gameweek, so hour-on-hour deltas
               can be read back as momentum
   price_log   the price changes seen, by the day they were seen

   Everything here is pure and shared with dev/test-price-feed.mjs. The
   public read (netlify/functions/price-feed.js) turns the samples into
   deltas with flowDeltas so the browser never sees raw counters. */

const FLOW_KEEP = 25;   /* hourly samples: 24 hour-on-hour deltas */
const LOG_DAYS = 60;

/* Append one hourly sample. Arrays stay aligned to `ts`: a player joining
   late is padded with nulls behind, one missing from this sample gets a
   null in front, and a player with no sample left is dropped. */
function recordFlow(prev, elements, nowIso, keep) {
  const k = Math.max(2, keep || FLOW_KEEP);
  const ts = Array.isArray(prev && prev.ts) ? prev.ts.slice() : [];
  const io = {};
  const prevIo = (prev && prev.io) || {};
  for (const id of Object.keys(prevIo)) io[id] = Array.isArray(prevIo[id]) ? prevIo[id].slice() : [];
  ts.push(nowIso);
  const seen = new Set();
  for (const e of elements || []) {
    if (!e || e.id == null) continue;
    const id = String(e.id);
    seen.add(id);
    const arr = io[id] || [];
    while (arr.length < ts.length - 1) arr.unshift(null);
    arr.push([Number(e.transfers_in_event) || 0, Number(e.transfers_out_event) || 0]);
    io[id] = arr;
  }
  for (const id of Object.keys(io)) {
    if (!seen.has(id)) { while (io[id].length < ts.length) io[id].push(null); }
  }
  const drop = Math.max(0, ts.length - k);
  const out = { ts: ts.slice(drop), io: {} };
  for (const id of Object.keys(io)) {
    const a = io[id].slice(drop);
    if (a.some((x) => x)) out.io[id] = a;
  }
  return out;
}

/* Samples become hour-on-hour net deltas: (in now − in then) − (out now −
   out then). A counter that went DOWN is a deadline having passed inside
   that hour (the game resets both to zero), and a missing sample is a
   missing sample; either is a null rather than a made-up number. Players
   whose deltas are all zero or null are left out of the answer. */
function flowDeltas(state) {
  const ts = Array.isArray(state && state.ts) ? state.ts : [];
  const io = (state && state.io) || {};
  const out = { ts: ts.slice(1), net: {} };
  for (const id of Object.keys(io)) {
    const a = Array.isArray(io[id]) ? io[id] : [];
    const d = [];
    let any = false;
    for (let i = 1; i < ts.length; i++) {
      const p = a[i - 1], c = a[i];
      if (!p || !c || c[0] < p[0] || c[1] < p[1]) { d.push(null); continue; }
      const v = (c[0] - p[0]) - (c[1] - p[1]);
      d.push(v);
      if (v !== 0) any = true;
    }
    if (any) out.net[id] = d;
  }
  return out;
}

/* Add the changes seen this run to the day they were seen. A change is
   {id, n (name), t (club short name), p (position), from, to} in tenths
   of a million, the unit the game uses. The same change seen twice in a
   day (the sender runs hourly) is written once. Days beyond LOG_DAYS fall
   off the front. */
function recordChanges(prevLog, changes, day, keepDays) {
  const days = {};
  const prevDays = (prevLog && prevLog.days) || {};
  for (const d of Object.keys(prevDays)) days[d] = Array.isArray(prevDays[d]) ? prevDays[d].slice() : [];
  const list = days[day] || [];
  const have = new Set(list.map((r) => r.id + ':' + r.from + ':' + r.to));
  for (const c of changes || []) {
    if (!c || c.id == null || !Number.isFinite(Number(c.from)) || !Number.isFinite(Number(c.to))) continue;
    const key = c.id + ':' + c.from + ':' + c.to;
    if (have.has(key)) continue;
    have.add(key);
    list.push({ id: c.id, n: String(c.n || ''), t: String(c.t || ''), p: c.p == null ? null : Number(c.p), from: Number(c.from), to: Number(c.to) });
  }
  days[day] = list;
  const k = Math.max(1, keepDays || LOG_DAYS);
  const keys = Object.keys(days).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-k);
  const out = { days: {} };
  keys.forEach((d) => { out.days[d] = days[d]; });
  return out;
}

module.exports = { FLOW_KEEP, LOG_DAYS, recordFlow, flowDeltas, recordChanges };
