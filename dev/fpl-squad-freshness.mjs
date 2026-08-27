/*
 * Is the player list the app shows the player list FPL is publishing?
 *
 * Asked during a busy transfer window: "lots of confirmed transfers, can we
 * make sure the players have been updated from the API". That is two
 * questions wearing one coat, and they have different answers:
 *
 *   1. Does the live feed carry the moves?  ← this script
 *   2. Does the copy in someone's browser?  ← the TTL, measured below
 *
 * Every player, club and price in the app comes from bootstrap-static and
 * nothing is committed to the repo, so (1) is entirely FPL's to get right
 * and (2) is entirely ours. This prints the evidence for both: what the feed
 * says about recent squad movement, and how big the payload is, because the
 * size is the whole argument for the cache that makes it stale.
 *
 * RUN IT FROM A RUNNER. fantasy.premierleague.com is unreachable from the
 * build sandbox, so this is wired into .github/workflows/fpl-endpoints.yml.
 *
 * Run: node dev/fpl-squad-freshness.mjs
 */
import zlib from 'node:zlib';

const BASE = 'https://fantasy.premierleague.com/api';
const UA = 'Mozilla/5.0 (compatible; GameweekEdgeProbe/1.0)';

const res = await fetch(BASE + '/bootstrap-static/', {
  headers: { 'User-Agent': UA, Accept: 'application/json' },
});
if (!res.ok) { console.error('bootstrap-static → ' + res.status); process.exit(1); }
const raw = await res.text();
const boot = JSON.parse(raw);

const els = boot.elements || [];
const teams = {};
(boot.teams || []).forEach((t) => { teams[t.id] = t.short_name || t.name; });
const T = (id) => teams[id] || ('team ' + id);
const POS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD', 5: 'MNG' };

console.log('PAYLOAD');
console.log('  ' + (raw.length / 1024).toFixed(0) + 'KB of JSON, '
  + els.length + ' players across ' + (boot.teams || []).length + ' clubs');

/* WHAT A PHONE ACTUALLY DOWNLOADS, which is the only size the cache decision
   turns on. The raw JSON figure above is the tempting one and it is wrong by
   a large factor, because the app fetches through our own proxy and that
   compresses.

   MEASURING IT IS FIDDLIER THAN IT LOOKS, and the first attempt here got it
   wrong in a way worth recording: it fetched with an explicit
   Accept-Encoding and reported `(await r.arrayBuffer()).byteLength`. Node's
   fetch decompresses transparently, so that returns the DECODED length —
   1590KB, identical to the raw JSON — while the content-encoding header sat
   there saying `br`. The run printed a compressed-looking measurement that
   was the uncompressed number, which is exactly the error the step was
   added to correct, one layer down.

   So: content-length off the wire where the server sends it, which is the
   real transferred size, plus a local compression of the same bytes as a
   floor-to-ceiling estimate. Two independent numbers rather than one
   confident one. */
const SITE = (process.env.GWE_BASE || 'https://gameweekedge.co.uk').replace(/\/$/, '');
for (const enc of ['br', 'gzip']) {
  try {
    const r = await fetch(SITE + '/api/fpl/bootstrap-static', {
      headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Encoding': enc },
    });
    const len = r.headers.get('content-length');
    console.log('  proxy, Accept-Encoding: ' + enc.padEnd(6)
      + (r.ok ? (len ? (Number(len) / 1024).toFixed(0) + 'KB transferred' : 'content-length not sent (chunked)')
        : 'HTTP ' + r.status)
      + '   served as: ' + (r.headers.get('content-encoding') || 'identity'));
  } catch (e) { console.log('  proxy, Accept-Encoding: ' + enc.padEnd(6) + 'unreachable — ' + (e && e.message)); }
}
const buf = Buffer.from(raw);
console.log('  compressing these bytes here: '
  + (zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }).length / 1024).toFixed(0)
  + 'KB brotli(q5), '
  + (zlib.gzipSync(buf, { level: 6 }).length / 1024).toFixed(0) + 'KB gzip(6)');
console.log('  ^ THIS is what the 12-hour client cache exists to avoid re-fetching,');
console.log('    not the 1590KB above.');
console.log('');

/* WHICH FIELDS EXIST. Printed rather than assumed: a probe that reads a key
   the feed stopped sending reports "no recent joiners" in exactly the voice
   it would use for a quiet window, and the two are not the same finding. */
const keys = Object.keys(els[0] || {});
const has = (k) => keys.includes(k);
console.log('SQUAD-MOVEMENT FIELDS the feed carries:');
['team', 'team_code', 'status', 'news', 'news_added', 'team_join_date', 'has_temporary_code', 'opta_code']
  .forEach((k) => console.log('  ' + k.padEnd(20) + (has(k) ? 'present' : 'ABSENT — nothing here can be read from it')));
console.log('');

/* NEWLY ADDED PLAYERS. FPL appends, so a high id is a late arrival: a player
   who did not exist in the game when the season's list was first published.
   That makes id order the closest thing the feed has to a joining order. */
const byId = els.slice().sort((a, b) => b.id - a.id).slice(0, 20);
console.log('THE 20 NEWEST RECORDS IN THE GAME (highest ids = added most recently):');
byId.forEach((e) => {
  console.log('  #' + String(e.id).padStart(4) + '  ' + (e.web_name || '').padEnd(20)
    + (POS[e.element_type] || '?').padEnd(5) + T(e.team).padEnd(5)
    + '£' + (e.now_cost / 10).toFixed(1)
    + (has('team_join_date') && e.team_join_date ? '  joined ' + e.team_join_date : ''));
});
console.log('');

if (has('team_join_date')) {
  /* The direct answer, where the feed gives one. A join date inside the
     window IS a confirmed transfer as far as FPL is concerned. */
  const joined = els.filter((e) => e.team_join_date)
    .sort((a, b) => String(b.team_join_date).localeCompare(String(a.team_join_date)))
    .slice(0, 25);
  console.log('THE 25 MOST RECENT JOIN DATES:');
  joined.forEach((e) => console.log('  ' + e.team_join_date + '  ' + (e.web_name || '').padEnd(20)
    + (POS[e.element_type] || '?').padEnd(5) + T(e.team)));
  console.log('');
}

/* NEWS IS THE FEED'S CLOCK. news_added is the only per-player timestamp
   bootstrap carries, so the newest ones say when this data last moved —
   which is what "has it been updated" is really asking. */
if (has('news_added')) {
  const news = els.filter((e) => e.news_added)
    .sort((a, b) => String(b.news_added).localeCompare(String(a.news_added)));
  console.log('THE FEED\'S OWN CLOCK — 15 most recent news_added stamps:');
  news.slice(0, 15).forEach((e) => console.log('  ' + String(e.news_added).replace('T', ' ').slice(0, 16)
    + '  ' + (e.web_name || '').padEnd(18) + T(e.team).padEnd(5) + (e.news || '').slice(0, 60)));
  const newest = news[0] && news[0].news_added;
  if (newest) {
    const ageH = (Date.now() - Date.parse(newest)) / 3600e3;
    console.log('');
    console.log('  Most recent change: ' + ageH.toFixed(1) + ' hours ago.');
    console.log('  A browser holding a 12-hour-old copy would be missing everything after it.');
  }
  console.log('');
}

/* DEPARTURES. FPL marks a player who has left the league unavailable rather
   than deleting the record, so status is where an outgoing transfer shows up. */
const ST = { a: 'available', d: 'doubtful', i: 'injured', s: 'suspended', u: 'unavailable', n: 'not in squad' };
const byStatus = {};
els.forEach((e) => { byStatus[e.status] = (byStatus[e.status] || 0) + 1; });
console.log('STATUS SPREAD (an outgoing transfer lands as "unavailable", not a deletion):');
Object.keys(byStatus).sort().forEach((s) => console.log('  ' + (ST[s] || s).padEnd(14) + String(byStatus[s]).padStart(4)));
console.log('');

/* SQUAD SIZES. A club that lost players and gained none looks thin here, and
   a count far outside the plausible range is the feed being wrong rather
   than the window being busy. Reported, not judged. */
const perTeam = {};
els.forEach((e) => { perTeam[e.team] = (perTeam[e.team] || 0) + 1; });
const counts = Object.keys(perTeam).map((id) => ({ t: T(Number(id)), n: perTeam[id] }))
  .sort((a, b) => a.n - b.n);
console.log('PLAYERS PER CLUB (thinnest first):');
counts.forEach((c) => console.log('  ' + c.t.padEnd(6) + String(c.n).padStart(3)));
console.log('');
console.log('Every name above is live from bootstrap-static. Nothing in this repo');
console.log('carries a player list, so what the app shows is this feed, delayed by');
console.log('however long its cache says.');
