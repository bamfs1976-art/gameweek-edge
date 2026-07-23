/* Gameweek Edge — prediction-logger health check (season-open readiness).
   Answers one operational question: is the game open yet, and is the hourly
   log-predictions function actually writing forecasts for the current
   season? Reads the FPL bootstrap for the season + upcoming gameweek, and
   gwedge_predictions (service role) for what has been logged. No user data.
   Served publicly so the Model Accountability page can show logger status,
   and callable on demand to confirm the first writes land once 2026/27
   kicks off.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Degrades gracefully. */

const UA = 'GameweekEdge/1.0 (+https://gameweekedge.co.uk)';
const json = (o, maxAge) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + (maxAge || 900) },
  body: JSON.stringify(o),
});
const fplGet = (p) => fetch('https://fantasy.premierleague.com/api/' + p, { headers: { 'User-Agent': UA, Accept: 'application/json' } }).then((r) => r.json());

/* Season label from the earliest deadline (Aug Y -> "Y/Y+1"), matching the
   logger so the health read lines up with what gets written. */
function seasonLabel(events) {
  let ms = Infinity;
  for (const e of events || []) { const t = Date.parse(e.deadline_time); if (Number.isFinite(t) && t < ms) ms = t; }
  if (!Number.isFinite(ms)) return 'unknown';
  const y = new Date(ms).getUTCFullYear();
  return y + '/' + String((y + 1) % 100).padStart(2, '0');
}

/* Pure: decide logger health from the bootstrap, the per-season prediction
   stats, and the current time. stats is { [season]: {n, graded, lastWrite} }.
     logging         predictions exist for the live season — all good
     between-seasons no upcoming gameweek yet (game not launched)
     preseason       upcoming GW is >10 days out; logger starts as it nears
     expected-soon   deadline within 10 days but nothing logged yet
     stale           deadline has passed with nothing logged — likely failing
   Only `stale` is unhealthy; the rest are expected states on the calendar. */
function computeHealth(boot, stats, nowMs) {
  const events = (boot && boot.events) || [];
  const season = seasonLabel(events);
  const upcoming = events.find((e) => !e.finished) || null;
  const deadlineMs = upcoming ? Date.parse(upcoming.deadline_time) : null;
  const cur = (stats && stats[season]) || { n: 0, graded: 0, lastWrite: null };
  const DAY = 86400000, ahead = deadlineMs != null && deadlineMs > nowMs;
  let status, detail;
  if (cur.n > 0) {
    status = 'logging';
    detail = cur.n + ' predictions logged for ' + season + (cur.graded ? ' (' + cur.graded + ' graded)' : '') + '.';
  } else if (!upcoming) {
    status = 'between-seasons';
    detail = 'No upcoming gameweek yet — the new game has not launched, so there is nothing to log.';
  } else if (ahead && deadlineMs - nowMs > 10 * DAY) {
    status = 'preseason';
    detail = 'GW' + upcoming.id + ' is more than 10 days away; the logger begins as the deadline nears.';
  } else if (ahead) {
    status = 'expected-soon';
    detail = 'GW' + upcoming.id + ' opens within 10 days but nothing is logged yet — writes should begin within the hour.';
  } else {
    status = 'stale';
    detail = 'GW' + upcoming.id + ' deadline has passed with no predictions logged — the hourly logger may be failing.';
  }
  return {
    status, healthy: status !== 'stale', season, detail,
    upcomingGw: upcoming ? upcoming.id : null,
    deadline: upcoming ? upcoming.deadline_time : null,
    predictions: cur.n, graded: cur.graded, lastWrite: cur.lastWrite || null,
    checkedAt: new Date(nowMs).toISOString(),
  };
}

exports.handler = async () => {
  let boot;
  try { boot = await fplGet('bootstrap-static/'); }
  catch (_) { return json({ status: 'fpl-unavailable', healthy: false }, 120); }

  const supaUrl = process.env.SUPABASE_URL, supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return json({ status: 'not-configured', healthy: false, season: seasonLabel((boot || {}).events) }, 120);

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
  const { data, error } = await sb.from('gwedge_predictions').select('season,actual,created_at').limit(50000);
  if (error) return json({ status: 'db-error', healthy: false, season: seasonLabel(boot.events) }, 120);

  const stats = {};
  for (const r of data || []) {
    const s = stats[r.season] = stats[r.season] || { n: 0, graded: 0, lastWrite: null };
    s.n++; if (r.actual != null) s.graded++;
    if (!s.lastWrite || r.created_at > s.lastWrite) s.lastWrite = r.created_at;
  }
  return json(computeHealth(boot, stats, Date.now()), 900);
};

module.exports.computeHealth = computeHealth;
module.exports.seasonLabel = seasonLabel;
