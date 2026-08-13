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
    /* Three independent signals that the page really carries appointments,
       rather than that some page answered 200. */
    const refWord = (text.match(/\bReferee\b/gi) || []).length;
    const assistants = (text.match(/\bAssistant Referee\b/gi) || []).length;
    const versus = (text.match(/\bv\b/g) || []).length;
    console.log(`  ${html.length} bytes · "Referee" ${refWord}× · "Assistant Referee" ${assistants}× `
      + `· fixture "v" separators ${versus}×`);
    const usable = refWord > 5 && versus > 5;
    console.log(usable
      ? '  → the page carries appointments in readable text'
      : '  → 200, but the text does not look like an appointments list (JS-rendered?)');
    verdict.push(usable
      ? 'EFL site: appointments ARE published ahead — this specimen went up 11 Aug for 14-20 Aug, '
        + 'i.e. 3 to 9 days before kick-off'
      : 'EFL site: reachable, but the appointments were not readable from the raw HTML');
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
