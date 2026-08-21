/*
 * What else is free to USE — not merely free to reach.
 *
 * The third probe in this family, and the first where licensing is the
 * question rather than a caveat at the bottom. dev/pl-endpoint-probe.mjs
 * asked what the Premier League serves and said plainly that it could not say
 * whether any of it was permitted. That gap is exactly what closed the
 * Pulselive question the hard way: nine endpoints answering 200, and not one
 * line of terms to stand on. See docs/scope-pulselive-source.md.
 *
 * So this probe applies TWO FILTERS BEFORE ANY REQUEST IS MADE, and they
 * eliminate most of what a survey would otherwise turn up:
 *
 *   1. PUBLISHED TERMS. The candidate must state, somewhere citable, what it
 *      permits. This rules out the entire class of undocumented site
 *      backends — Pulselive and SDP, already declined, and their siblings.
 *      They are omitted deliberately, not overlooked. A site's private API is
 *      not a free API; it is somebody else's API that happens to answer.
 *
 *   2. NO KEY. The project's standing rule is no paid APIs and no new keys
 *      beyond those already configured. A free-tier key is still a key: it is
 *      an account, a credential to store, and terms that can change under an
 *      identified user. Key-gated candidates are probed WITHOUT one anyway,
 *      to record that they are gated rather than to get past it.
 *
 * WHAT IT MEASURES PER CANDIDATE
 *   · status, content-type, and payload shape — a login wall and an error
 *     page both answer 200 with HTML, so status alone settles nothing.
 *   · CORS as asked FROM OUR OWN ORIGIN. This app has a strict CSP whose
 *     connect-src is 'self' plus two hosts, so the answer decides between "add
 *     to connect-src" and "needs a Netlify function". Asking with somebody
 *     else's Origin cannot tell an allowlist from an echo — that mistake is
 *     recorded in dev/pl-endpoint-probe.mjs and is not repeated here.
 *   · The terms document: whether it is reachable, and an EXCERPT around the
 *     licence words. The excerpt is evidence for a human to act on, not a
 *     verdict. Nothing here decides whether we may use anything.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   · Decide licensing. It cannot, and an exit code pretending otherwise
 *     would be worse than silence.
 *   · Send credentials, or touch paid tiers.
 *   · Scrape publisher article text. The terms fetches are documentation
 *     pages read to answer a question about permission, which is the opposite
 *     of taking content.
 *
 * COVERAGE IS PRINTED. The candidate list is hand-written and finite, so an
 * absence from the output means "not probed", never "does not exist".
 *
 * Run from a runner: the sandbox this is developed in cannot reach these
 * hosts. Read-only, one pass, paced.
 */

import { pathToFileURL } from 'node:url';

const OUR_ORIGIN = 'https://gameweekedge.co.uk';
const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)';
const TIMEOUT_MS = 15000;
const PACE_MS = Number(process.env.GWE_PACE_MS) || 1200;

/* `gap` is the honest reason a candidate is here: which measured hole in the
   app it would fill. A candidate with no gap is decoration, and saying so in
   the row is cheaper than discovering it after a proxy is written. */
const CANDIDATES = [
  {
    name: 'Open-Meteo forecast',
    url: 'https://api.open-meteo.com/v1/forecast?latitude=51.55&longitude=-0.11&hourly=temperature_2m,precipitation,wind_speed_10m&forecast_days=3',
    gap: 'WEATHER — the app has none. grep for weather/rain/wind/temperature in index.html returns 0.',
    terms: 'https://open-meteo.com/en/terms'
  },
  {
    name: 'Open-Meteo archive',
    url: 'https://archive-api.open-meteo.com/v1/archive?latitude=51.55&longitude=-0.11&start_date=2026-08-01&end_date=2026-08-07&hourly=precipitation',
    gap: 'Historical weather, so any weather effect can be BACKTESTED rather than asserted.',
    terms: 'https://open-meteo.com/en/terms'
  },
  {
    name: 'REST Countries',
    url: 'https://restcountries.com/v3.1/all?fields=name,cca3,region,subregion',
    gap: 'Country → region. Turns football-data nationality into confederation, which is what an AFCON risk signal needs.',
    terms: 'https://restcountries.com/'
  },
  {
    name: 'Wikidata entity',
    url: 'https://www.wikidata.org/wiki/Special:EntityData/Q9317.json',
    gap: 'CC0 structured metadata. Largely superseded for nationality; kept to record what it costs to reach.',
    terms: 'https://www.wikidata.org/wiki/Wikidata:Licensing'
  },
  {
    /* http:// is not a typo — the documented host is plain HTTP, which is a
       finding in itself for a site whose CSP would have to allow it. The
       first run timed out at 15s here; https is tried too so the report can
       say which, rather than filing the whole service as gone. */
    name: 'Club Elo (https)',
    url: 'https://api.clubelo.com/Fixtures',
    gap: 'NONE — Elo already arrives via FPL-Core-Insights (netlify/functions/team-elo.js). Probed to confirm it is a duplicate.',
    terms: 'http://clubelo.com/API'
  },
  {
    name: 'Sunrise-Sunset',
    url: 'https://api.sunrise-sunset.org/json?lat=51.55&lng=-0.11&formatted=0',
    gap: 'Marginal. Daylight at kickoff. Listed to be measured and dismissed rather than imagined.',
    terms: 'https://sunrise-sunset.org/api'
  },
  {
    /* CORRECTION. This was labelled "probed WITHOUT a key" and that was
       false: the `/3/` path segment IS TheSportsDB's public test key. It
       therefore does not meet the no-key filter — it meets it the way a
       shared password meets "no password". Kept in the list, relabelled, and
       failing the filter is the finding. */
    name: 'TheSportsDB (public test key /3/ — FAILS the no-key filter)',
    url: 'https://www.thesportsdb.com/api/v1/json/3/search_all_teams.php?l=English%20Premier%20League',
    gap: 'Squad and venue metadata — but gated behind a shared demo key that can be revoked or rate-limited at any time, for everyone using it.',
    terms: 'https://www.thesportsdb.com/free_sports_api'
  },
  {
    name: 'FPL Draft API',
    url: 'https://draft.premierleague.com/api/bootstrap-static',
    gap: 'Same publisher as the FPL API we already proxy. Recorded for completeness, not because a feature wants it.',
    terms: 'https://www.premierleague.com/terms-and-conditions'
  }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, extraHeaders) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, ...(extraHeaders || {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow'
    });
    const text = await r.text();
    return {
      status: r.status,
      ct: (r.headers.get('content-type') || '').split(';')[0],
      cors: r.headers.get('access-control-allow-origin'),
      text,
      ms: Date.now() - t0
    };
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return {
      status: 0,
      ct: '',
      cors: null,
      text: '',
      err: timedOut ? `no answer within ${TIMEOUT_MS}ms` : String(e && e.message),
      ms: Date.now() - t0
    };
  }
}

/* Parsed, not sniffed. raw.githubusercontent serves .json as text/plain and an
   earlier probe in this repo reported perfectly good JSON as `not-json` on
   content-type alone. */
function shapeOf(text, ct) {
  if (!text) return 'empty';
  let data;
  try { data = JSON.parse(text); } catch (_) {
    return /html/i.test(ct) || /^\s*</.test(text) ? 'HTML (not an API answer)' : `${ct || 'unknown'}, unparseable`;
  }
  if (Array.isArray(data)) {
    const first = data[0];
    return `array[${data.length}]` + (first && typeof first === 'object'
      ? ` of {${Object.keys(first).slice(0, 6).join(', ')}}` : '');
  }
  if (data && typeof data === 'object') return `{${Object.keys(data).slice(0, 8).join(', ')}}`;
  return typeof data;
}

/* An API that answers 200 with {success, data, errors} has not given us data,
   and one that answers 503 with {reason, error} is TELLING US WHY. The first
   version of this survey printed the key names and threw both bodies away —
   so the single most valuable candidate came back 503 and the output could
   not say whether that was a bad parameter, a rate limit, or the service
   being down. Key names are not a diagnosis. The body is. */
const ERROR_KEYS = /^(error|errors|reason|message|detail|status_message)$/i;

function errorBody(text) {
  if (!text) return null;
  let data;
  try { data = JSON.parse(text); } catch (_) { return text.slice(0, 200).replace(/\s+/g, ' ').trim(); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const keys = Object.keys(data);
  const hit = keys.filter((k) => ERROR_KEYS.test(k));
  if (!hit.length) return null;
  const parts = hit.map((k) => {
    const v = data[k];
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return `${k}: ${String(s).slice(0, 160)}`;
  });
  return parts.join(' | ');
}

/* A 200 carrying an error envelope is not a success, and counting it as one
   is how "6 of 8 answered 200" becomes a misleading headline. */
function isErrorEnvelope(text) {
  if (!text) return false;
  let data;
  try { data = JSON.parse(text); } catch (_) { return false; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const keys = Object.keys(data);
  /* `errors` present AND non-empty, or an explicit error flag. A payload that
     merely HAS an `errors` key set to null or [] is fine. */
  if (data.error === true || (typeof data.error === 'string' && data.error)) return true;
  if (data.success === false) return true;
  const errs = data.errors;
  if (Array.isArray(errs) ? errs.length > 0 : (errs && typeof errs === 'object')) return true;
  if (keys.includes('reason') && keys.includes('error')) return true;
  return false;
}

/* Three outcomes, named. A browser on our domain can call a wildcard; it can
   call one that echoes us; it cannot call one fixed to somebody else; and an
   absent header is the same "cannot" as the last. Anything other than
   wildcard-or-echo means a Netlify function, exactly like fpl.js. */
function corsVerdict(cors) {
  if (!cors) return { ok: false, why: 'no Access-Control-Allow-Origin — needs a proxy' };
  if (cors === '*') return { ok: true, why: 'wildcard — callable from the browser' };
  if (cors === OUR_ORIGIN) return { ok: true, why: 'echoes our origin — callable from the browser' };
  return { ok: false, why: `fixed to ${cors} — needs a proxy` };
}

/* TWO TIERS, and the distinction is the whole point.
 *
 * The first version had one flat list with "terms of use" and "licence" in
 * it, took the FIRST match, and returned the text around it. On every page
 * probed, that first match was navigation furniture — a header, a footer
 * link, a table of contents entry — so the survey reported an excerpt for
 * Open-Meteo that was liability boilerplate and left the actual licence
 * unread. It looked like an answer. It was a heading.
 *
 * STRONG wording states a permission or a licence. WEAK wording only tells
 * you the page is about permissions, which is not the same thing and must
 * never be printed as though it were.
 */
const STRONG_WORDS = /(CC[ -]?BY(?:[ -]?(?:SA|NC|ND))*(?:[ -]?\d(?:\.\d)?)?|CC0|creative commons|public domain|non-?commercial|commercial use|free to use|free for|may be used|you may use|attribution (?:is )?(?:required|requested)|requires? attribution|open (?:data )?licen[cs]e|ODbL|MIT licen[cs]e|Apache)/i;
const WEAK_WORDS = /(licen[cs]e|terms of use|attribution|terms and conditions)/i;

/* An excerpt, labelled as an excerpt. The temptation is to grep for a word
   and print "permitted"; that is the robots.txt failure this repo already
   wrote down — an absence of a matched rule dressed up as permission. So this
   prints WHAT IT FOUND and the URL, and draws no conclusion whatever. */
function licenceExcerpt(text, max = 3) {
  if (!text) return null;
  const plain = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return { found: false, strong: false, len: 0, hits: [] };

  /* Every strong match, not the first — a licence clause is rarely the first
     thing on a page, and taking the first is how the heading won last time. */
  const hits = [];
  const seen = new Set();
  const re = new RegExp(STRONG_WORDS.source, 'gi');
  let m;
  while ((m = re.exec(plain)) !== null && hits.length < max) {
    const i = Math.max(0, m.index - 110);
    const slice = plain.slice(i, i + 300);
    /* Overlapping windows around adjacent matches say the same thing twice. */
    const fingerprint = slice.slice(0, 60);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    hits.push({ term: m[0], text: slice });
  }
  if (hits.length) return { found: true, strong: true, len: plain.length, hits };

  /* Weak only. Report it as weak, loudly. The page is ABOUT permissions and
     this survey did not find any stated. That is a prompt to read the URL,
     not a finding, and it is the difference between "no licence clause was
     matched" and "there is no licence". */
  const w = plain.match(WEAK_WORDS);
  if (w) {
    const i = Math.max(0, w.index - 110);
    return {
      found: true,
      strong: false,
      len: plain.length,
      hits: [{ term: w[0], text: plain.slice(i, i + 300) }]
    };
  }
  return { found: false, strong: false, len: plain.length, hits: [] };
}

const short = (u) => u.replace(/^https?:\/\//, '').slice(0, 64);

/* Exported so dev/test-open-api-probe.mjs can drive the judgement calls — the
   CORS verdict, the shape sniffer and the licence excerpt — without a network
   and without running the survey. Everything above this line is a decision
   about what an answer MEANS, which is the part worth testing; everything
   below is fetching and printing. */
export { corsVerdict, shapeOf, licenceExcerpt, errorBody, isErrorEnvelope, CANDIDATES, OUR_ORIGIN };

/* Only survey when run directly. Imported, this file must stay inert —
   otherwise the test that checks its judgement calls would itself go to the
   network, which is the sort of thing that turns a one-second unit test into
   a flaky one. pathToFileURL rather than string concatenation: argv[1] can
   contain spaces, and a mangled comparison here would silently mean "never
   run the survey". */
const invokedDirectly = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {

console.log('Free-to-consume API survey');
console.log(`Origin asked with: ${OUR_ORIGIN}`);
console.log(`${CANDIDATES.length} candidates. Both filters applied BEFORE probing:`);
console.log('  · published terms required — site backends (Pulselive, SDP and kin) excluded by');
console.log('    the 21 Aug 2026 decision, not by oversight');
console.log('  · no key — the standing rule; gated candidates are probed keyless to record it\n');

const rows = [];
for (const c of CANDIDATES) {
  await sleep(PACE_MS);
  console.log('='.repeat(74));
  console.log(c.name);
  console.log(`  gap:   ${c.gap}`);
  console.log(`  url:   ${short(c.url)}`);

  const r = await get(c.url, { Origin: OUR_ORIGIN, Accept: 'application/json' });
  if (!r.status) {
    console.log(`  → UNREACHABLE (${r.err}) after ${r.ms}ms`);
    rows.push({ ...c, reachable: false, err: r.err });
    continue;
  }
  const shape = shapeOf(r.text, r.ct);
  const cv = corsVerdict(r.cors);
  const envelope = r.status === 200 && isErrorEnvelope(r.text);
  console.log(`  → HTTP ${r.status}  ${r.ct || 'no content-type'}  ${r.ms}ms` +
    (envelope ? '   ← 200, but an ERROR ENVELOPE' : ''));
  console.log(`     shape: ${shape}`);
  const why = errorBody(r.text);
  if (why && (r.status !== 200 || envelope)) console.log(`     upstream says: ${why}`);
  console.log(`     CORS:  ${cv.why}`);

  await sleep(PACE_MS);
  const t = await get(c.terms, { Accept: 'text/html' });
  console.log(`  terms: ${short(c.terms)} → HTTP ${t.status || 'unreachable'}`);
  const ex = t.status === 200 ? licenceExcerpt(t.text) : null;
  if (ex && ex.strong) {
    console.log(`     STATED PERMISSIONS found (${ex.hits.length}). Excerpts, not a verdict:`);
    ex.hits.forEach((h) => console.log(`       [${h.term}] "…${h.text}…"`));
  } else if (ex && ex.found) {
    console.log(`     ONLY GENERIC WORDING matched ("${ex.hits[0].term}") in ${ex.len} chars.`);
    console.log(`     This page is ABOUT permissions; no stated permission was found in it.`);
    console.log(`     That is a fact about this fetch, NOT about the terms. Read the URL.`);
    console.log(`       "…${ex.hits[0].text}…"`);
  } else if (ex) {
    console.log(`     no licence wording matched at all in ${ex.len} chars of text.`);
    console.log(`     That is a fact about this fetch, NOT about the terms. Read the URL.`);
  } else if (t.status) {
    console.log(`     terms page did not answer 200; nothing read.`);
  }

  rows.push({
    ...c,
    reachable: true,
    status: r.status,
    shape,
    cors: cv,
    json: !/HTML|unparseable|empty/.test(shape),
    envelope,
    termsStatus: t.status,
    termsStrong: !!(ex && ex.strong),
    termsHits: (ex && ex.hits) || []
  });
}

console.log(`\n${'='.repeat(74)}\nSUMMARY\n${'='.repeat(74)}`);
const usable = rows.filter((x) => x.reachable && x.status === 200 && x.json && !x.envelope);
console.log(`${usable.length} of ${rows.length} returned usable JSON.`);
const envelopes = rows.filter((x) => x.envelope);
if (envelopes.length) {
  console.log(`${envelopes.length} answered 200 with an error envelope and are NOT counted as usable:`);
  console.log(`  ${envelopes.map((x) => x.name).join(', ')}. A 200 is not a success.`);
}
const direct = usable.filter((x) => x.cors.ok);
console.log(`${direct.length} of those ${direct.length === 1 ? 'is' : 'are'} browser-callable; ` +
  `${usable.length - direct.length} would need a Netlify function.`);
const noTerms = rows.filter((x) => x.termsStatus !== 200);
if (noTerms.length) {
  console.log(`${noTerms.length} terms page(s) did not answer: ${noTerms.map((x) => x.name).join(', ')}.`);
  console.log(`  Unreachable terms is not permissive terms. Treat those as unanswered.`);
}
/* The count that actually matters for "free to USE". Reachability was never
   the hard part. */
const stated = rows.filter((x) => x.termsStrong);
console.log(`${stated.length} of ${rows.length} had a STATED permission this survey could quote:` +
  (stated.length ? ` ${stated.map((x) => x.name).join(', ')}.` : ' none.'));
const vague = rows.filter((x) => x.termsStatus === 200 && !x.termsStrong);
if (vague.length) {
  console.log(`${vague.length} answered with only generic wording: ${vague.map((x) => x.name).join(', ')}.`);
  console.log(`  Those are UNANSWERED, not permissive. A human reads the URL or nothing is built.`);
}

/* THE INSTRUMENT CHECK. Run this from the development sandbox and every
   candidate returns 403 — from OUR egress proxy, not from any of them. The
   output looks identical to "the whole open web refuses us", and reading it
   that way would be the exact failure this family of probes exists to avoid.
   A run where nothing succeeded is evidence about the network it ran on
   until proven otherwise. */
const bad = rows.filter((x) => !x.reachable || x.status !== 200);
if (bad.length === rows.length && rows.length > 1) {
  const codes = new Set(rows.map((x) => x.status || 'unreachable'));
  console.log(`\n!! EVERY candidate failed` +
    (codes.size === 1 ? `, all with ${[...codes][0]}.` : '.'));
  console.log(`   Do NOT read this as a finding about these APIs. It is what this`);
  console.log(`   survey looks like when run somewhere without open egress — the`);
  console.log(`   development sandbox answers 403 to all of them. Run it from the`);
  console.log(`   Data source surveys workflow and compare.`);
}

/* THE DIGEST. The per-candidate detail above is 250 lines by the time eight
   candidates have each printed three excerpts, and the thing a reader came
   for — what am I actually permitted to do — is at the top, scrolled away.
   So it is repeated here, at the bottom, next to the URL it came from. Same
   evidence, placed where somebody will read it. */
if (stated.length) {
  console.log(`\n${'='.repeat(74)}\nSTATED PERMISSIONS — the digest\n${'='.repeat(74)}`);
  stated.forEach((x) => {
    console.log(`\n${x.name}`);
    console.log(`  ${x.terms}`);
    x.termsHits.forEach((h) => console.log(`  [${h.term}] …${h.text.slice(0, 230)}…`));
  });
  console.log(`\nStill excerpts. Still not a verdict. But these are the sentences a`);
  console.log(`human has to read and decide on, and now they are in one place.`);
}

console.log(`\nWhat this survey does NOT tell you:`);
console.log(`  · Whether we may use any of it. Excerpts are excerpts. Every licence`);
console.log(`    decision here is a human one, and deliberately not an exit code.`);
console.log(`  · Anything about candidates not listed. The list is hand-written and`);
console.log(`    finite: absent means NOT PROBED, never "does not exist".`);
console.log(`  · Whether a gap is worth filling. A reachable source for a hole nobody`);
console.log(`    is trying to fill is still not a reason to write a proxy.`);

}
