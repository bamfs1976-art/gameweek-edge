/*
 * Gameweek Edge — does the DEPLOYED site still keep its promises?
 *
 * Everything else in dev/ grades the source. This grades the thing users
 * actually hit: the built HTML, the redirects in netlify.toml, the
 * serverless routes, and the service worker that is already installed on
 * people's phones. Those can only be wrong after a deploy, which is exactly
 * when nobody is looking.
 *
 * It exists because the sandbox this project is written in cannot reach
 * gameweekedge.co.uk — the egress proxy refuses it — so "I checked the
 * redirect" was not a claim anyone here could make. A GitHub runner can.
 *
 * Run:  node dev/site-check.mjs [https://origin]
 * CI:   the "Site check" workflow (dispatch, and after a deploy)
 */
const ORIGIN = (process.argv[2] || process.env.SITE_ORIGIN || 'https://gameweekedge.co.uk')
  .replace(/\/$/, '');

/* Each check states the promise in the same words the commit message did.
   `redirect` means: answer 3xx and point at this, without following. */
const CHECKS = [
  { path: '/', status: 200, why: 'the front door' },
  { path: '/fantasy-efl/', status: 200, why: 'Fantasy EFL dashboard' },
  { path: '/fantasy-efl/fixtures/', status: 200, why: 'fixture ticker' },
  { path: '/fantasy-efl/players/', status: 200, why: 'player finder' },
  { path: '/fantasy-efl/clubs/', status: 200, why: 'club picker' },
  { path: '/fantasy-efl/record/', status: 200, why: 'the model\'s record' },
  { path: '/fantasy-efl/how-to-play/', status: 200, why: 'the guide' },

  /* The retired app. These URLs were public, so they must not 404. */
  { path: '/euro/', redirect: '/', why: 'retired Euro app → front door' },
  { path: '/euro/index.html', redirect: '/', why: 'retired Euro shell → front door' },
  { path: '/euro/engine.js', redirect: '/', why: 'retired engine bundle → front door' },
  { path: '/api/ucl/bootstrap-static', redirect: '/', why: 'retired UCL proxy → front door' },

  { path: '/api/efl/health', status: [200, 503], json: true, why: 'the EFL feed health check' },

  /* The enrichment layer, added 18 Aug 2026. Also THIS deploy's proof: the
     MARKER below lives in index.html, and index.html did not change in this
     release, so a marker check cannot tell this build from the last one. A
     new ROUTE can. 503 is allowed because it is the endpoint's honest answer
     when the official FPL feed is unreachable — that is a working endpoint
     reporting a bad upstream, not a broken deploy. */
  { path: '/api/enrich?players=1&news=0', status: [200, 503], json: true,
    why: 'the enrichment endpoint (new 18 Aug)' },

  /* Added 11 Aug 2026, and it failed for three mornings running. Found by
     accident — a probe chasing something unrelated got a 503 back from this
     endpoint saying "FOOTBALL_DATA_KEY is not configured". The key was not
     set on the deployed site, so this function had never once been able to
     succeed there, and it is the FPL app's only referee source and one of
     its two midweek-fixture sources.

     It is checked here rather than written down somewhere, because the
     reason it went unnoticed for so long is that nothing looked. Adding an
     exception to make the red go away would have recreated exactly the blind
     spot that hid it, so the red was left alone until the owner decided.

     13 Aug 2026: decided — the key is being set rather than the feature
     retired. Nothing here changes. What DOES change is how to read a future
     failure on this line: it is no longer the known one. Once the key is in
     place, a 503 here means the key was revoked, expired or rate-limited, or
     the upstream shape moved — a real regression in a feature that is now
     expected to work, not a note about something nobody had configured. */
  { path: '/api/football-data/matchday?competition=PL', status: 200, json: true,
    why: 'referees + midweek fixtures (green since 13 Aug)' },
  { path: '/privacy.html', status: 200, why: 'privacy policy' },
  /* The vendor bundle is built by Netlify rather than committed, so its
     absence is a BUILD failure, not a missing file — and it fails quietly:
     the app degrades to inline-SVG sparklines, substring palette search and
     no keyboard shortcuts, all of which look like a working site. Checking
     it here is the only place that difference shows up in production. */
  { path: '/vendor.js', status: 200, why: 'uPlot + Fuse.js + tinykeys bundle' },
  { path: '/vendor.css', status: 200, why: 'uPlot stylesheet' }
];

const UA = 'Mozilla/5.0 (compatible; GameweekEdgeSiteCheck/1.0; +https://gameweekedge.co.uk)';

/* A thrown fetch is not the same finding as a wrong status code, and treating
   them alike made this check lie once. On 13 Aug /fantasy-efl/ came back
   "fetch failed" — one dropped connection, on a route that had served 200
   forty minutes earlier and served 200 again straight after — and the whole
   run went red and mailed a failure.

   That matters more than it used to. The football-data line was red on
   purpose for three days, and the argument for leaving it red was that a red
   here should mean something. A check that cries wolf on a single lost packet
   spends exactly the credibility that argument depends on.

   So: retry, but only a THROWN request. A 404 or a 500 is the site's answer
   and is reported first time, every time — retrying those would be the kind
   of exception this file has refused to add. And a route that only passes on
   a retry says so in the output, because "flaky" is a finding too. */
const RETRIES = 2;
const BACKOFF_MS = 1500;
/* Every request gets a deadline. Without one this script hung for a quarter
   of an hour on a check that normally takes fifteen seconds, and would have
   sat there until GitHub's six-hour job limit — a deploy verification that
   never returns is indistinguishable from one that has not been run, and it
   holds the answer hostage either way. The retry loop makes it worse, not
   better: a hang never throws, so it never retries.

   The same fix went into dev/probe-squad-nationality.mjs and
   dev/open-api-probe.mjs when it bit there. It should have come here at the
   same time. */
const TIMEOUT_MS = 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url) {
  let last;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt) await sleep(BACKOFF_MS * attempt);
    try {
      return {
        res: await fetch(url, {
          headers: { 'User-Agent': UA, Accept: '*/*' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          /* Manual, because "it redirects" and "it serves the same page" are
             different promises and only one of them was made. */
          redirect: 'manual'
        }),
        attempts: attempt + 1
      };
    } catch (err) { last = err; }
  }
  throw last;
}

async function probe({ path, status, redirect, json }) {
  const url = ORIGIN + path;
  try {
    const { res, attempts } = await request(url);
    const flaky = attempts > 1 ? ` [after ${attempts} attempts]` : '';
    const location = res.headers.get('location');
    const out = { status: res.status, location };
    if (json) {
      try { out.body = await res.json(); } catch (_) { out.notJson = true; }
    }
    if (redirect != null) {
      const target = location ? new URL(location, ORIGIN).pathname : null;
      out.ok = res.status >= 300 && res.status < 400 && target === redirect;
      out.detail = (out.ok ? `${res.status} → ${target}`
        : `expected 3xx → ${redirect}, got ${res.status}${target ? ' → ' + target : ''}`) + flaky;
      return out;
    }
    const allowed = Array.isArray(status) ? status : [status];
    out.ok = allowed.includes(res.status) && !out.notJson;
    out.detail = (out.notJson ? `${res.status} but the body was not JSON`
      : `${res.status}${allowed.length > 1 ? ` (allowed: ${allowed.join('/')})` : ''}`) + flaky;
    return out;
  } catch (err) {
    return { ok: false, detail: `request failed after ${RETRIES + 1} attempts: ${err.message}` };
  }
}

console.log(`Site check — ${ORIGIN}\n`);

let failed = 0;
/* Every observed status, so the summary can tell two very different things
   apart: the site answering wrongly, and never having reached the site. */
const seenStatus = [];
for (const check of CHECKS) {
  const res = await probe(check);
  if (res.status != null) seenStatus.push(res.status);
  if (!res.ok) failed++;
  console.log(`  ${res.ok ? '✓' : '✗'} ${check.path.padEnd(32)} ${String(res.detail).padEnd(34)} ${check.why}`);
  if (!res.ok && res.body) console.log(`      body: ${JSON.stringify(res.body).slice(0, 240)}`);
}

/* Tally from the CHECKS loop ALONE. The first version of the unreachable
   detector below compared `failed` against CHECKS.length, but /sw.js runs in
   between and increments it first, so the counts never matched and the
   detector never fired — a guard that could not fire, which is the exact
   thing it was written to stop happening elsewhere. */
const failedInChecks = failed;

/* The service worker is the one deployed file that keeps working after the
   deploy that removed it — it lives in caches on installed devices. So the
   check is not "is it there" but "is the NEW one there", named by version,
   with the retired app gone from its precache list. A stale worker is how
   /euro/ would keep launching from someone's home screen. */
console.log('');
try {
  /* Same retry as every other request — this one was fetched raw, so a
     dropped connection here would have gone red for the same wrong reason. */
  const { res } = await request(`${ORIGIN}/sw.js`);
  const src = await res.text();
  const version = (src.match(/const VERSION = '([^']+)'/) || [])[1] || '(none)';
  const euro = /'\/euro\//.test(src);
  const ok = res.status === 200 && !euro;
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} /sw.js  version ${version}, `
    + `${euro ? 'STILL precaches /euro/ — installed devices will keep it' : 'no /euro/ in the precache list'}`);
} catch (err) {
  failed++;
  console.log(`  ✗ /sw.js  could not be fetched: ${err.message}`);
}

/* ── WHICH BUILD IS ACTUALLY OUT THERE ─────────────────────
   Every check above passes against the PREVIOUS deploy just as happily as
   against the new one. Netlify builds on its own schedule, so a green run two
   minutes after a push proves the site is healthy and proves nothing about
   whether the change shipped — and reporting "deployed and verified" off the
   back of it would be the instrument being read as the world, which is the
   failure this repository keeps writing down.

   So: name a marker that only exists in the newer build and look for it.
   MARKER is deliberately a feature string rather than a commit hash, because
   index.html is copied verbatim into www/ and carries no build stamp. It has
   to be updated when it stops being new — and a stale marker fails loudly
   here rather than silently passing, because the string will still be
   present and the check will simply stop being informative. Hence the date. */
const MARKER = { text: 'function leagueAwards', since: '2026-08-22',
  what: 'the gameweek awards computing themselves, with no button to press' };
/* Rotated from 'function leagueEO' (2026-08-22), before that
   'function squadMatchday', 'function titleRace' and
   'function fixtureOver' (all 2026-08-22).

   RESOLVED 2026-08-22 16:48. Those four, plus the price panel and the
   auto-subs fix, spent a day pushed-but-unverified because the GitHub
   connector dropped mid-session and neither curl nor WebFetch can reach
   the site from the sandbox. The connector came back and run
   32585799682 reported:

     ✓ deployed build  carries the detailed mini-league view with
                       effective ownership (added 2026-08-22)

   All six were ancestors of that build, so one marker confirmed the lot
   — which is the argument for rotating the marker on every release
   rather than only on the ones that feel significant. Before that:
   'function applyAutoSubs' (2026-08-22), and before it from
   'function fplPriceMove' (2026-08-22), which shipped in the
   previous build but was never confirmed live \u2014 the GitHub connector
   dropped out of that session before the site check could run, so that
   release is pushed-but-unverified and this marker covers both.
   Rotated from 'function fplChipWindows' (2026-08-22 morning), which had
   landed. Rotated from '.dl-grow > .rv-open > .dl-nm' (2026-08-22), and from
   'id="rival-fpl-note"' (2026-08-21 evening), which had landed in
   the previous build. Rotated from 'id="rival-modal"' (2026-08-21 morning), and from
   'id="fdr-rows"' (2026-08-19) before that, each of which had done its job and
   stopped: by 21 Aug it was live in the previous build, so a green run proved
   the site was healthy and said nothing about whether the newest deploy had
   landed. That is the second time this marker has aged out, and the second
   time it was noticed only because somebody asked which build it belonged
   to — before that, 'fdr-rows' was rotated in from 'id="feedback-btn"'
   (2026-08-16) for exactly the same reason.

   The pattern is the point: this string has to be rotated on every
   user-visible change, and the failure mode is silent. It does not go red
   when it goes stale; it goes green for the wrong reason. Anyone shipping a
   change to index.html should assume this line is their job. */

/* Are we even talking to the site?

   This ran from a sandbox whose egress proxy refuses gameweekedge.co.uk, and
   the refusal arrives as a perfectly ordinary HTTP 403 from the gateway. So
   every check above went red with a status mismatch, and the marker check
   then announced "the push has not deployed yet, or the build failed" — a
   claim about a deploy it had no evidence about at all. The instrument was
   being reported as the world, again.

   The tell is that EVERY check failed with the SAME status, including static
   files like /privacy.html and /vendor.css that no working origin answers 403
   to and no check expected. One status across every path means something in
   front of the site is answering, not the site. When that happens the run
   says so and withholds any verdict on the deploy, because "cannot verify"
   and "did not ship" are different findings and only one of them is true. */
const allFailed = failedInChecks === CHECKS.length;
const oneStatus = new Set(seenStatus).size === 1 && seenStatus.length === CHECKS.length;
const unreachable = allFailed && oneStatus;
if (unreachable) {
  console.log('');
  console.log(`  ! Every check returned ${seenStatus[0]}, including paths no origin answers that way.`);
  console.log('    Something in front of the site is answering — a proxy, a WAF, or blocked egress.');
  console.log('    This run therefore says NOTHING about whether the deploy shipped.');
  console.log(`    Re-run where ${ORIGIN} is reachable (the "Site check" workflow does).`);
  console.log(`\n✗ Could not reach ${ORIGIN} — ${failed} check(s) failed, none of them informative.`);
  process.exit(2);
}

console.log('');
try {
  const { res } = await request(ORIGIN + '/');
  const html = await res.text();
  const there = html.includes(MARKER.text);
  if (!there) failed++;
  console.log(`  ${there ? '✓' : '✗'} deployed build  ${there
    ? 'carries ' + MARKER.what + ' (added ' + MARKER.since + ')'
    : 'does NOT carry ' + MARKER.what + ' — the push has not deployed yet, or the build failed'}`);
} catch (err) {
  failed++;
  console.log(`  ✗ deployed build  could not be read: ${err.message}`);
}

console.log(failed ? `\n✗ ${failed} check(s) failed.` : '\n✓ Every check passed.');
process.exit(failed ? 1 : 0);
