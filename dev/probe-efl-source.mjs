/*
 * How would we actually READ the EFL's referee appointments?
 *
 * dev/probe-referees.mjs answered "is the data there" — yes, embedded, three
 * to nine days ahead. This answers the two questions that decide whether a
 * parser is twenty lines or a maintenance liability, and they are the two
 * that a scope written from guesses would get wrong:
 *
 *   1. SHAPE. Is the appointments table structured JSON inside the Nuxt
 *      payload — fixture, referee, assistants as fields — or is it a blob of
 *      CMS HTML that happens to live inside JSON? The first is a mapping.
 *      The second is an HTML scrape wearing a JSON coat, and it breaks when
 *      an editor changes a table to a list.
 *
 *   2. DISCOVERY. The specimen URL was handed to us. Is there an index, an
 *      RSS feed or a sitemap that lists next week's article, or would a
 *      scheduled job have to GUESS a dated slug? Guessing is the difference
 *      between a feed and a thing that silently stops working in October.
 *
 * It also reads robots.txt, and not as a formality. Reading a site's pages
 * on a schedule is a different proposition from consuming an API; what the
 * site asks of automated clients is an input to that decision, and it should
 * be on the record before anyone writes a scraper, not after.
 *
 * Reports shapes, counts and short samples. It deliberately does not dump
 * payloads into a public CI log.
 *
 * Run:  node dev/probe-efl-source.mjs
 * CI:   the "Site check" workflow, `referees` input.
 */
const UA = 'Mozilla/5.0 (compatible; GameweekEdgeRefProbe/1.0; +https://gameweekedge.co.uk)';
const BASE = 'https://www.efl.com';
const SPECIMEN = `${BASE}/news/2026/august/11/referee-appointments--14-20-august/`;

const get = async (url, accept = 'text/html') => {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept } });
    return { status: res.status, body: res.ok ? await res.text() : '', ok: res.ok };
  } catch (err) { return { status: 0, body: '', ok: false, err: err.message }; }
};

console.log('EFL source probe\n');

/* ═══ 1. robots.txt — what the site asks of automated clients ═══════════ */
console.log('1. robots.txt');
{
  const r = await get(`${BASE}/robots.txt`, 'text/plain');
  console.log(`   HTTP ${r.status}${r.err ? ` (${r.err})` : ''}`);
  if (r.ok) {
    const lines = r.body.split('\n').map((l) => l.trim()).filter(Boolean);
    /* PRINTED IN FULL, not filtered. The first version of this walked the
       file looking for a `User-agent: *` group, matched nothing, printed
       nothing, and still concluded "/news/ is not disallowed" — which was
       the absence of a matched rule dressed up as a permission. That is the
       third time in this investigation that an extractor has reported a
       measurement of itself as a measurement of the world, and the first two
       reached a user before being caught.

       Permission is exactly the wrong place to be clever. The file is nine
       lines. Quote it and let a human read it. */
    console.log(`   ${lines.length} non-empty lines, verbatim:`);
    for (const l of lines.slice(0, 40)) console.log(`     ${l}`);
    if (lines.length > 40) console.log(`     … ${lines.length - 40} more`);
    console.log('   → read the above; this probe deliberately draws no conclusion from it');
  }
}

/* ═══ 2. the payload's shape ════════════════════════════════════════════ */
console.log('\n2. the article payload');
const article = await get(SPECIMEN);
console.log(`   HTTP ${article.status}, ${article.body.length} bytes`);
if (article.ok) {
  const html = article.body;

  /* Nuxt 2 puts state in `window.__NUXT__={...}`; Nuxt 3 uses a JSON script
     tag. Detect which, because they need different extraction. */
  const nuxt2 = /window\.__NUXT__\s*=/.test(html);
  const nuxt3 = /<script[^>]+id="__NUXT_DATA__"/.test(html);
  console.log(`   marker: ${nuxt2 ? 'Nuxt 2 (window.__NUXT__=)' : ''}`
    + `${nuxt3 ? 'Nuxt 3 (__NUXT_DATA__ script)' : ''}`
    + `${!nuxt2 && !nuxt3 ? 'neither — check again' : ''}`);

  /* Where do the referee mentions actually sit? Context around the first few
     tells us structured-vs-HTML without printing the payload. */
  const hits = [...html.matchAll(/Referee/g)].map((m) => m.index).slice(0, 4);
  console.log(`   "Referee" appears ${(html.match(/Referee/g) || []).length}× — first contexts:`);
  for (const i of hits) {
    const s = html.slice(Math.max(0, i - 90), i + 90).replace(/\s+/g, ' ');
    console.log(`     …${s}…`);
  }

  /* The question that decides the parser: is the body CMS HTML inside a JSON
     string? Escaped tags are the tell. */
  const escapedTags = (html.match(/\\u003c(?:p|td|tr|table|li|strong)\\u003e/gi) || []).length
    + (html.match(/<\\\/?(?:p|td|tr|table|li|strong)>/gi) || []).length;
  console.log(`   escaped HTML tags inside the payload: ${escapedTags}`);
  console.log(`   → the body is ${escapedTags > 5 ? 'CMS HTML carried inside JSON — a scrape, not a mapping'
    : 'not obviously HTML-in-JSON; may be structured fields'}`);
}

/* ═══ 3. discovery — index, feed, sitemap ═══════════════════════════════ */
console.log('\n3. how next week\'s article would be found');
if (article.ok) {
  const alts = [...article.body.matchAll(/<link[^>]+rel="alternate"[^>]*>/gi)].map((m) => m[0]);
  console.log(`   <link rel="alternate"> tags in the article: ${alts.length}`);
  for (const a of alts.slice(0, 4)) console.log(`     ${a.slice(0, 150)}`);
}
for (const path of ['/news/', '/rss', '/news/rss', '/feed', '/sitemap.xml']) {
  const r = await get(BASE + path, 'text/html,application/xml');
  const marker = r.ok && /referee-appointments/i.test(r.body);
  const count = r.ok ? (r.body.match(/referee-appointments/gi) || []).length : 0;
  console.log(`   ${path.padEnd(12)} HTTP ${String(r.status).padEnd(4)}`
    + `${r.ok ? `${r.body.length} bytes · "referee-appointments" ${count}×` : (r.err || '')}`
    + `${marker ? '  ← lists the article' : ''}`);
  /* A sitemap that indexes news is the cheapest possible discovery: one
     fetch, no guessing, and it fails loudly when the pattern changes. */
  if (marker) {
    const m = r.body.match(/https?:\/\/[^\s"'<>]*referee-appointments[^\s"'<>]*/i);
    if (m) console.log(`     e.g. ${m[0].slice(0, 130)}`);
  }
}

console.log('\nWhat this decides:');
console.log('  · a structured payload means a mapping; HTML-in-JSON means a scrape with a');
console.log('    shelf life, and the difference is most of the maintenance cost');
console.log('  · an index, feed or sitemap that lists the article means discovery is one');
console.log('    fetch; without one, a scheduled job has to guess a dated slug and will');
console.log('    fail silently the first week the EFL words it differently');
