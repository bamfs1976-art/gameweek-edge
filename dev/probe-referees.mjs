/*
 * Where can referee appointments actually be read from, and how far ahead?
 *
 * The Fantasy EFL app knows who is one booking from a suspension. It does not
 * know who is refereeing them, and a player on four yellows in front of a
 * strict official is a different risk from the same player in front of a
 * lenient one. That is the feature this probe exists to justify or kill.
 *
 * ── A CORRECTION, 13 Aug 2026 ─────────────────────────────────────────
 * The first version of this probe asked only "does football-data.org carry
 * referees before kick-off", found empty arrays, and reported the answer as
 * "referees are not published before kick-off". That conclusion was wrong,
 * and wrong in the way that matters: it turned a fact about ONE FEED into a
 * claim about the world. The EFL publishes its appointments days ahead —
 * three to nine days ahead, on its own site — which is exactly the horizon
 * the suspension panel needs.
 *
 * So the question was never "are they published". It is "which source do we
 * read them from", and a probe that tests one source can only answer for
 * that source. This version tests two, and says which it is talking about
 * every time it prints a verdict.
 *
 * Part 1 — football-data.org, through our own proxy. Reports whether the
 *   `referees` key is even present in the payload, because "present but
 *   empty" (a tier or timing limit) and "absent from the schema" (this plan
 *   never carries it) point at different fixes and looked identical before.
 * Part 2 — the EFL's own appointments page, which is the source that
 *   demonstrably has the data. Reachability and parseability only; this
 *   builds no scraper and commits us to nothing.
 *
 * ── WHAT IT FOUND, 13 Aug 2026 ────────────────────────────────────────
 * football-data.org: the `referees` key is present on all 552 Championship
 *   and 380 Premier League matches and populated on NONE of them. Present
 *   but never filled is a tier limit, not a schema gap — this plan will not
 *   start carrying them, so no amount of waiting helps.
 * The EFL's own page: HTTP 200 from CI, and the appointments are in the
 *   payload — "Referee" appears 56 times in the raw HTML against 3 in the
 *   visible text, with a __NUXT__ marker, so the content is embedded JSON
 *   rather than fetched after load. No headless browser needed to read it.
 *
 * Which answers the original question: referees ARE published before
 * kick-off, three to nine days ahead, just not by the feed we were asking.
 *
 * Three things this does NOT establish, and none of them is a detail:
 *   · "Readable" is a count, not a parser. Nothing here has extracted a
 *     single referee-to-fixture pairing.
 *   · "Assistant Referee" appears 0 times, so the page may name only the
 *     main official, or name them some other way. Fine for our purpose,
 *     unknown as a fact.
 *   · The specimen URL was handed to us. Finding NEXT week's article is
 *     unsolved and is the actual engineering problem.
 * And before any of that: reading a site's pages on a schedule is a
 * different proposition from consuming an API, and that is a decision for
 * the project's owner, not a consequence of this probe passing.
 *
 * Run:  node dev/probe-referees.mjs [https://origin]
 * CI:   the "Site check" workflow, `referees` input — the sandbox this is
 *       written in can reach neither gameweekedge.co.uk nor www.efl.com.
 */
const ORIGIN = (process.argv[2] || process.env.SITE_ORIGIN || 'https://gameweekedge.co.uk')
  .replace(/\/$/, '');
const UA = 'Mozilla/5.0 (compatible; GameweekEdgeRefProbe/1.0; +https://gameweekedge.co.uk)';
const NOW = Date.now();

/* The main official only. The array also carries assistants and the fourth
   official on some plans, and counting those would report "we have referees"
   for a match whose actual referee is unnamed. */
const mainRef = (m) => ((m && m.referees) || [])
  .find((r) => !r.type || String(r.type).toUpperCase() === 'REFEREE');

/* ═══ Part 1 — what football-data.org's feed carries ═══════════════════ */

async function matches(comp) {
  const url = `${ORIGIN}/api/football-data/matchday?competition=${comp}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  if (res.status !== 200) {
    return { error: `${res.status} ${body ? JSON.stringify(body).slice(0, 200) : '(no body)'}` };
  }
  return { list: (body && body.matches) || [] };
}

const BUCKETS = [
  { label: 'finished', test: (d) => d < 0 },
  { label: 'in the next 2 days', test: (d) => d >= 0 && d < 2 },
  { label: '2 to 4 days out', test: (d) => d >= 2 && d < 5, note: 'the deadline window' },
  { label: '5 to 7 days out', test: (d) => d >= 5 && d < 8 },
  { label: 'more than a week out', test: (d) => d >= 8 }
];

console.log(`Referee source probe — ${ORIGIN}\n`);
console.log('PART 1 — football-data.org, via our proxy\n');

const verdict = [];
for (const comp of ['ELC', 'PL']) {
  const { list, error } = await matches(comp);
  if (error) { console.log(`${comp}: the proxy did not answer — ${error}\n`); continue; }
  if (!list.length) { console.log(`${comp}: no matches returned at all\n`); continue; }

  /* The distinction the first run could not make. A key that is present and
     empty is a plan or timing limit and might fill; a key that is absent
     from every match is not part of what this plan serves at all. */
  const withKey = list.filter((m) => Object.prototype.hasOwnProperty.call(m, 'referees')).length;
  const nonEmpty = list.filter((m) => (m.referees || []).length).length;

  console.log(`${comp} — ${list.length} matches`);
  console.log(`  the "referees" key is present on ${withKey} of them, non-empty on ${nonEmpty}`);

  const rows = list.map((m) => ({ days: (Date.parse(m.utcDate) - NOW) / 86400000, ref: mainRef(m) }));
  for (const b of BUCKETS) {
    const inB = rows.filter((r) => b.test(r.days));
    if (!inB.length) continue;
    const named = inB.filter((r) => r.ref).length;
    console.log(`  ${String(b.label).padEnd(22)} ${String(inB.length).padStart(4)} matches · `
      + `${String(named).padStart(4)} named` + (b.note ? `  — ${b.note}` : ''));
  }

  verdict.push(nonEmpty
    ? `${comp}: football-data DOES carry referees (${nonEmpty} matches)`
    : withKey
      ? `${comp}: football-data returns the key but never fills it — a plan or timing limit, not a schema gap`
      : `${comp}: football-data omits the field entirely on this plan`);
  console.log('');
}

/* ═══ Part 2 — the source that demonstrably has the data ═══════════════ */

/* The EFL publishes appointments as a dated news article covering the week
   ahead. This is the exact URL that prompted the question on 11 Aug, and it
   is used as a fixed, known-good specimen rather than a guess at a pattern:
   the point is to find out whether the page is reachable from CI and whether
   officials and fixtures can be read out of it, not to pretend we have a
   feed. A real implementation would need to discover the weekly URL, which
   is a separate problem and not one to hand-wave. */
const EFL_SPECIMEN = 'https://www.efl.com/news/2026/august/11/referee-appointments--14-20-august/';

console.log('PART 2 — the EFL\'s own appointments page\n');
try {
  const res = await fetch(EFL_SPECIMEN, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  console.log(`  ${EFL_SPECIMEN}`);
  console.log(`  HTTP ${res.status}`);
  if (res.ok) {
    const html = await res.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    /* Counted in BOTH the visible text and the raw HTML, because the first
       run counted only the text and concluded the page did not carry
       appointments. That strip removes <script> blocks — and a modern site
       ships its content as JSON inside exactly those. The extraction had
       deleted the evidence before looking at it, which is the same mistake
       as the verdict this probe is here to correct, one level down. */
    const count = (s, re) => (s.match(re) || []).length;
    const REF = /\bReferee\b/gi, ASSIST = /Assistant\s+Referee/gi;
    console.log(`  ${html.length} bytes`);
    console.log(`  visible text: "Referee" ${count(text, REF)}× · `
      + `"Assistant Referee" ${count(text, ASSIST)}×`);
    console.log(`  raw html:     "Referee" ${count(html, REF)}× · `
      + `"Assistant Referee" ${count(html, ASSIST)}×`);

    /* If the data is embedded, one of these markers says where. If none of
       them appears, the page fetches it after load and the endpoint — not
       this URL — is what a real implementation would have to read. */
    const MARKERS = [
      ['__NEXT_DATA__', /__NEXT_DATA__/],
      ['ld+json', /application\/ld\+json/i],
      ['__NUXT__', /__NUXT__/],
      ['__INITIAL_STATE__', /__INITIAL_STATE__/i],
      ['inline JSON array of objects', /\[\s*\{\s*"/]
    ];
    const found = MARKERS.filter(([, re]) => re.test(html)).map(([n]) => n);
    console.log(`  embedded-data markers: ${found.length ? found.join(', ') : 'none'}`);

    /* Any JSON or API URL the page references, which is where the content
       would be if it is not embedded. Reported, not followed. */
    const endpoints = [...new Set((html.match(/https?:\/\/[^\s"'<>]+?(?:\.json|\/api\/[^\s"'<>]*)/gi) || [])
      .map((u) => u.replace(/[),.]+$/, '')))].slice(0, 6);
    if (endpoints.length) {
      console.log('  JSON/API URLs referenced:');
      for (const e of endpoints) console.log(`    ${e.slice(0, 120)}`);
    }

    const inRaw = count(html, REF);
    const usable = count(text, REF) > 5 || inRaw > 15;
    console.log(usable
      ? '  → appointments look readable from this page'
      : inRaw > count(text, REF)
        ? '  → not in the visible text, but the raw HTML mentions referees more often — '
          + 'embedded or templated, worth a parser'
        : '  → the page does not appear to carry the appointments at all');
    verdict.push(usable
      ? 'EFL site: appointments ARE readable — and this specimen went up 11 Aug for 14-20 Aug, '
        + 'i.e. 3 to 9 days before kick-off'
      : `EFL site: reachable (200) but not parseable from raw HTML — `
        + `${found.length ? 'embedded via ' + found.join('/') : 'no embedded-data marker'}, `
        + 'so the content is fetched after load');
  } else {
    verdict.push(`EFL site: the specimen URL answered ${res.status} — reachable but not this page`);
  }
} catch (err) {
  console.log(`  request failed: ${err.message}`);
  verdict.push(`EFL site: unreachable from CI — ${err.message}`);
}

console.log('\nVERDICT');
for (const v of verdict) console.log(`  ${v}`);
console.log('');
console.log('  The question is WHICH SOURCE, not whether referees exist. A "no" from');
console.log('  football-data says nothing about the EFL, and the first version of this');
console.log('  probe reported one as if it were the other.');
