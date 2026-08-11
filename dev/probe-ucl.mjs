/*
 * Euro Matchday Edge — find out what UEFA is actually publishing.
 *
 * netlify/functions/ucl.js was written without anyone being able to reach
 * gaming.uefa.com: the feed paths, the season numbering and every field name
 * in it are inferences from the official game's own front end. Its header
 * has asked for a verification pass ever since, and this is that pass, run
 * from a machine that can reach the host (GitHub Actions can; the sandbox
 * this was written in cannot).
 *
 * It answers four questions, in order, and stops asking the expensive ones
 * as soon as an earlier answer rules them out:
 *
 *   1. Do the feed paths in FEEDS resolve at all?
 *   2. Which `season` number is the current competition? UEFA's numbering is
 *      not documented anywhere this project can cite, and the proxy's
 *      default is a guess.
 *   3. Which matchdays have a published players file?
 *   4. What is in those records that the normalisers do not read? That list
 *      is the actual work item — a field sitting in `_unmapped` is a number
 *      the app could be using and is not.
 *
 * It writes nothing and changes nothing. Run:
 *     node dev/probe-ucl.mjs                 (needs network access to UEFA)
 *     node dev/probe-ucl.mjs 2027 2026       (probe specific seasons)
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { _internal } = require(join(ROOT, 'netlify/functions/ucl.js'));
const { rowsOf, normPlayer, normTeam, normFixture, unmapped, FEEDS } = _internal;

const UA = 'Mozilla/5.0 (compatible; EuroMatchdayEdge/1.0; +https://gameweekedge.co.uk/euro/)';

/* Candidate season numbers. UEFA has used the starting year of the season in
   these paths; the two-year form is included because it is the other obvious
   convention and one request settles it. Ordered most-likely first. */
const SEASONS = process.argv.slice(2).length ? process.argv.slice(2)
  : ['2026', '2027', '202627', '2025'];

const url = (tpl, season, md) =>
  FEEDS.base + tpl.replace('{season}', season).replace('{md}', md);

async function get(u) {
  const started = Date.now();
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    const ms = Date.now() - started;
    const type = r.headers.get('content-type') || '';
    if (!r.ok) return { ok: false, status: r.status, ms, type };
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); }
    catch (_) {
      return { ok: false, status: r.status, ms, type, error: 'not JSON', head: text.slice(0, 120) };
    }
    return { ok: true, status: r.status, ms, type, json, bytes: text.length };
  } catch (err) {
    return { ok: false, status: null, ms: Date.now() - started, error: err.message };
  }
}

const line = (label, res, extra = '') => {
  const status = res.status == null ? 'ERR' : res.status;
  console.log(`  ${label.padEnd(34)} ${String(status).padEnd(4)} ${String(res.ms + 'ms').padEnd(7)}`
    + `${res.ok ? extra : (res.error || '')}`);
};

console.log(`Base: ${FEEDS.base}`);
console.log(`Seasons to try: ${SEASONS.join(', ')}\n`);

/* ── 1 & 2. Which season is live? Teams and fixtures are one request each
   and do not depend on a matchday, so they are the cheap way to find out. */
let live = null;
for (const season of SEASONS) {
  console.log(`Season ${season}`);
  const teams = await get(url(FEEDS.teams, season, 1));
  const teamRows = teams.ok ? rowsOf(teams.json) : [];
  line('teams', teams, `${teamRows.length} rows`);

  const fixtures = await get(url(FEEDS.fixtures, season, 1));
  const fixtureRows = fixtures.ok ? rowsOf(fixtures.json) : [];
  line('fixtures', fixtures, `${fixtureRows.length} rows`);

  if (teamRows.length || fixtureRows.length) {
    live = { season, teams, teamRows, fixtures, fixtureRows };
    console.log(`  → season ${season} is publishing.\n`);
    break;
  }
  console.log('');
}

if (!live) {
  console.log('✗ No candidate season returned any teams or fixtures.');
  console.log('  Either the paths in FEEDS are wrong, or the host is refusing this client.');
  console.log('  Nothing here should be taken as evidence that the app is fine.');
  process.exit(1);
}

/* ── 3. Which matchdays have a players file? ─────────────
   The league phase is eight matchdays; anything beyond is the knockout
   bracket, which numbers differently and is a separate question. */
console.log(`Players files for season ${live.season}`);
const published = [];
for (let md = 1; md <= 8; md++) {
  const res = await get(url(FEEDS.players, live.season, md));
  const rows = res.ok ? rowsOf(res.json) : [];
  const mapped = rows.map(normPlayer).filter((e) => e.id != null && e.element_type != null);
  line(`players md${md}`, res, `${rows.length} rows, ${mapped.length} mapped`);
  if (rows.length) published.push({ md, rows, mapped, res });
}

if (!published.length) {
  console.log('\n✗ Teams/fixtures publish but no players file does.');
  console.log('  The players path is the one to fix — the others are right.');
  process.exit(1);
}

/* ── 4. What are we throwing away? ───────────────────────
   The most recent published matchday is the one the app should be reading,
   so it is the one worth inspecting. */
const latest = published[published.length - 1];
console.log(`\nLatest published matchday: ${latest.md} (${latest.rows.length} players)`);

const envelope = Array.isArray(latest.res.json) ? '(bare array)'
  : Object.keys(latest.res.json || {}).join(', ');
console.log(`Envelope keys: ${envelope}`);

console.log('\nPlayer record — every key upstream sends:');
console.log('  ' + Object.keys(latest.rows[0] || {}).sort().join(', '));
console.log('\nPlayer keys the normaliser does NOT read (these are the work item):');
console.log('  ' + (unmapped(latest.rows, 'player').join(', ') || '(none)'));

console.log('\nSample upstream player:');
console.log('  ' + JSON.stringify(latest.rows[0]).slice(0, 700));
console.log('\nSame player, normalised:');
console.log('  ' + JSON.stringify(latest.mapped[0]));

/* How much of the mapping actually resolved, field by field. A field that is
   null on every single player is a mapping that missed, not a feed that is
   quiet — and the difference matters because nulls flow into projections. */
const nullRate = {};
for (const row of latest.mapped) {
  for (const [k, v] of Object.entries(row)) {
    nullRate[k] = (nullRate[k] || 0) + (v == null ? 1 : 0);
  }
}
console.log('\nFields null on EVERY player (i.e. the mapping missed):');
const dead = Object.entries(nullRate)
  .filter(([, n]) => n === latest.mapped.length).map(([k]) => k);
console.log('  ' + (dead.join(', ') || '(none — every field resolved for someone)'));

const partial = Object.entries(nullRate)
  .filter(([, n]) => n > 0 && n < latest.mapped.length)
  .map(([k, n]) => `${k} ${Math.round((n / latest.mapped.length) * 100)}%`);
console.log('Fields null for SOME players (may be legitimate):');
console.log('  ' + (partial.join(', ') || '(none)'));

/* Teams and fixtures, same treatment but shorter — they are simpler records
   and a wrong team id shows up immediately as a blank name on screen. */
console.log('\nTeam keys not read: ' + (unmapped(live.teamRows, 'team').join(', ') || '(none)'));
console.log('Sample team normalised: '
  + JSON.stringify(live.teamRows.length ? normTeam(live.teamRows[0]) : null));
console.log('Fixture keys not read: ' + (unmapped(live.fixtureRows, 'fixture').join(', ') || '(none)'));
console.log('Sample fixture normalised: '
  + JSON.stringify(live.fixtureRows.length ? normFixture(live.fixtureRows[0]) : null));

/* The matchday the app should default to, and why. */
const fixturesByMd = {};
for (const f of live.fixtureRows.map(normFixture)) {
  if (f.event == null) continue;
  fixturesByMd[f.event] = fixturesByMd[f.event] || { total: 0, finished: 0 };
  fixturesByMd[f.event].total += 1;
  if (f.finished) fixturesByMd[f.event].finished += 1;
}
console.log('\nFixtures by matchday (finished/total):');
console.log('  ' + (Object.entries(fixturesByMd)
  .map(([md, c]) => `${md}: ${c.finished}/${c.total}`).join('  ') || '(no matchday field resolved)'));

console.log(`\n✓ Probe complete. Season ${live.season}, `
  + `matchdays published: ${published.map((p) => p.md).join(', ')}.`);
