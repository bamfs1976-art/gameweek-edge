/*
 * Pins the three judgement calls in dev/open-api-probe.mjs.
 *
 * The survey's fetching is not the interesting part. What it DECIDES is:
 * whether a browser could call something, whether an answer is really JSON,
 * and what a terms page did or did not say. Each of those has a specific way
 * of being confidently wrong, and each way has already happened in this
 * repository at least once:
 *
 *   CORS      — asking with somebody else's Origin cannot distinguish a fixed
 *               allowlist from a server that echoes whatever it is sent. That
 *               nearly became a wrong conclusion in the Pulselive survey.
 *   shape     — judging JSON by content-type reported raw.githubusercontent's
 *               perfectly good JSON as `not-json`, because it serves .json as
 *               text/plain.
 *   licence   — the robots.txt failure: walk a document, match nothing, print
 *               nothing, and report permission. An absence of matched wording
 *               must never render as a finding about the terms.
 *
 * No network. The probe stays inert on import, and this asserts on its
 * functions directly.
 */

import { corsVerdict, shapeOf, licenceExcerpt, errorBody, isErrorEnvelope, CANDIDATES, OUR_ORIGIN }
  from './open-api-probe.mjs';

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log(`  FAIL  ${msg}`); } };

console.log('open-api-probe — judgement calls');

/* ── CORS: four outcomes, and only two of them mean "browser can call it" ── */
ok(corsVerdict('*').ok, 'wildcard should be browser-callable');
ok(/wildcard/.test(corsVerdict('*').why), 'wildcard should be named as such');

ok(corsVerdict(OUR_ORIGIN).ok, 'echo of our own origin should be browser-callable');
ok(/echoes our origin/.test(corsVerdict(OUR_ORIGIN).why), 'echo should be named as an echo');

/* The one that matters. A header naming somebody else is NOT permission for
   us, and must not be read as one just because a header was present. */
const other = corsVerdict('https://www.premierleague.com');
ok(!other.ok, 'a header fixed to another origin must NOT read as callable');
ok(/needs a proxy/.test(other.why), 'another origin should say a proxy is needed');

const absent = corsVerdict(null);
ok(!absent.ok, 'an absent CORS header must NOT read as callable');
ok(/no Access-Control-Allow-Origin/.test(absent.why), 'absent header should be named as absent');

/* ── shape: parse before deciding ── */
ok(/array\[2\]/.test(shapeOf('[{"a":1,"b":2},{"a":3}]', 'text/plain')),
  'valid JSON served as text/plain must still be recognised as JSON');
ok(/of \{a, b\}/.test(shapeOf('[{"a":1,"b":2}]', 'text/plain')),
  'array shape should surface the first row keys');
ok(/^\{name, id\}$/.test(shapeOf('{"name":1,"id":2}', 'application/json')),
  'object shape should list top-level keys');
ok(/HTML/.test(shapeOf('<!doctype html><body>hi</body>', 'text/html')),
  'an HTML body must be called out, not counted as an answer');
ok(/HTML/.test(shapeOf('  <html></html>', '')),
  'HTML with no content-type should still be caught by its own first character');
ok(shapeOf('', 'application/json') === 'empty', 'an empty body should say empty');
ok(/unparseable/.test(shapeOf('not json at all', 'application/json')),
  'a non-JSON body claiming JSON should be called unparseable, not accepted');

/* ── licence excerpt: the robots.txt lesson, and the heading problem ──
   The first version had one flat word list, took the FIRST match, and on
   every real page that match was navigation furniture. Open-Meteo's licence
   went unread for a whole survey because "Terms of Use" appears in the header
   and won. Strong wording states a permission; weak wording only says the
   page is about permissions. Conflating them is how a heading gets reported
   as an answer. */
const found = licenceExcerpt('<p>Some preamble here. This data is licensed under CC BY 4.0 and may be reused.</p>');
ok(found && found.strong, 'a stated licence should be found as STRONG');
ok(/CC BY 4.0/.test(found.hits[0].text), 'the excerpt should carry the actual wording through');
ok(!/verdict|permitted|allowed/i.test(found.hits[0].text), 'the excerpt should be text, not a judgement');

/* THE REGRESSION THAT MOTIVATED ALL OF THIS. Nav furniture first, real
   clause much later — the shape of every terms page probed. */
const buried = licenceExcerpt(
  '<nav>Home Features Pricing Terms of Use Privacy</nav>' +
  '<p>' + 'filler text. '.repeat(40) + '</p>' +
  '<p>All data is free to use for commercial purposes under CC BY 4.0.</p>');
ok(buried.strong, 'a clause buried under nav furniture must still be found');
ok(/free to use for commercial/.test(buried.hits.map((h) => h.text).join(' ')),
  'the buried clause, not the heading, is what should be quoted');

/* Weak-only: the page talks about licensing and states nothing. This must be
   visibly different from a stated permission, and from silence. */
const weak = licenceExcerpt('<nav>Terms of Use</nav><p>We accept no responsibility for outages.</p>');
ok(weak && weak.found, 'generic wording should still register as found');
ok(weak.strong === false, 'generic wording must NOT be reported as a stated permission');

const missing = licenceExcerpt('<p>Welcome to our website. Here is some news about cats.</p>');
ok(missing && missing.found === false, 'absent licence wording should report found:false');
ok(missing.strong === false, 'absent wording is certainly not strong');
ok(typeof missing.len === 'number' && missing.len > 0,
  'a no-match result must still report how much text was actually read — a zero-length');
ok(licenceExcerpt('') === null, 'no document at all should be null, distinct from "no match"');

/* Several clauses: a real terms page states more than one thing, and the one
   that matters may not be first. */
const many = licenceExcerpt(
  '<p>Data is CC BY 4.0.</p>' + '<p>' + 'x '.repeat(200) + '</p>' +
  '<p>Attribution is required.</p>' + '<p>' + 'y '.repeat(200) + '</p>' +
  '<p>Commercial use is permitted.</p>');
ok(many.hits.length >= 2, 'multiple distinct clauses should produce multiple excerpts');
ok(many.hits.length <= 3, 'excerpts should be capped so the report stays readable');

/* Tags are stripped so wording inside markup is still found, and scripts are
   dropped so a JS string does not masquerade as the terms. */
ok(licenceExcerpt('<div><span>Creative</span> Commons <b>CC0</b> dedication</div>').strong,
  'wording split across tags should still match');
const scripted = licenceExcerpt('<script>var t="CC BY 4.0";</script><p>Nothing relevant here.</p>');
ok(scripted && scripted.strong === false, 'wording inside a <script> must not count as a permission');

/* ── error bodies: the diagnosis, not the key names ──
   The first live run came back 503 from the one candidate that filled a real
   gap, and the output printed `{reason, error}` and discarded both values.
   Key names cannot distinguish a bad parameter from a rate limit from an
   outage, and those have completely different consequences. */
ok(/reason: Hourly API request limit exceeded/.test(
  errorBody('{"error":true,"reason":"Hourly API request limit exceeded"}') || ''),
  'an error body should surface the upstream reason verbatim');
ok(/error: true/.test(errorBody('{"error":true,"reason":"x"}') || ''),
  'an error flag should be reported alongside the reason');
ok(errorBody('{"latitude":51.5,"hourly":{}}') === null,
  'a healthy payload should produce no error line at all');
ok(/not json/i.test(errorBody('not json, a plain string') || ''),
  'a non-JSON error body should still be shown, truncated');
ok(errorBody('') === null, 'no body should produce no error line');

/* ── a 200 is not a success ──
   REST Countries answered 200 with {success, data, errors} and the first
   summary counted it among "6 of 8 answered 200 with parseable JSON". */
ok(isErrorEnvelope('{"success":false,"data":null,"errors":["bad fields"]}'),
  'success:false should be an error envelope');
ok(isErrorEnvelope('{"error":true,"reason":"whatever"}'),
  'error:true should be an error envelope');
ok(isErrorEnvelope('{"reason":"x","error":"y"}'),
  'reason plus error should be an error envelope');
ok(isErrorEnvelope('{"data":[],"errors":["one"]}'),
  'a non-empty errors array should be an error envelope');
ok(!isErrorEnvelope('{"data":[1,2],"errors":[]}'),
  'an EMPTY errors array is not an error — that must not be a false positive');
ok(!isErrorEnvelope('{"data":[1,2],"errors":null}'),
  'a null errors field is not an error either');
ok(!isErrorEnvelope('{"latitude":51.5,"hourly":{}}'),
  'a healthy payload is not an error envelope');
ok(!isErrorEnvelope('[{"name":"Brazil"}]'),
  'an array payload is not an error envelope');
ok(!isErrorEnvelope('not json'), 'unparseable text is not an error envelope by this test');

/* ── the candidate list itself ── */
ok(CANDIDATES.length > 0, 'there should be candidates');
ok(CANDIDATES.every((c) => c.terms), 'every candidate must cite a terms URL — that is the filter');
ok(CANDIDATES.every((c) => c.gap), 'every candidate must state the gap it fills, including "NONE"');
ok(!CANDIDATES.some((c) => /pulselive|premier-league-prod/i.test(c.url)),
  'declined site backends must not reappear in the candidate list');

console.log(`${checks - fails}/${checks} checks passed`);
if (fails) process.exit(1);
