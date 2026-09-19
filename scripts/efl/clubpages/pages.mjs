/* Fantasy EFL — a page per club, rendered from the committed snapshot.

   Static, indexable, no script beyond the theme read, and every number on
   them comes from scripts/efl/clubpages/snapshot.mjs rather than a hand.
   Pure: renderAll(snap) returns a Map of path to HTML, so the whole set of
   seventy-two is testable without a browser or a build.

   The frame borrows the tool pages' stylesheet and mark (scripts/tools/
   pages.mjs) so the two generated sets look like one site, and nothing
   else: the navigation, the breadcrumb and the footer all belong to a
   different game and are written here. */
import { CSS, LOGO, esc } from '../../tools/pages.mjs';

const SITE = 'https://gameweekedge.co.uk';
const BASE = '/fantasy-efl/clubs/';

/* The one sentence the whole app is careful about. It is on every public
   surface because the game is somebody else's. */
const DISCLAIMER = 'Gameweek Edge is an independent app and is not affiliated with, '
  + 'endorsed by or associated with the EFL or the official Fantasy EFL game.';

const NAV = [
  { path: '/fantasy-efl/', label: 'Dashboard' },
  { path: '/fantasy-efl/fixtures/', label: 'Fixtures' },
  { path: '/fantasy-efl/players/', label: 'Players' },
  { path: '/fantasy-efl/clubs/', label: 'Clubs' },
  { path: '/fantasy-efl/how-to-play/', label: 'How to play' },
];

const fmtStamp = (iso) => {
  try {
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  } catch (_) { return String(iso); }
};

const ordinal = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  const s = ['th', 'st', 'nd', 'rd'], m = v % 100;
  return v + (s[(m - 20) % 10] || s[m] || s[0]);
};

const fdr = (d) => '<span class="fdr fdr-' + d + '" title="Modelled difficulty ' + d + ' of 5">' + d + '</span>';

function frame({ title, desc, path, h1, lede, body, snap, jsonld }) {
  const url = SITE + path;
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Gameweek Edge', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Fantasy EFL', item: SITE + '/fantasy-efl/' },
      { '@type': 'ListItem', position: 3, name: 'Clubs', item: SITE + BASE },
      ...(path !== BASE ? [{ '@type': 'ListItem', position: 4, name: h1, item: url }] : []),
    ],
  };
  return '<!DOCTYPE html>\n<html lang="en-GB" data-theme="dark">\n<head>\n<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n'
    + '<title>' + esc(title) + '</title>\n<meta name="description" content="' + esc(desc) + '">\n'
    + '<link rel="canonical" href="' + esc(url) + '">\n'
    + '<meta property="og:type" content="website">\n<meta property="og:site_name" content="Gameweek Edge">\n'
    + '<meta property="og:title" content="' + esc(title) + '">\n<meta property="og:description" content="' + esc(desc) + '">\n'
    + '<meta property="og:url" content="' + esc(url) + '">\n<meta property="og:image" content="' + SITE + '/icons/og.png">\n'
    + '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="' + esc(title) + '">\n'
    + '<meta name="twitter:description" content="' + esc(desc) + '">\n<meta name="twitter:image" content="' + SITE + '/icons/og.png">\n'
    + '<meta name="theme-color" content="#0a0c0f">\n'
    + '<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">\n'
    + '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">\n'
    + '<script type="application/ld+json">' + JSON.stringify(crumbs).replace(/<\//g, '<\\/') + '</script>\n'
    + (jsonld ? '<script type="application/ld+json">' + JSON.stringify(jsonld).replace(/<\//g, '<\\/') + '</script>\n' : '')
    + '<script>(function(){try{var t=localStorage.getItem("ge-theme");document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark");}catch(e){}})();</script>\n'
    + '<style>' + CSS + '</style>\n</head>\n<body>\n<a class="skip" href="#main">Skip to content</a>\n'
    + '<header class="hdr"><div class="wrap hdr-in"><a class="brand" href="/">' + LOGO + '<span>Gameweek Edge</span></a>'
    + '<span class="hdr-sp"></span><nav class="nav" aria-label="Fantasy EFL">'
    + NAV.map((n) => '<a href="' + n.path + '">' + n.label + '</a>').join('')
    + '<a class="btn btn-primary" href="/fantasy-efl/">Open the app</a></nav></div></header>\n'
    /* h1 and lede are DATA here (a club's name), not a literal the way
       the FPL tool pages pass them, so they are escaped on the way in
       rather than trusted. `body` is assembled markup and escapes its
       own values as it goes. */
    + '<main id="main" class="wrap"><h1>' + esc(h1) + '</h1><p class="lede">' + esc(lede) + '</p>' + body + '</main>\n'
    + '<footer><div class="wrap"><p>Ratings are modelled, from the official Fantasy EFL feed, built '
    + esc(fmtStamp(snap.built)) + (snap.round ? ', round ' + esc(String(snap.round)) : '') + '. '
    + 'These pages are generated from the data, not written by hand. ' + DISCLAIMER + '</p>'
    + '<p class="flinks"><a href="/fantasy-efl/">Fantasy EFL</a> <a href="/fantasy-efl/how-to-play/">How to play</a> '
    + '<a href="/fantasy-efl/record/">The model\'s record</a> <a href="/">Gameweek Edge (FPL)</a></p></div></footer>\n'
    + '</body>\n</html>\n';
}

/* EVERY CLUB, ON EVERY CLUB PAGE.
   The same lesson the FPL tool pages learned the hard way: a generated set
   whose pages only link back to their own hub is one a crawler has to
   re-enter from the top for each page, and that is exactly the shape that
   sits in "discovered, currently not indexed". Linking them to each other
   makes the set a mesh, and with seventy-two clubs across three divisions
   it is also the useful thing for a reader comparing two of them. */
function clubStrip(snap, currentSlug) {
  const byDivision = new Map();
  for (const c of snap.clubs) {
    if (!byDivision.has(c.divisionName)) byDivision.set(c.divisionName, []);
    byDivision.get(c.divisionName).push(c);
  }
  return [...byDivision.entries()].map(([division, list]) => '<div class="card"><p class="card-title">'
    + esc(division) + ', best rated first</p><ul class="list inline">'
    + list.map((c) => (c.slug === currentSlug
      ? '<li><b>' + esc(c.name) + '</b></li>'
      : '<li><a href="' + BASE + c.slug + '/">' + esc(c.name) + '</a></li>')).join('')
    + '</ul></div>').join('');
}

function fixtureCard(club) {
  if (!club.fixtures.length) {
    return '<div class="card"><p class="card-title">Next fixtures</p><p class="muted">No fixtures in the data for this club yet.</p></div>';
  }
  const rows = club.fixtures.map((r) => {
    const cells = r.blank
      ? '<span class="muted">Blank round</span>'
      : r.matches.map((m) => fdr(m.rating) + ' ' + esc(m.opponent) + ' (' + (m.home ? 'H' : 'A') + ')').join('<br>');
    return '<tr><td>Round ' + esc(String(r.round)) + '</td><td>' + cells
      + (r.double ? ' <span class="badge badge-green">Double</span>' : '') + '</td></tr>';
  }).join('');
  return '<div class="card"><p class="card-title">Next fixtures, with modelled difficulty</p>'
    + '<div class="scroll"><table><thead><tr><th>Round</th><th>Opponent</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '<p class="muted" style="margin:10px 0 0">1 is the most favourable, 5 the least. Difficulty is modelled from the '
    + 'opponent\'s points per game, attack and defence, measured <b>within their own division</b> so a League Two side '
    + 'is not flattered against Championship opposition. The <a href="/fantasy-efl/fixtures/">fixture ticker</a> has every club.</p></div>';
}

function playerCard(club) {
  if (!club.players.length) {
    return '<div class="card"><p class="card-title">Players worth a look</p><p class="muted">No rated players at this club yet.</p></div>';
  }
  const rows = club.players.map((p) => '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.position) + '</td>'
    + '<td class="num">' + p.rating.toFixed(1) + '</td><td class="num">' + p.minutesShare + '%</td>'
    + '<td>' + (p.status === 'available' ? '<span class="badge badge-green">Available</span>'
      : '<span class="badge badge-red">' + esc(p.status) + '</span>') + '</td></tr>').join('');
  return '<div class="card"><p class="card-title">' + esc(club.name) + ' players, best rated first</p>'
    + '<div class="scroll"><table><thead><tr><th>Player</th><th>Pos</th><th class="num">Rating</th>'
    + '<th class="num">Minutes</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '<p class="muted" style="margin:10px 0 0">A modelled 0-100 rating from minutes, form, output, fixture and home '
    + 'advantage. Minutes is the share of the club\'s available football played, and it is the strongest single signal '
    + 'in this game: across 83,698 real appearances, a player averaging under 30 minutes in his last five returns 0.59 '
    + 'points the following round, one averaging 75 or more returns 4.25. The '
    + '<a href="/fantasy-efl/players/">player finder</a> has the rest.</p></div>';
}

function riskCard(club) {
  if (!club.unavailable.length && !club.cardRisk.length) return '';
  const out = club.unavailable.length
    ? '<p class="card-title">Unavailable</p><ul class="list">' + club.unavailable.map((p) => '<li>' + esc(p.name)
      + ' <span class="badge badge-red">' + esc(p.status) + '</span>'
      + (p.news ? ' <span class="muted">' + esc(p.news) + '</span>' : '') + '</li>').join('') + '</ul>'
    : '';
  const cards = club.cardRisk.length
    ? '<p class="card-title" style="margin-top:14px">One booking from a ban</p><ul class="list">'
      + club.cardRisk.map((p) => '<li>' + esc(p.name) + ' <span class="badge badge-amber">'
        + esc(p.note || 'card risk') + '</span></li>').join('') + '</ul>'
    : '';
  return '<div class="card">' + out + cards + '</div>';
}

export function pageClub(snap, club) {
  const where = ordinal(club.position) + ' in ' + club.divisionName;
  const best = club.players[0];
  const body = '<div class="card"><div class="grid">'
    + '<div class="stat"><div class="stat-l">Club rating</div><div class="stat-v">' + club.rating.toFixed(1) + '</div></div>'
    + '<div class="stat"><div class="stat-l">League position</div><div class="stat-v">' + esc(ordinal(club.position)) + '</div></div>'
    + '<div class="stat"><div class="stat-l">Points</div><div class="stat-v">' + esc(String(club.points)) + '</div></div>'
    + '<div class="stat"><div class="stat-l">Played</div><div class="stat-v">' + esc(String(club.played)) + '</div></div>'
    + '</div><p class="muted" style="margin:12px 0 0">' + esc(club.summary) + '</p></div>'
    + fixtureCard(club) + playerCard(club) + riskCard(club)
    + '<div class="card"><p class="card-title">Build a side around them</p><p>The '
    + '<a href="/fantasy-efl/">Fantasy EFL dashboard</a> picks a legal seven across all seventy-two clubs, rates the '
    + 'side you already hold and names the one change worth making. The game lets you take '
    + '<b>no more than two players from any one club</b>, so ' + esc(club.name) + ' can give you at most two of your '
    + 'seven unless you play the One Club chip.</p></div>'
    + clubStrip(snap, club.slug);

  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'SportsTeam',
    name: club.name,
    sport: 'Association football',
    memberOf: { '@type': 'SportsOrganization', name: club.divisionName },
    url: SITE + BASE + club.slug + '/',
  };

  return frame({
    title: club.name + ' Fantasy EFL: ratings, fixtures and players | Gameweek Edge',
    desc: club.name + ' in the official Fantasy EFL game: a modelled club rating, the next fixtures with '
      + 'difficulty, and the ' + club.divisionName + ' side\'s best-rated players'
      + (best ? ', led by ' + best.name : '') + '. Generated from the official feed.',
    path: BASE + club.slug + '/',
    h1: club.name + ' in Fantasy EFL',
    lede: club.name + ' sit ' + where + '. Below is the model\'s read on them as a club pick, their '
      + 'fixture run, and which of their players is worth one of your seven.',
    body, snap, jsonld,
  });
}

/** Every club page, as a Map of path to HTML. */
export function renderAll(snap) {
  const pages = new Map();
  for (const club of (snap && snap.clubs) || []) {
    if (!club.slug) continue;
    pages.set(BASE + club.slug + '/', pageClub(snap, club));
  }
  return pages;
}

export { BASE, DISCLAIMER };
