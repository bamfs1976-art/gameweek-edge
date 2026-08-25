/*
 * When does the app's idea of "the gameweek to plan for" actually move on?
 *
 * The app anchors every planning surface on b.upcoming — the first event
 * with finished === false — and caches bootstrap for twelve hours. Both
 * of those are assumptions about FPL's clock, and the complaint is that
 * the app keeps showing a gameweek whose games have all been played.
 *
 * So measure the three clocks against each other, per event:
 *
 *   finished / data_checked   what bootstrap says about the event
 *   fixtures all over         what the FIXTURES endpoint says about its games
 *   last kickoff + ~2h        when the football actually stopped
 *
 * The gap between column two and column one is the window in which a
 * planning tool anchored on `finished` is pointing at a gameweek that is
 * over. If that gap is real, `finished` is the wrong anchor.
 *
 * RUN IT FROM A RUNNER, not from here. fantasy.premierleague.com is
 * unreachable from the build sandbox — it answered connection-refused on
 * 24 Aug 2026 and 403 at the egress proxy the next day — so this is wired
 * into .github/workflows/fpl-endpoints.yml and dispatched. That is the
 * only place its output counts as a measurement.
 *
 * Run: node dev/fpl-gw-rollover.mjs
 */
const BASE = 'https://fantasy.premierleague.com/api';
const UA = 'Mozilla/5.0 (compatible; GameweekEdgeProbe/1.0)';
const get = async (p) => {
  const r = await fetch(BASE + p, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(p + ' → ' + r.status);
  return r.json();
};
const yn = (v) => (v ? 'yes' : 'no ');
const when = (ms) => (ms == null || !Number.isFinite(ms) ? '—' : new Date(ms).toISOString().slice(5, 16).replace('T', ' '));

const boot = await get('/bootstrap-static/');
const fixtures = await get('/fixtures/');
const now = Date.now();
console.log('now (UTC): ' + new Date(now).toISOString().slice(0, 16).replace('T', ' '));
console.log('');

/* The app's two anchors, reproduced exactly as index.html derives them. */
const cur = boot.events.find((e) => e.is_current) || boot.events.find((e) => e.is_next) || boot.events[boot.events.length - 1];
const upcoming = boot.events.find((e) => !e.finished) || null;
console.log('b.cur      = GW' + (cur ? cur.id : '—') + '   (is_current, else is_next)');
console.log('b.upcoming = GW' + (upcoming ? upcoming.id : '—') + '   (first !finished — what the planners use)');
console.log('');

/* Same rule the app uses to call a single fixture over. */
const fixtureOver = (f) => !!(f.finished || f.finished_provisional);

const byEvent = {};
for (const f of fixtures) {
  if (!f.event) continue;
  (byEvent[f.event] = byEvent[f.event] || []).push(f);
}

const ids = Object.keys(byEvent).map(Number).sort((a, c) => a - c);
const interesting = ids.filter((id) => {
  const e = boot.events.find((x) => x.id === id);
  return e && (!e.finished || id >= (cur ? cur.id : 1) - 2);
}).slice(0, 6);

console.log('GW  finished  checked  fixtures-over  last-kickoff        verdict');
for (const id of interesting) {
  const e = boot.events.find((x) => x.id === id);
  const games = byEvent[id];
  const over = games.filter(fixtureOver).length;
  const allOver = over === games.length;
  const lastKo = games.reduce((m, f) => {
    const t = Date.parse(f.kickoff_time);
    return Number.isFinite(t) && (m == null || t > m) ? t : m;
  }, null);
  /* The disagreement worth naming: the football is done but bootstrap has
     not said so, which is precisely when a planner shows a dead gameweek. */
  let verdict = '';
  if (allOver && !e.finished) verdict = '*** ALL GAMES OVER, event NOT finished ***';
  else if (!allOver && e.finished) verdict = 'event finished ahead of its fixtures';
  else if (allOver) verdict = 'settled';
  else if (over > 0) verdict = 'in progress (' + over + '/' + games.length + ' over)';
  else verdict = 'not started';
  console.log(
    String(id).padEnd(4),
    yn(e.finished).padEnd(9),
    yn(e.data_checked).padEnd(8),
    (over + '/' + games.length).padEnd(14),
    when(lastKo).padEnd(19),
    verdict
  );
}

console.log('');
/* What a fixtures-derived anchor would say instead. */
const firstLive = ids.find((id) => byEvent[id].some((f) => !fixtureOver(f)));
console.log('first GW with an unplayed fixture = GW' + (firstLive == null ? '—' : firstLive));
console.log('planners currently anchor on      = GW' + (upcoming ? upcoming.id : '—'));
if (firstLive != null && upcoming && firstLive !== upcoming.id) {
  console.log('DISAGREEMENT: the planners are ' + (upcoming.id - firstLive) + ' gameweek(s) off the football.');
} else {
  console.log('The two agree right now — which does not mean they always will; see the table.');
}
