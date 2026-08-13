/*
 * Are referees published BEFORE kick-off, or only after?
 *
 * The Fantasy EFL app knows who is one booking from a suspension. It does not
 * know who is refereeing them, and a player on four yellows in front of a
 * strict official is a different risk from the same player in front of a
 * lenient one. That is the feature this probe exists to justify or kill.
 *
 * It turns on ONE fact. football-data.js asserts, in a comment, that
 * "referees are published a couple of days out and then do not move" — and
 * sets a 30-minute cache on that basis. If the comment is wrong, and the
 * array only fills in once a match is over, then the feed can only tell us
 * who refereed a booking that already happened. That is history, not a
 * warning, and the feature is worthless. Nobody has ever checked, because
 * until 13 Aug 2026 the endpoint had never once answered in production.
 *
 * Two competitions, for two different reasons:
 *   ELC — the Championship, the one Fantasy EFL division this project has a
 *         licensed route to. League One and Two are not on the plan, so a
 *         yes here is a partial yes for that app.
 *   PL  — the FPL app, where the same panel would live.
 *
 * Goes through our own deployed proxy, so it needs no key and exercises the
 * path production actually takes.
 *
 * Run:  node dev/probe-referees.mjs [https://origin]
 * CI:   the "Site check" workflow, `referees` input — the sandbox this is
 *       written in cannot reach gameweekedge.co.uk.
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

async function matches(comp) {
  const url = `${ORIGIN}/api/football-data/matchday?competition=${comp}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  if (res.status !== 200) {
    return { error: `${res.status} ${body ? JSON.stringify(body).slice(0, 200) : '(no body)'}` };
  }
  return { list: (body && body.matches) || [], count: (body && body.count) || 0 };
}

/* Buckets by how far from kick-off the match is, because "before kick-off" is
   not one question. A referee that appears two hours out is useless for a
   transfer deadline; one that appears three days out is exactly what the
   suspension panel needs. */
const BUCKETS = [
  { label: 'finished', test: (d) => d < 0, note: 'after the fact — no use for a warning' },
  { label: 'in the next 2 days', test: (d) => d >= 0 && d < 2 },
  { label: '2 to 4 days out', test: (d) => d >= 2 && d < 5, note: 'the deadline window' },
  { label: '5 to 7 days out', test: (d) => d >= 5 && d < 8 },
  { label: 'more than a week out', test: (d) => d >= 8 }
];

console.log(`Referee probe — ${ORIGIN}\n`);

let verdictLines = [];
for (const comp of ['ELC', 'PL']) {
  const { list, error } = await matches(comp);
  if (error) { console.log(`${comp}: the proxy did not answer — ${error}\n`); continue; }
  if (!list.length) { console.log(`${comp}: no matches returned at all\n`); continue; }

  console.log(`${comp} — ${list.length} matches in the feed`);
  const rows = list.map((m) => ({
    id: m.id,
    days: (Date.parse(m.utcDate) - NOW) / 86400000,
    status: m.status,
    ref: mainRef(m)
  }));

  let firstAhead = null;
  for (const b of BUCKETS) {
    const inB = rows.filter((r) => b.test(r.days));
    if (!inB.length) continue;
    const withRef = inB.filter((r) => r.ref);
    const pct = Math.round((withRef.length / inB.length) * 100);
    console.log(`  ${String(b.label).padEnd(22)} ${String(inB.length).padStart(4)} matches · `
      + `${String(withRef.length).padStart(4)} named (${String(pct).padStart(3)}%)`
      + (b.note ? `  — ${b.note}` : ''));
    if (b.label !== 'finished' && withRef.length && !firstAhead) firstAhead = b.label;
  }

  /* The single number that decides it: the furthest-out match that already
     has a referee. Percentages hide this — one named match a week out is the
     difference between a usable panel and a post-mortem. */
  const ahead = rows.filter((r) => r.days > 0 && r.ref).sort((a, b) => b.days - a.days)[0];
  const played = rows.filter((r) => r.days < 0);
  const playedNamed = played.filter((r) => r.ref).length;

  if (ahead) {
    console.log(`  → furthest-out named referee: ${ahead.ref.name} `
      + `${ahead.days.toFixed(1)} days before kick-off (${ahead.status})`);
    verdictLines.push(`${comp}: YES — named up to ${ahead.days.toFixed(1)} days ahead`);
  } else {
    const why = played.length && playedNamed
      ? 'referees appear only AFTER the match'
      : 'no referee is named anywhere in this feed, before or after';
    console.log(`  → no upcoming match has a referee. ${why}`);
    verdictLines.push(`${comp}: NO — ${why}`);
  }
  if (played.length) {
    console.log(`  (control: ${playedNamed} of ${played.length} finished matches name one, `
      + `which says whether the field exists on this plan at all)`);
  } else {
    /* ── The control, when the season has not started ──────────────
       On 13 Aug 2026 both feeds held nothing but future fixtures — 552 for
       the Championship, 380 for the Premier League, not one of them played.
       So "no referee anywhere" was ambiguous in the one way that matters:
       it could mean the field fills closer to kick-off, or that this plan
       never carries it at all. Those imply opposite decisions and the probe
       could not separate them.

       head2head returns PAST meetings for a fixture, and past means
       finished. It is the only route here that can reach a completed match
       before a ball is kicked this season, so it settles the question
       today rather than in a fortnight. */
    const seed = rows.length ? list[rows.findIndex((r) => r.days > 0)] : null;
    if (seed && seed.id) {
      const url = `${ORIGIN}/api/football-data/h2h?id=${seed.id}&limit=10`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      const body = await res.json().catch(() => null);
      const past = ((body && body.matches) || []).filter((m) => m.status === 'FINISHED');
      if (res.status !== 200) {
        console.log(`  (control unavailable: head2head answered ${res.status})`);
      } else if (!past.length) {
        /* Tried on 13 Aug and it came back empty for both competitions. The
           free tier serves the CURRENT SEASON only, and on 13 Aug 2026 the
           current season had not begun — so head2head has no past meeting it
           is allowed to return, and no completed match is reachable on this
           plan by any route. The control is not merely missing, it is
           unobtainable until football is played. */
        console.log('  (control unobtainable: head2head returned no finished match either — the free');
        console.log('   tier serves the current season only, and no match in it has been played yet.');
        console.log('   Re-run this probe once the first round has finished; until then "absent" and');
        console.log('   "not yet published" cannot be told apart.)');
      } else {
        const named = past.filter((m) => mainRef(m));
        console.log(`  (control, via head2head on a past meeting: ${named.length} of ${past.length} `
          + `FINISHED matches name a referee)`);
        verdictLines.push(named.length
          ? `${comp}: and the field DOES populate once a match is over — `
            + `${named.length}/${past.length} finished, e.g. ${mainRef(named[0]).name}`
          : `${comp}: and no FINISHED match names one either — the field is absent on this plan`);
      }
    }
  }
  console.log('');
}

console.log('VERDICT');
for (const v of verdictLines) console.log(`  ${v}`);
console.log('');
console.log('  A "no" for ELC kills the Fantasy EFL referee panel outright — the app would be');
console.log('  telling you who refereed a booking you already took. A "yes" only two days out');
console.log('  is still narrower than the comment in football-data.js claims, and the 30-minute');
console.log('  cache set on that claim would need revisiting either way.');
