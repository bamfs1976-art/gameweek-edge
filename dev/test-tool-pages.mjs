/* The public tool pages: a snapshot reduced from the official feed, and
   every page rendered from it. Run: node dev/test-tool-pages.mjs */
import { buildSnapshot, slugify, TOP_N, HORIZON } from '../scripts/tools/snapshot.mjs';
import { renderAll, teamRuns, TOOLS } from '../scripts/tools/pages.mjs';
import { sitemapXml } from '../scripts/seo/routes.mjs';

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ok  ' + l); } else { fail++; console.log('  FAIL ' + l); } };
const section = (t) => console.log('\n• ' + t);

/* A small league: 4 clubs, 3 gameweeks to come, 30 players with the
   fields the feed carries. */
const teams = [1, 2, 3, 4].map((id) => ({ id, name: ['Arsenal', 'Aston Villa', 'Bournemouth', 'Brøndby Town'][id - 1], short_name: ['ARS', 'AVL', 'BOU', 'BRO'][id - 1], code: 10 + id }));
const events = [{ id: 1, name: 'Gameweek 1', finished: true, is_current: true, deadline_time: '2026-08-15T10:00:00Z' }, { id: 2, name: 'Gameweek 2', finished: false, is_next: true, deadline_time: '2026-08-22T10:00:00Z' }, { id: 3, name: 'Gameweek 3', finished: false, deadline_time: '2026-08-29T10:00:00Z' }, { id: 4, name: 'Gameweek 4', finished: false, deadline_time: '2026-09-05T10:00:00Z' }];
const fixtures = [
  { event: 1, finished: true, team_h: 1, team_a: 2, team_h_difficulty: 3, team_a_difficulty: 4, kickoff_time: '2026-08-15T14:00:00Z' },
  { event: 2, finished: false, team_h: 1, team_a: 3, team_h_difficulty: 2, team_a_difficulty: 4, kickoff_time: '2026-08-22T14:00:00Z' },
  { event: 2, finished: false, team_h: 2, team_a: 4, team_h_difficulty: 2, team_a_difficulty: 5, kickoff_time: '2026-08-22T16:30:00Z' },
  { event: 3, finished: false, team_h: 3, team_a: 2, team_h_difficulty: 3, team_a_difficulty: 3, kickoff_time: '2026-08-29T14:00:00Z' },
  { event: 3, finished: false, team_h: 4, team_a: 1, team_h_difficulty: 5, team_a_difficulty: 1, kickoff_time: '2026-08-29T14:00:00Z' },
  { event: 4, finished: false, team_h: 1, team_a: 2, team_h_difficulty: 3, team_a_difficulty: 3, kickoff_time: null },
  { event: 9, finished: false, team_h: 1, team_a: 2, team_h_difficulty: 1, team_a_difficulty: 1, kickoff_time: null },
];
const elements = [];
for (let i = 1; i <= 30; i++) {
  elements.push({ id: i, code: 1000 + i, web_name: 'Player' + i, first_name: i === 2 ? 'Martin' : 'First' + i, second_name: i === 2 ? 'Ødegaard' : (i === 5 || i === 6 ? 'Same' : 'Second' + i),
    team: ((i - 1) % 4) + 1, element_type: ((i - 1) % 4) + 1, now_cost: 40 + i, selected_by_percent: String(i * 1.5), total_points: 100 - i * 2, form: '3.5', points_per_game: '4.0',
    minutes: 900, goals_scored: i % 3, assists: i % 2, clean_sheets: 1, bonus: 2, expected_goals: '1.25', expected_assists: '0.5', expected_goal_involvements: '1.75',
    status: i === 3 ? 'i' : i === 4 ? 'd' : i === 7 ? 's' : 'a', news: i === 3 ? 'Knee injury, expected back 1 Oct' : i === 4 ? 'Knock' : '', chance_of_playing_next_round: i === 4 ? 75 : null,
    yellow_cards: i === 8 ? 4 : i === 9 ? 9 : 0, red_cards: 0, transfers_in_event: i * 1000, transfers_out_event: (31 - i) * 500, cost_change_event: i === 1 ? 1 : i === 2 ? -1 : 0, cost_change_start: i === 1 ? 2 : 0, ep_next: '4.5' });
}
/* One player with the same name twice tests the slug rule; the first
   element has a name that folds. */
elements[4].first_name = 'Tom'; elements[5].first_name = 'Tom';
const boot = { events, teams, elements, total_players: 11000000 };
const feed = { configured: true, log: { days: { '2026-08-20': [{ id: 1, n: 'Player1', t: 'ARS', p: 1, from: 41, to: 42 }, { id: 2, n: 'Player2', t: 'AVL', p: 2, from: 43, to: 42 }], '2026-08-19': [{ id: 3, n: 'Player3', t: 'BOU', p: 3, from: 50, to: 51 }] } } };

section('the snapshot: a reduction of the feed, nothing invented');
const snap = buildSnapshot(boot, fixtures, feed, '2026-08-21T06:20:00Z');
ok(snap.built === '2026-08-21T06:20:00.000Z' && snap.season === '2026/27' && snap.total === 11000000, 'stamped, with the season and the size of the field');
ok(snap.event.current === 1 && snap.event.next === 2 && snap.event.nextName === 'Gameweek 2', 'the current and next gameweek are read');
ok(snap.teams.length === 4 && snap.teams[3].slug === 'brondby-town', 'teams carry a folded slug (' + snap.teams[3].slug + ')');
ok(snap.fixtures.length === 5 && snap.fixtures.every((f) => f.gw >= 2 && f.gw < 2 + HORIZON), 'fixtures are the unfinished ones inside the horizon, from the next deadline');
ok(snap.players.length === 30 && snap.players[0].id === 1 && snap.players[29].id === 30, 'players are ranked by points');
ok(TOP_N === 200 && buildSnapshot({ events, teams, elements: Array.from({ length: 250 }, (_, i) => ({ id: i + 1, web_name: 'P' + i, total_points: i })) }, [], null).players.length === 200, 'and capped at the top 200');
ok(snap.players[1].slug === 'martin-odegaard', 'a name with Ø slugs to ASCII (' + snap.players[1].slug + ')');
ok(snap.players.find((p) => p.id === 5).slug === 'tom-same-5' && snap.players.find((p) => p.id === 6).slug === 'tom-same-6', 'two players with one name get their id in the slug');
ok(slugify('Kevin De Bruyne') === 'kevin-de-bruyne' && slugify("N'Golo Kanté") === 'n-golo-kante', 'slugs are lower-case ASCII with hyphens');
ok(snap.flags.length === 3 && snap.flags.map((f) => f.status).sort().join('') === 'dis', 'the flagged list is everyone not simply available');
ok(snap.flags[0].own >= snap.flags[1].own, 'most-owned first');
ok(snap.cautions.length === 2 && snap.cautions[0].yc === 9, 'cautions carry the yellow-card count, highest first');
ok(snap.movers.day === '2026-08-20' && snap.movers.rows.length === 2, 'the latest feed day is the day of price changes');
ok(snap.movers.gwUp.length === 1 && snap.movers.gwUp[0].id === 1 && snap.movers.gwDown[0].id === 2, 'the gameweek risers and fallers come from cost_change_event');
ok(snap.movers.bought[0].id === 30 && snap.movers.sold[0].id === 1, 'most bought and most sold by net transfers');
ok(buildSnapshot(boot, fixtures, null).movers.day === null, 'no feed is no day, and the page still has the gameweek changes');

section('the pages: one per tool, one per club, one per player');
const pages = renderAll(snap);
ok(pages.size === 1 + 1 + 4 + 1 + 1 + 1 + 30, pages.size + ' pages: the index, the difficulty table, four clubs, prices, injuries, the player index and thirty players');
for (const t of TOOLS) ok(pages.has(t.path), 'the tool exists at ' + t.path);
const heads = [...pages.entries()].map(([path, html]) => ({ path, title: (html.match(/<title>([^<]*)<\/title>/) || [])[1], desc: (html.match(/<meta name="description" content="([^"]*)"/) || [])[1], canon: (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1], html }));
ok(heads.every((h) => h.title && h.desc && h.canon === 'https://gameweekedge.co.uk' + h.path), 'every page has a title, a description and a canonical that is its own path');
ok(new Set(heads.map((h) => h.title)).size === heads.length && new Set(heads.map((h) => h.desc)).size === heads.length, 'titles and descriptions are unique across every page');
ok(heads.every((h) => /og:image/.test(h.html) && /twitter:card/.test(h.html) && /application\/ld\+json/.test(h.html)), 'every page carries social tags and structured data');
ok(heads.every((h) => !/—/.test(h.html)), 'no em dash on any page');
ok(heads.every((h) => /<a class="brand" href="\/">/.test(h.html) && /href="\/tools\/"/.test(h.html) && /Open the app/.test(h.html)), 'every page links back to the app and the tools index');
ok(heads.every((h) => /updated 21 Aug 2026/.test(h.html) && /not affiliated/.test(h.html)), 'every page states when the data was read and what the app is not');
ok(heads.every((h) => /<a class="skip" href="#main">/.test(h.html) && /<main id="main"/.test(h.html) && /<h1>/.test(h.html)), 'a skip link, a main landmark and one h1');

const diff = pages.get('/tools/fixture-difficulty/');
const runs = teamRuns(snap);
ok(runs[0].team.name === 'Arsenal' && runs[0].avg === 2 && runs[runs.length - 1].team.name === 'Brøndby Town', 'clubs sort easiest run first (' + runs.map((r) => r.team.short + ' ' + (r.avg == null ? '-' : r.avg.toFixed(2))).join(', ') + ')');
ok(/<th>GW2<\/th><th>GW3<\/th><th>GW4<\/th>/.test(diff) && !/GW9/.test(diff), 'the table has a column per gameweek in the window');
ok(/fdr fdr-1/.test(diff) && /fdr fdr-5/.test(diff) && /class="muted">blank</.test(diff), 'difficulty cells are coloured by band and a blank says so');
ok(/href="\/tools\/fixture-difficulty\/arsenal\/"/.test(diff) && /href="\/fixtures"/.test(diff), 'clubs link to their page and the page links into the planner');
const ars = pages.get('/tools/fixture-difficulty/arsenal/');
ok(/Arsenal fixture difficulty/.test(ars) && /Bournemouth \(Home\)/.test(ars) && /players?team=1|players\?team=1/.test(ars), 'a club page lists its fixtures and links to its players in the app');

const prices = pages.get('/tools/price-changes/');
ok(/Price changes on/.test(prices) && /Risers \(1\)/.test(prices) && /Fallers \(1\)/.test(prices), 'the day of changes leads the page with its risers and fallers');
ok(/Changes since the gameweek started/.test(prices) && /Most bought/.test(prices) && /href="\/prices"/.test(prices), 'the gameweek changes and net transfers follow, linking into the Price Predictor');
ok(/£4\.2m/.test(prices) && /\+0\.1/.test(prices), 'prices and changes are in pounds');
const noFeed = renderAll(buildSnapshot(boot, fixtures, null)).get('/tools/price-changes/');
ok(!/Price changes on/.test(noFeed) && /Changes since the gameweek started/.test(noFeed), 'without a feed the day section is absent, not empty');

const inj = pages.get('/tools/injuries/');
ok(/Injured \(1\)/.test(inj) && /Doubtful \(1\)/.test(inj) && /Suspended \(1\)/.test(inj) && /Knee injury, expected back 1 Oct/.test(inj) && /75%/.test(inj), 'flagged players are grouped by status with the news and the chance');
ok(/One yellow card from a ban \(2\)/.test(inj) && /9<\/td><td>10 cards/.test(inj) && /4<\/td><td>5 cards/.test(inj), 'the vendored ladder names who is one caution from a ban, and at which rung');
ok(/href="\/injuries"/.test(inj), 'and links to the fitness lens');

const pl = pages.get('/tools/players/martin-odegaard/');
ok(/<h1>Martin Ødegaard<\/h1>/.test(pl) && /Aston Villa · Defender · £4\.2m · owned by 3\.0% of 11 million managers/.test(pl), 'a player page leads with the name, club, position, price and ownership');
ok(/"@type":"Person"/.test(pl) && /"name":"Martin Ødegaard"/.test(pl) && /"@type":"BreadcrumbList"/.test(pl), 'Person and breadcrumb structured data');
ok(/Next 3 fixtures/.test(pl) && /Brøndby Town \(Home\)/.test(pl) && /players\?q=Player2/.test(pl) && /fixture-difficulty\/aston-villa\//.test(pl), 'the next fixtures with difficulty, and links to the app and the club run');
ok(/Available<\/p>/.test(pl) && /Doubtful, 75% chance of playing\. Knock/.test(pages.get('/tools/players/first4-second4/')), 'availability reads as a sentence');
const idx = pages.get('/tools/players/');
ok(/Tom Same \(Arsenal\) FPL/.test(pages.get('/tools/players/tom-same-5/')) && /Tom Same \(Aston Villa\) FPL/.test(pages.get('/tools/players/tom-same-6/')), 'two players with one name are told apart by club in the title');
ok(/Goalkeepers \(8\)/.test(idx) && /Defenders \(8\)/.test(idx) && (idx.match(/href="\/tools\/players\/[a-z0-9-]+\/"/g) || []).length === 30, 'the player index lists everyone by position');

section('the sitemap takes the tool pages');
const urls = [...pages.keys()].map((path) => ({ path, freq: 'daily', pri: '0.6' }));
const xml = sitemapXml([{ path: '/', tier: 'free' }], [], new Date('2026-08-21T00:00:00Z'), urls);
ok((xml.match(/<loc>/g) || []).length === 1 + urls.length && /<loc>https:\/\/gameweekedge\.co\.uk\/tools\/players\/martin-odegaard\/<\/loc>/.test(xml), 'every tool page once, absolute, trailing slash');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
