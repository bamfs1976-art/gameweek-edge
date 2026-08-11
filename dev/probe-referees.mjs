/*
 * Can Fantasy EFL get referees, and are they published early enough to be
 * worth anything?
 *
 * The suspension-risk feature knows which players are one booking from a
 * ban. What it cannot see is who is refereeing them. A player sitting on
 * four yellows in front of a strict official is a different risk from the
 * same player in front of a lenient one, and that is the gap a referee
 * source would close.
 *
 * Two things have to be true before any of that is worth building, and
 * neither can be assumed from here:
 *
 *   1. THE FEED CARRIES REFEREES FOR THE CHAMPIONSHIP. football-data.org's
 *      ELC is the one Fantasy EFL division this project already has a
 *      licensed route to. League One and League Two are not on that plan.
 *   2. THEY ARE PUBLISHED BEFORE THE MATCH. netlify/functions/football-data.js
 *      asserts in a comment that "referees are published a couple of days
 *      out and then do not move". If that is wrong — if referees only appear
 *      once a match is finished — then the feed can tell us who refereed a
 *      booking that already happened, which is history, not a warning. The
 *      whole feature turns on this, and it has never been checked.
 *
 * It also counts whether finished matches carry bookings, because a referee
 * name is only actionable joined to that official's card rate, and the rate
 * has to come from somewhere.
 *
 * Goes through OUR OWN deployed proxy rather than the upstream directly, so
 * it needs no API key of its own and tests the exact path production takes.
 *
 * Run:  node dev/probe-referees.mjs [https://origin]
 */
const ORIGIN = (process.argv[2] || process.env.SITE_ORIGIN || 'https://gameweekedge.co.uk')
  .replace(/\/$/, '');
const UA = 'Mozilla/5.0 (compatible; GameweekEdgeProbe/1.0; +https://gameweekedge.co.uk)';

async function get(path) {
  const res = await fetch(ORIGIN + path, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* status still tells us something */ }
  return { status: res.status, json, head: json ? null : text.slice(0, 200) };
}

const refereeOf = (m) => {
  const list = Array.isArray(m && m.referees) ? m.referees : [];
  const main = list.find((r) => !r.type || /^REFEREE$/i.test(r.type)) || list[0];
  return main && main.name ? main.name : null;
};

console.log(`Referee probe — ${ORIGIN}\n`);

const res = await get('/api/football-data/matchday?competition=ELC');
console.log(`GET /api/football-data/matchday?competition=ELC → ${res.status}`);
if (res.status !== 200 || !res.json) {
  console.log(`  ${res.head || JSON.stringify(res.json).slice(0, 300)}`);
  console.log('\n✗ The Championship feed did not answer. Nothing below can be judged.');
  process.exit(1);
}

const matches = Array.isArray(res.json.matches) ? res.json.matches
  : Array.isArray(res.json) ? res.json : [];
console.log(`  ${matches.length} matches returned\n`);

if (!matches.length) {
  console.log('✗ No matches. Either the season has not been published or the plan does not cover ELC.');
  process.exit(1);
}

/* Split by whether the match has happened. This is the whole question: a
   referee on a SCHEDULED match is a warning; one on a FINISHED match is a
   history lesson. */
const scheduled = matches.filter((m) => /SCHEDULED|TIMED|POSTPONED/i.test(String(m.status)));
const finished = matches.filter((m) => /FINISHED/i.test(String(m.status)));

const withRef = (list) => list.filter((m) => refereeOf(m)).length;

console.log('Referees present:');
console.log(`  scheduled/upcoming  ${withRef(scheduled)} of ${scheduled.length}`
  + (scheduled.length ? ` (${Math.round((withRef(scheduled) / scheduled.length) * 100)}%)` : ''));
console.log(`  finished            ${withRef(finished)} of ${finished.length}`
  + (finished.length ? ` (${Math.round((withRef(finished) / finished.length) * 100)}%)` : ''));

const sample = matches.find((m) => refereeOf(m));
if (sample) {
  console.log(`\nSample: ${sample.homeTeam && sample.homeTeam.name} v ${sample.awayTeam && sample.awayTeam.name}`);
  console.log(`  status ${sample.status}, utcDate ${sample.utcDate}, referee "${refereeOf(sample)}"`);
  console.log(`  officials array: ${JSON.stringify(sample.referees).slice(0, 300)}`);
} else {
  console.log('\nNo match in this response carries a referee at all.');
}

/* Card rates have to come from somewhere. If the match objects carry
   bookings, they can be accumulated per official; if they do not, a referee
   name on its own cannot be turned into a risk number and the feature needs
   a second source before it is worth starting. */
const bookingKeys = ['bookings', 'cards', 'yellowCards'];
const withBookings = matches.filter((m) => bookingKeys.some((k) => m[k] != null)).length;
console.log(`\nMatches carrying a bookings/cards field: ${withBookings} of ${matches.length}`);
if (finished.length) {
  console.log(`  keys on a finished match: ${Object.keys(finished[0]).join(', ')}`);
}

console.log('\nVERDICT');
if (scheduled.length && withRef(scheduled) > 0) {
  console.log('  ✓ Referees ARE published before kickoff for the Championship — the');
  console.log('    "who referees your player this weekend" join is possible.');
} else if (scheduled.length) {
  console.log('  ✗ No scheduled match carries a referee. The comment in');
  console.log('    football-data.js ("published a couple of days out") does not hold');
  console.log('    here, so this feed cannot warn anyone in advance.');
} else {
  console.log('  · No scheduled matches in this response, so the advance question is');
  console.log('    unanswered. Re-run once a matchday is upcoming.');
}
if (!withBookings) {
  console.log('  · No bookings field on any match, so card rates need another source.');
}
