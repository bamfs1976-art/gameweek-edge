/*
 * Is the DATA current, or is the site confidently serving something stale?
 *
 * dev/site-check.mjs asks whether the routes answer. They can all answer 200
 * and the site still be wrong, because every failure that has actually bitten
 * this project was quiet:
 *
 *   · football-data had never once worked in production. Nothing complained,
 *     because "no referee this week" is what a working feed looks like on a
 *     quiet week.
 *   · the key was then set and it STILL did not work, because Netlify only
 *     picks up environment changes on a new deploy. Same 503, different
 *     cause, indistinguishable from outside.
 *   · four of five European qualifications were missing from the briefing.
 *     A missing fact reads exactly like a fact that does not apply.
 *
 * This grades three things separately and says which one failed:
 *   REACHABLE — did it answer at all
 *   SHAPED    — does the answer have the fields we read
 *   FRESH     — does it describe NOW, rather than last season
 *
 * The judgement lives in scripts/freshness-rules.mjs so it can be tested
 * without a network. This file only fetches and formats.
 *
 * Run:  node dev/freshness-check.mjs [https://origin]
 * CI:   the "Freshness" workflow, daily — the sandbox cannot reach
 *       gameweekedge.co.uk.
 */
import {
  gradeBootstrap, gradeFixtures, gradeEfl, gradeCongestion,
  gradeFootballData, gradePublished, failures
} from '../scripts/freshness-rules.mjs';

const ORIGIN = (process.argv[2] || process.env.SITE_ORIGIN || 'https://gameweekedge.co.uk')
  .replace(/\/$/, '');
const UA = 'Mozilla/5.0 (compatible; GameweekEdgeFreshness/1.0; +https://gameweekedge.co.uk)';
const NOW = Date.now();

/* Same retry rule as the site check, and for the same reason: a dropped
   connection is not a stale feed, and reporting one as the other is how a
   check loses the credibility it needs on the morning something is really
   wrong. Thrown requests only — a bad status is an answer, not a blip. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(1500 * attempt);
    try {
      const res = await fetch(ORIGIN + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' }, redirect: 'manual'
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    } catch (err) { last = err; }
  }
  return { status: 0, body: null, err: last && last.message };
}

/* Whether the cups have started decides whether an empty congestion feed is
   correct or alarming, and it is derivable rather than a hand-set date: if
   any club has a European or cup match already played this season, the
   competitions are running. Asked of the same endpoint over a wide window. */
async function cupsStarted() {
  const { body } = await get('/api/euro-fixtures?from=1&n=10');
  return ((body && body.rows) || []).some((r) => r.finished);
}

const results = [];
const add = (name, graded) => results.push({ name, ...graded });

add('FPL bootstrap', gradeBootstrap(await get('/api/fpl/bootstrap-static'), NOW));
add('FPL fixtures', gradeFixtures(await get('/api/fpl/fixtures'), NOW));
add('Fantasy EFL feed', gradeEfl(await get('/api/efl/health')));
add('Congestion dataset',
  gradeCongestion(await get('/api/euro-fixtures?from=1&n=6'), await cupsStarted()));
add('football-data', gradeFootballData(await get('/api/football-data/matchday?competition=PL'), NOW));

/* stampKeys names the field that reflects the THING, not the file. See the
   note in gradePublished: record.json's generatedAt is stamped on every site
   build, so watching it measured how recently we deployed and would never
   have gone stale. ledgerUpdatedAt is when a round was last recorded or
   graded, which is what this is meant to notice stopping. */
for (const [label, path, staleDays, why, stampKeys] of [
  ['EFL model record', '/fantasy-efl/data/record.json', 21,
    'the ledger records before each round and grades after it; three weeks quiet means the job stopped',
    ['ledgerUpdatedAt']],
  ['FPL history bundle', '/data/fpl-history.json', 60,
    'rebuilt occasionally, so this is a loose backstop rather than a heartbeat',
    ['built', 'generatedAt']]
]) {
  add(label, gradePublished(await get(path), { staleDays, why, stampKeys }, NOW));
}

console.log(`Freshness — ${ORIGIN}\n`);
const mark = { ok: '✓', note: '·', fail: '✗' };
for (const r of results) {
  console.log(`  ${mark[r.verdict]} ${r.name.padEnd(20)} ${r.detail}`);
  if (r.why && r.verdict !== 'ok') console.log(`      ${r.why}`);
}

const failed = failures(results);
const notes = results.filter((r) => r.verdict === 'note');
console.log('');
if (notes.length) {
  console.log(`  ${notes.length} note(s) — true today, not a fault. Each says when it becomes one.`);
}
console.log(failed.length
  ? `✗ ${failed.length} source(s) stale or broken.`
  : '✓ Every source is answering with current data.');
process.exit(failed.length ? 1 : 0);
