/*
 * Euro Matchday Edge — find out what UEFA is actually publishing, and
 * whether this project can read it at all.
 *
 * netlify/functions/ucl.js was written without anyone being able to reach
 * gaming.uefa.com: the sandbox it was written in refuses the host, so its
 * feed paths, its season numbering and every field name in it are inferences
 * from the official game's own front end. Its header has asked for a
 * verification pass ever since. This is that pass, run from a machine that
 * can reach the internet (GitHub Actions can).
 *
 * The first run answered a question nobody had asked: every path returned
 * **403**, for every candidate season, from a GitHub runner. A 403 is not a
 * wrong season number and it is not "not published yet" — it is the host
 * declining. So the probe now starts one step further back and separates the
 * three explanations, because they lead to completely different work:
 *
 *   (a) THE PATH IS WRONG — some other endpoint answers 200. Fix FEEDS.
 *   (b) THE HOST DECLINES ORDINARY CLIENTS — every endpoint 403s no matter
 *       what a normal client sends. Then a Netlify function cannot read this
 *       feed either, and the honest answer is that this app cannot serve
 *       live UCL data from this source. That is a product fact, not a bug to
 *       code around.
 *   (c) IT WANTS HEADERS A BROWSER WOULD SEND ANYWAY — a Referer, a language.
 *       Sending those is ordinary client behaviour and fixes it.
 *
 * The header profiles below are exactly that: what an ordinary browser on
 * the official game's own page sends. This project does not try to look like
 * something it is not — if the answer turns out to be (b), the answer is (b)
 * and the app should say so rather than pretend.
 *
 * Run:  node dev/probe-ucl.mjs [season ...]
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { _internal } = require(join(ROOT, 'netlify/functions/ucl.js'));
const { rowsOf, normPlayer, normTeam, normFixture, unmapped, FEEDS } = _internal;

const SEASONS = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
const CANDIDATE_SEASONS = SEASONS.length ? SEASONS : ['2026', '2027', '202627', '2025'];

/* ── Header profiles ─────────────────────────────────────
   Three, so a 403 can be attributed. Nothing here pretends to be a logged-in
   user or carries a credential; the third is simply what a browser sitting
   on gaming.uefa.com sends when the page fetches its own data. */
const PROFILES = {
  'plain': {
    'User-Agent': 'Mozilla/5.0 (compatible; EuroMatchdayEdge/1.0; +https://gameweekedge.co.uk/euro/)',
    Accept: 'application/json'
  },
  'with-referer': {
    'User-Agent': 'Mozilla/5.0 (compatible; EuroMatchdayEdge/1.0; +https://gameweekedge.co.uk/euro/)',
    Accept: 'application/json',
    'Accept-Language': 'en-GB,en;q=0.9',
    Referer: 'https://gaming.uefa.com/en/uclfantasy/',
    Origin: 'https://gaming.uefa.com'
  },
  'browser': {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-GB,en;q=0.9',
    Referer: 'https://gaming.uefa.com/en/uclfantasy/',
    Origin: 'https://gaming.uefa.com'
  }
};

/* ── Endpoints to try ────────────────────────────────────
   The first two are what the proxy uses today. The rest are UEFA's other
   public football APIs, which are a different estate from the fantasy game
   and — as the first sweep found — behave completely differently: the
   fantasy feeds decline server-side clients outright, while comp.uefa.com
   answers a plain one. So the sweep is broad on purpose. Each entry is a
   guess until it answers; asking is the whole point.

   UEFA's `seasonYear` in these APIs is the year the season ENDS, so a
   2026-27 competition is 2027. Both are tried rather than assumed. */
const endpoints = (season, md = 1) => [
  ['fantasy players (current)', `${FEEDS.base}${FEEDS.players}`.replace('{season}', season).replace('{md}', md)],
  ['fantasy teams (current)', `${FEEDS.base}${FEEDS.teams}`.replace('{season}', season).replace('{md}', md)],
  ['fantasy fixtures (current)', `${FEEDS.base}${FEEDS.fixtures}`.replace('{season}', season).replace('{md}', md)],

  ['comp competitions', 'https://comp.uefa.com/v2/competitions?offset=0&limit=5'],
  ['comp seasons', 'https://comp.uefa.com/v2/seasons?competitionId=1&limit=5'],
  ['comp seasons (nested)', 'https://comp.uefa.com/v2/competitions/1/seasons?limit=5'],
  ['comp teams', `https://comp.uefa.com/v2/teams?competitionId=1&seasonYear=${season}&limit=5`],
  ['comp standings', `https://comp.uefa.com/v2/standings?competitionId=1&seasonYear=${season}`],
  ['comp players', `https://comp.uefa.com/v2/players?competitionId=1&seasonYear=${season}&limit=5`],
  ['comp squads', `https://comp.uefa.com/v2/squads?competitionId=1&seasonYear=${season}&limit=5`],

  ['match v5 (seasonYear)', `https://match.uefa.com/v5/matches?competitionId=1&seasonYear=${season}&limit=5`],
  ['match v5 (no season)', 'https://match.uefa.com/v5/matches?competitionId=1&limit=5'],
  ['match v5 (date range)', 'https://match.uefa.com/v5/matches?competitionId=1&fromDate=2026-09-01&toDate=2026-10-01&limit=5'],
  ['match v2', `https://match.uefa.com/v2/matches?competitionId=1&seasonYear=${season}&limit=5`],
  ['match v5 (offset form)', `https://match.uefa.com/v5/matches?competitionId=1&seasonYear=${season}&offset=0&limit=5&order=ASC`],

  ['stats players', `https://compstats.uefa.com/v1/players?competitionId=1&seasonYear=${season}&limit=5`],
  ['stats teams', `https://compstats.uefa.com/v1/teams?competitionId=1&seasonYear=${season}&limit=5`]
];

async function get(u, headers) {
  const started = Date.now();
  try {
    const r = await fetch(u, { headers, redirect: 'follow' });
    const ms = Date.now() - started;
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* not JSON; status still tells us something */ }
    return {
      status: r.status, ms, bytes: text.length, json,
      type: (r.headers.get('content-type') || '').split(';')[0],
      head: json ? null : text.slice(0, 100).replace(/\s+/g, ' ')
    };
  } catch (err) {
    return { status: null, ms: Date.now() - started, error: err.message };
  }
}

/* ── Stage 0: what is reachable, and to whom? ──────────── */
console.log('STAGE 0 — reachability matrix.\n');

const working = [];
for (const season of CANDIDATE_SEASONS) {
  console.log(`  season ${season}`);
  for (const [label, u] of endpoints(season)) {
    /* Only the first profile for the bulk sweep — the first run established
       that the header profile changes nothing anywhere. The fantasy feeds
       are re-tested under all three because they are the ones that 403. */
    const profiles = /fantasy/.test(label) ? Object.entries(PROFILES) : [['plain', PROFILES.plain]];
    const cells = [];
    for (const [name, headers] of profiles) {
      const res = await get(u, headers);
      const rows = res.status === 200 && res.json ? rowsOf(res.json) : [];
      cells.push(`${name}=${res.status == null ? 'ERR' : res.status}`
        + (rows.length ? `(${rows.length} rows)` : ''));
      if (res.status === 200 && res.json) working.push({ label, url: u, profile: name, res, rows, season });
    }
    console.log(`    ${label.padEnd(28)} ${cells.join('  ')}`);
  }
  console.log('');
}

if (!working.length) {
  console.log('✗ Nothing answered 200 to any ordinary client.');
  console.log('  A uniform refusal across unrelated hosts is the host declining, not a wrong');
  console.log('  path — and a Netlify function is a datacentre client too, so it will be');
  console.log('  declined the same way. The fix is a source that permits server-side reads.');
  process.exit(1);
}

console.log(`✓ ${working.length} endpoint/season combination(s) returned JSON.\n`);
for (const w of working) {
  const sample = w.rows[0] || (Array.isArray(w.res.json) ? null : w.res.json);
  console.log(`  ${w.label} [season ${w.season}] — ${w.rows.length} rows, ${w.res.bytes} bytes`);
  console.log(`     keys: ${sample ? Object.keys(sample).slice(0, 14).join(', ') : '(none)'}`);
  if (sample) console.log(`     first: ${JSON.stringify(sample).slice(0, 260)}`);
}

/* Anything that looks like a player or a fixture is worth a closer look,
   because those are the two the app actually needs. */
const players = working.find((w) => /player|squad/i.test(w.label) && w.rows.length);
const matches = working.find((w) => /match|fixture/i.test(w.label) && w.rows.length);
console.log(`\nPlayer-shaped source: ${players ? players.label : 'NONE FOUND'}`);
console.log(`Fixture-shaped source: ${matches ? matches.label : 'NONE FOUND'}`);

/* A fixture source is the one that matters most — it carries the teams, the
   calendar and the results the match model fits on — so when one answers,
   dump a whole record. Mapping a feed from a truncated sample is how this
   codebase ended up with an unverified normaliser in the first place. */
if (matches) {
  const m = matches.rows[0];
  console.log(`\n── One complete ${matches.label} record ──`);
  console.log(JSON.stringify(m, null, 1).slice(0, 3500));
  console.log('\nHome team object:');
  console.log(JSON.stringify(m.homeTeam, null, 1).slice(0, 900));
  console.log('\nMatchday / phase / status fields:');
  for (const k of ['matchday', 'competitionPhase', 'status', 'matchStatus', 'lineupStatus',
    'kickOffTime', 'fullTimeAt', 'score', 'winner', 'round', 'group', 'leg']) {
    if (m[k] !== undefined) console.log(`  ${k}: ${JSON.stringify(m[k]).slice(0, 300)}`);
  }
  console.log(`\nTotal matches available: fetching count…`);
  const all = await get(matches.url.replace(/limit=\d+/, 'limit=500'), PROFILES.plain);
  console.log(`  limit=500 → ${all.status}, ${all.status === 200 && all.json ? rowsOf(all.json).length : 0} rows`);
}

if (!players) {
  console.log('\nNo player source answered. Without one, the app cannot list "the latest');
  console.log('players" from this estate at all — and inventing them is not an option.');
  process.exit(0);
}

const live = { season: players.season, rows: players.rows, res: players.res };
const best = players;

/* ── Stage 2: what does the mapping miss? ──────────────── */
void best;
const mapped = live.rows.map(normPlayer).filter((e) => e.id != null && e.element_type != null);
console.log(`\nSTAGE 2 — mapping. ${mapped.length} of ${live.rows.length} records map to a player.`);
console.log('\nEvery key upstream sends:');
console.log('  ' + Object.keys(live.rows[0] || {}).sort().join(', '));
console.log('\nKeys the normaliser does NOT read (the work item):');
console.log('  ' + (unmapped(live.rows, 'player').join(', ') || '(none)'));
console.log('\nSample upstream record:');
console.log('  ' + JSON.stringify(live.rows[0]).slice(0, 800));
console.log('\nSame record, normalised:');
console.log('  ' + JSON.stringify(mapped[0] || null));

const nulls = {};
for (const row of mapped) {
  for (const [k, v] of Object.entries(row)) nulls[k] = (nulls[k] || 0) + (v == null ? 1 : 0);
}
const dead = Object.entries(nulls).filter(([, n]) => n === mapped.length).map(([k]) => k);
console.log('\nFields null on EVERY record (the mapping missed these):');
console.log('  ' + (dead.join(', ') || '(none)'));

console.log(`\n✓ Probe complete. Endpoint "${best.label}", profile "${best.profile}", season ${live.season}.`);
void normTeam; void normFixture;
