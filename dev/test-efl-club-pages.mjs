/*
 * Fantasy EFL club pages (scripts/efl/clubpages/).
 *
 * Seventy-two generated pages is exactly the shape that earns a site a
 * doorway-page penalty if it is done lazily, and exactly the shape nobody
 * proofreads by hand. So what is worth pinning is the stuff that makes them
 * real pages rather than a name swapped into a template:
 *
 *   · every page has its OWN title, description and canonical, and the
 *     canonical agrees with where the page is written;
 *   · the set is a mesh, not a hub and spokes, because a crawler that has
 *     to re-enter from the top for each page leaves most of them in
 *     "discovered, currently not indexed";
 *   · the body carries this club's own football, not boilerplate;
 *   · a club name is escaped before it reaches the HTML;
 *   · no snapshot degrades to no pages, never to pages with no data.
 *
 * Run: node dev/test-efl-club-pages.mjs
 */
import { buildClubSnapshot, slugify, loadClubSnapshot, MINIMUM_CLUBS } from '../scripts/efl/clubpages/snapshot.mjs';
import { renderAll, BASE, DISCLAIMER } from '../scripts/efl/clubpages/pages.mjs';
import { buildSampleSnapshot } from '../efl/app/assets/sample-data.js';

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ok  ' + l); } else { fail++; console.log('  FAIL ' + l); } };
const section = (t) => console.log('\n• ' + t);

const snap = buildClubSnapshot(buildSampleSnapshot(), { built: '2026-09-19T12:00:00Z' });
const pages = renderAll(snap);
const head = (html, re) => (html.match(re) || [])[1] || '';
const title = (h) => head(h, /<title>([\s\S]*?)<\/title>/);
const desc = (h) => head(h, /name="description" content="([^"]*)"/);
const canonical = (h) => head(h, /rel="canonical" href="([^"]*)"/);

section('the snapshot describes the whole league');
{
  ok(snap.clubs.length === 72, 'seventy-two clubs, which is the size of the EFL');
  const divisions = new Set(snap.clubs.map((c) => c.division));
  ok(divisions.size === 3, 'all three divisions are represented');
  ok(snap.clubs.every((c) => c.name && c.slug && c.divisionName), 'each carries a name, a slug and a division in words');
  ok(snap.clubs.every((c) => c.rating >= 0 && c.rating <= 100), 'ratings stay on the 0-100 scale the app uses');
  const sorted = snap.clubs.every((c, i) => i === 0 || snap.clubs[i - 1].rating >= c.rating);
  ok(sorted, 'clubs come back best-rated first, so a reader lands on an ordered list');
}

section('slugs are URLs a person could have guessed, and unique');
{
  const slugs = snap.clubs.map((c) => c.slug);
  ok(new Set(slugs).size === slugs.length, 'no two clubs share a slug, so no page silently overwrites another');
  ok(slugs.every((s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)), 'every slug is lowercase, hyphenated and URL-safe');
  ok(slugify('Sheffield Wednesday') === 'sheffield-wednesday', 'a two-word name reads as you would type it');
  ok(slugify('Forest Green Rovers') === 'forest-green-rovers', 'and a three-word one');
  ok(slugify('Crewe & Alsager') === 'crewe-and-alsager', 'an ampersand becomes a word rather than vanishing');
  ok(slugify('  Spaced  Out  ') === 'spaced-out', 'stray whitespace does not leave empty segments');
}

section('every page is its own page');
{
  ok(pages.size === 72, 'one page per club');
  const titles = new Set(), descs = new Set(), canons = new Set();
  let mismatched = 0, missingClubName = 0;
  for (const [path, html] of pages) {
    titles.add(title(html)); descs.add(desc(html)); canons.add(canonical(html));
    if (canonical(html) !== 'https://gameweekedge.co.uk' + path) mismatched++;
    const club = snap.clubs.find((c) => path === BASE + c.slug + '/');
    if (!club || !title(html).includes(club.name)) missingClubName++;
  }
  ok(titles.size === 72, 'seventy-two different titles, not one template with a name in it');
  ok(descs.size === 72, 'seventy-two different descriptions');
  ok(canons.size === 72, 'seventy-two different canonicals');
  ok(mismatched === 0, 'each canonical points at the path the page is actually written to');
  ok(missingClubName === 0, 'each title names its own club');
  ok([...pages.keys()].every((p) => p.startsWith(BASE) && p.endsWith('/')), 'every path is a directory URL under the clubs hub');
  ok(![...pages.keys()].includes(BASE),
    'the hub itself is NOT generated: /fantasy-efl/clubs/ is the app\'s own club picker and must not be overwritten');
}

section('the set is a mesh, so a crawler that lands anywhere can reach everything');
{
  const [, sample] = [...pages.entries()][0];
  /* Match RELATIVE hrefs only: the canonical and og:url carry the page's
     own absolute URL, and counting those would report a self-link that
     the body does not have. */
  const linked = new Set([...sample.matchAll(/href="(\/fantasy-efl\/clubs\/[a-z0-9-]+\/)"/g)].map((m) => m[1]));
  ok(linked.size >= 71, 'one club page links to every other club page, not just back to a hub');
  const self = snap.clubs[0];
  ok(!linked.has(BASE + self.slug + '/'), 'except its own, which is shown as plain text rather than a link to itself');
  ok(sample.includes('<a href="/fantasy-efl/">'), 'and back into the app');
}

section('the body carries this club\'s own football');
{
  const club = snap.clubs.find((c) => c.players.length && c.fixtures.length);
  const html = pages.get(BASE + club.slug + '/');
  ok(html.includes(club.players[0].name), 'its best-rated player is named');
  ok(html.includes(String(club.points)), 'its league points are on the page');
  ok(html.includes(club.divisionName), 'its division is named in words, not a slug');
  ok(html.includes(club.summary), 'the club rating explains itself in the same sentence the app uses');
  const other = snap.clubs.find((c) => c.slug !== club.slug && c.players.length);
  const otherHtml = pages.get(BASE + other.slug + '/');
  ok(!otherHtml.includes(club.players[0].name) || club.players[0].name === other.players[0].name,
    'a different club gets different players, which is what stops these being doorway pages');
}

section('the things a public page must always carry');
{
  let noDisclaimer = 0, noViewport = 0, noSkip = 0, noLang = 0;
  for (const [, html] of pages) {
    if (!html.includes(DISCLAIMER)) noDisclaimer++;
    if (!html.includes('name="viewport"')) noViewport++;
    if (!html.includes('class="skip"')) noSkip++;
    if (!html.includes('lang="en-GB"')) noLang++;
  }
  ok(noDisclaimer === 0, 'every page says it is not the official game, because the game is somebody else\'s');
  ok(noViewport === 0, 'every page has a viewport, so it works on the phone most of them are read on');
  ok(noSkip === 0, 'every page has a skip link');
  ok(noLang === 0, 'every page declares British English');
}

section('a club name reaches the HTML escaped');
{
  const nasty = {
    ...snap.clubs[0],
    name: 'Sheff & <script>alert(1)</script> "United"',
    slug: 'nasty',
    players: [{ name: 'A. <b>Player</b>', position: 'MID', rating: 50, status: 'available', minutesShare: 90, summary: 'x' }],
  };
  const html = renderAll({ ...snap, clubs: [nasty] }).get(BASE + 'nasty/');
  ok(!html.includes('<script>alert(1)</script>'), 'a script tag in a club name never reaches the page as markup');
  ok(html.includes('&lt;script&gt;'), 'it is escaped instead');
  ok(!html.includes('<b>Player</b>'), 'the same for a player name');
  ok(html.includes('&amp;'), 'an ampersand is escaped rather than left to open an entity');
}

section('no data degrades to no pages');
{
  ok(renderAll(null).size === 0, 'a missing snapshot renders nothing rather than throwing');
  ok(renderAll({ clubs: [] }).size === 0, 'an empty one renders nothing');
  ok(renderAll({ clubs: [{ name: 'No Slug' }] }).size === 0, 'a club with no slug is skipped rather than written to a bad path');
}

section('the loader: the half that talks to the feed, driven with stubs');
{
  /* This is here because the first version of it lived inside the CLI's
     `if (import.meta.url === …)` block, where no test could reach it. It
     called the provider with no argument, every test passed, and it threw
     on the first real run against the live feed. */
  const docs = { squads: [], players: [], rounds: [] };
  const fakeSnapshot = { clubs: [], players: [], fixtures: [], currentRound: 7, source: { label: 'stub' } };
  const full = { ...fakeSnapshot };

  let sawDocs = null, sawOpts = null;
  const loaded = await loadClubSnapshot({
    now: Date.parse('2026-09-19T12:00:00Z'),
    fetchDocuments: async () => docs,
    buildOfficialSnapshot: (d, opts) => { sawDocs = d; sawOpts = opts; return buildSampleSnapshot(); },
  });
  ok(sawDocs === docs, 'whatever the feed returned is handed straight to the app\'s own mapping');
  ok(sawOpts && sawOpts.now === Date.parse('2026-09-19T12:00:00Z'), 'and the clock is passed in, not read from the wall');
  ok(loaded.clubs.length === 72, 'a healthy feed produces a full snapshot');
  ok(loaded.built === '2026-09-19T12:00:00.000Z', 'the build stamp is the injected clock, so a test can pin it');

  let refused = null;
  try {
    await loadClubSnapshot({
      fetchDocuments: async () => docs,
      buildOfficialSnapshot: () => ({ ...full, clubs: [], players: [], fixtures: [] }),
    });
  } catch (err) { refused = err; }
  ok(refused, 'a feed that lost the league is refused rather than written');
  ok(/72/.test(refused.message) && /0 clubs/.test(refused.message),
    'and the refusal says what it got and what it expected, because this runs unattended');
  ok(MINIMUM_CLUBS > 0 && MINIMUM_CLUBS < 72, 'the floor leaves room for a club being temporarily absent, but not for half the league');

  let threw = null;
  try { await loadClubSnapshot({ fetchDocuments: async () => { throw new Error('feed answered 503'); } }); } catch (e) { threw = e; }
  ok(threw && /503/.test(threw.message), 'a feed that is down surfaces its own error rather than a stack trace about undefined');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
