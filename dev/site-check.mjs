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

  /* Added 11 Aug 2026, and expected to FAIL until someone acts. Found by
     accident — a probe chasing something unrelated got a 503 back from this
     endpoint saying "FOOTBALL_DATA_KEY is not configured". The key is not
     set on the deployed site, so this function has never been able to
     succeed there, and it is the FPL app's only referee source and one of
     its two midweek-fixture sources.

     It is checked here rather than written down somewhere, because the
     reason it went unnoticed for so long is that nothing looked. Either set
     the key or delete the feature; adding an exception here to make the red
     go away would recreate exactly the blind spot that hid it. */
  { path: '/api/football-data/matchday?competition=PL', status: 200, json: true,
    why: 'referees + midweek fixtures (503 = key not configured)' },
  { path: '/privacy.html', status: 200, why: 'privacy policy' }
];

const UA = 'Mozilla/5.0 (compatible; GameweekEdgeSiteCheck/1.0; +https://gameweekedge.co.uk)';

async function probe({ path, status, redirect, json }) {
  const url = ORIGIN + path;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      /* Manual, because "it redirects" and "it serves the same page" are
         different promises and only one of them was made. */
      redirect: 'manual'
    });
    const location = res.headers.get('location');
    const out = { status: res.status, location };
    if (json) {
      try { out.body = await res.json(); } catch (_) { out.notJson = true; }
    }
    if (redirect != null) {
      const target = location ? new URL(location, ORIGIN).pathname : null;
      out.ok = res.status >= 300 && res.status < 400 && target === redirect;
      out.detail = out.ok ? `${res.status} → ${target}`
        : `expected 3xx → ${redirect}, got ${res.status}${target ? ' → ' + target : ''}`;
      return out;
    }
    const allowed = Array.isArray(status) ? status : [status];
    out.ok = allowed.includes(res.status) && !out.notJson;
    out.detail = out.notJson ? `${res.status} but the body was not JSON`
      : `${res.status}${allowed.length > 1 ? ` (allowed: ${allowed.join('/')})` : ''}`;
    return out;
  } catch (err) {
    return { ok: false, detail: `request failed: ${err.message}` };
  }
}

console.log(`Site check — ${ORIGIN}\n`);

let failed = 0;
for (const check of CHECKS) {
  const res = await probe(check);
  if (!res.ok) failed++;
  console.log(`  ${res.ok ? '✓' : '✗'} ${check.path.padEnd(32)} ${String(res.detail).padEnd(34)} ${check.why}`);
  if (!res.ok && res.body) console.log(`      body: ${JSON.stringify(res.body).slice(0, 240)}`);
}

/* The service worker is the one deployed file that keeps working after the
   deploy that removed it — it lives in caches on installed devices. So the
   check is not "is it there" but "is the NEW one there", named by version,
   with the retired app gone from its precache list. A stale worker is how
   /euro/ would keep launching from someone's home screen. */
console.log('');
try {
  const res = await fetch(`${ORIGIN}/sw.js`, { headers: { 'User-Agent': UA } });
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

console.log(failed ? `\n✗ ${failed} check(s) failed.` : '\n✓ Every check passed.');
process.exit(failed ? 1 : 0);
