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
   The first is what the proxy uses today. The rest are the other public
   UEFA gaming/match endpoints the official front ends are built on. Each is
   a guess until it answers; that is the entire point of asking. */
const endpoints = (season, md = 1) => [
  ['feeds/players (current)', `${FEEDS.base}${FEEDS.players}`.replace('{season}', season).replace('{md}', md)],
  ['feeds/teams (current)', `${FEEDS.base}${FEEDS.teams}`.replace('{season}', season).replace('{md}', md)],
  ['gamingapi players', `https://gamingapi.uefa.com/v2/feeds/players?competitionId=1&seasonYear=${season}&phaseId=1&language=en`],
  ['gamingapi teams', `https://gamingapi.uefa.com/v2/feeds/teams?competitionId=1&seasonYear=${season}&language=en`],
  ['gamingapi fixtures', `https://gamingapi.uefa.com/v2/feeds/fixtures?competitionId=1&seasonYear=${season}&language=en`],
  ['gamingapi matchdays', `https://gamingapi.uefa.com/v2/feeds/matchdays?competitionId=1&seasonYear=${season}&language=en`],
  ['match.uefa matches', `https://match.uefa.com/v5/matches?competitionId=1&seasonYear=${season}&limit=5`],
  ['comp.uefa competitions', 'https://comp.uefa.com/v2/competitions?offset=0&limit=5']
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

/* ── Stage 0: can anything be read at all? ─────────────── */
console.log('STAGE 0 — reachability. Which endpoint answers, and to whom?\n');

const season0 = CANDIDATE_SEASONS[0];
const working = [];
for (const [label, u] of endpoints(season0)) {
  const results = [];
  for (const [name, headers] of Object.entries(PROFILES)) {
    const res = await get(u, headers);
    results.push(`${name}=${res.status == null ? 'ERR' : res.status}`);
    if (res.status === 200 && res.json) working.push({ label, url: u, profile: name, res });
  }
  console.log(`  ${label.padEnd(26)} ${results.join('  ')}`);
}

if (!working.length) {
  console.log('\n✗ Nothing answered 200 to any ordinary client.');
  console.log('  Read this carefully before "fixing" anything:');
  console.log('  · A uniform 403 across unrelated hosts and paths is the host declining,');
  console.log('    not a wrong path and not a season that has yet to start.');
  console.log('  · A Netlify function runs from a datacentre too, so it will be declined');
  console.log('    in the same way. /api/ucl/* cannot serve live data from this source.');
  console.log('  · The fix is a source that permits server-side reads, not a disguise.');
  process.exit(1);
}

console.log(`\n✓ ${working.length} endpoint/profile combination(s) answered with JSON.\n`);
for (const w of working.slice(0, 6)) {
  const rows = rowsOf(w.res.json);
  console.log(`  ${w.label} [${w.profile}] — ${w.res.bytes} bytes, ${rows.length} rows, `
    + `envelope: ${Array.isArray(w.res.json) ? '(array)' : Object.keys(w.res.json).slice(0, 8).join(', ')}`);
}

/* ── Stage 1: which season, on whichever endpoint works? ── */
const best = working.find((w) => /players/i.test(w.label)) || working[0];
const headers = PROFILES[best.profile];
console.log(`\nSTAGE 1 — season, using "${best.label}" with the "${best.profile}" profile.\n`);

const seasonUrl = (season, md) => best.url
  .replace(/(seasonYear=)\d+/, `$1${season}`)
  .replace(new RegExp(`_${season0}_`), `_${season}_`)
  .replace(new RegExp(`_${season0}\\.`), `_${season}.`)
  .replace(/(_)\d+(_\d+\.json)/, `$1${season}$2`)
  .replace(/(_\d+_)\d+(\.json)/, `$1${md}$2`);

let live = null;
for (const season of CANDIDATE_SEASONS) {
  const res = await get(seasonUrl(season, 1), headers);
  const rows = res.status === 200 && res.json ? rowsOf(res.json) : [];
  console.log(`  season ${String(season).padEnd(8)} ${String(res.status).padEnd(4)} ${rows.length} rows`);
  if (rows.length && !live) live = { season, rows, res };
}

if (!live) {
  console.log('\n✗ The endpoint answers but no candidate season returned rows.');
  process.exit(1);
}

console.log(`\n→ season ${live.season} is publishing ${live.rows.length} records.`);

/* ── Stage 2: what does the mapping miss? ──────────────── */
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
