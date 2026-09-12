/* Gameweek Edge — the public tool pages, rendered from a snapshot.

   Thin, static, indexable pages that each link into the app: fixture
   difficulty by team, price changes, injuries and suspensions, and a page
   per top-200 player. Every number on them comes from data/tool-pages.json
   (scripts/tools/snapshot.mjs), never from a hand. The frame is the app's
   own tokens, dark by default and light on the same stored choice, with
   no script beyond the theme read. Pure: renderAll(snapshot) returns the
   pages as a map of path to HTML, so the whole set is tested. */
import { createRequire } from 'node:module';
import { POS, POS_LONG, STATUS, HORIZON } from './snapshot.mjs';
import { footerLinksHtml } from '../site/links.mjs';

const require = createRequire(import.meta.url);
const SITE = 'https://gameweekedge.co.uk';
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => '£' + (c / 10).toFixed(1) + 'm';
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }); } catch (_) { return ''; } };
const fmtStamp = (iso) => { try { const d = new Date(iso); return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'; } catch (_) { return iso; } };

/* The card-ban ladder is the vendored rule the app and the push sender
   read (netlify/lib/suspension.js); no threshold is typed here. */
let RULE;
function rule() { if (RULE === undefined) { try { RULE = require('../../netlify/lib/suspension.js').loadRule(); } catch (_) { RULE = null; } } return RULE; }

export const CSS = `
:root{--bg:#0a0c0f;--surface:#111418;--surface-3:#1a2026;--border:#20262d;--border-2:#2a323b;--text:#e8ecf1;--text-2:#aab3be;--text-3:#8d97a3;--green:#00d26a;--green-bright:#2ee88c;--green-soft:rgba(0,210,106,.12);--amber:#f5a524;--red:#ff4d4f;--on-brand:#0a0c0f;
--fdr-1:#2ecf73;--fdr-ink-1:#0d1f16;--fdr-2:#8fd9a6;--fdr-ink-2:#0d1f16;--fdr-3:#d9dee3;--fdr-ink-3:#3a4650;--fdr-4:#f0a3a0;--fdr-ink-4:#2a1414;--fdr-5:#e05a55;--fdr-ink-5:#2a1414;
--font-body:'Inter',system-ui,sans-serif;--font-mono:'IBM Plex Mono',ui-monospace,monospace;--r:4px}
[data-theme="light"]{--bg:#f4f6f8;--surface:#ffffff;--surface-3:#eef1f4;--border:rgba(12,16,20,.08);--border-2:rgba(12,16,20,.13);--text:#10171e;--text-2:#586673;--text-3:#626f7d;--green:#147e48;--green-bright:#1f9d5c;--green-soft:rgba(31,157,92,.11);--amber:#8f5a12;--red:#c93834;--on-brand:#ffffff}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-body);line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:var(--green);text-underline-offset:2px}a:focus-visible,button:focus-visible{outline:2px solid var(--green-bright);outline-offset:2px}
.skip{position:absolute;left:-9999px;top:8px;background:var(--surface);padding:8px 12px;border-radius:var(--r);z-index:10}.skip:focus{left:12px}
.wrap{max-width:960px;margin:0 auto;padding:0 18px}
.hdr{border-bottom:1px solid var(--border);background:var(--surface)}.hdr-in{display:flex;align-items:center;gap:12px;min-height:60px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--text);font-weight:800;letter-spacing:-.01em}.brand svg{width:30px;height:30px}
.hdr-sp{flex:1}.nav{display:flex;gap:6px;flex-wrap:wrap;padding:6px 0}
.nav a,.btn{display:inline-flex;align-items:center;min-height:40px;padding:0 12px;border-radius:var(--r);font-size:.84rem;font-weight:700;text-decoration:none;color:var(--text-2);border:1px solid var(--border-2);background:var(--surface)}
.nav a[aria-current]{background:var(--green-soft);color:var(--green);border-color:var(--border-2)}
.btn-primary{background:var(--green);color:var(--on-brand);border-color:var(--green)}
main{padding:22px 0 40px}h1{font-size:1.7rem;letter-spacing:-.02em;margin:0 0 6px;line-height:1.15}h2{font-size:1.05rem;margin:0 0 10px}
.lede{color:var(--text-2);margin:0 0 18px;max-width:70ch}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:16px;margin:0 0 16px}
.card-title{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;font-weight:800;color:var(--text-2);margin:0 0 10px}
.scroll{overflow-x:auto;border:1px solid var(--border);border-radius:var(--r)}
table{border-collapse:collapse;width:100%;font-size:.82rem;white-space:nowrap}th,td{padding:7px 10px;text-align:left;border-bottom:1px solid var(--border)}
th{background:var(--surface-3);font-size:.66rem;text-transform:uppercase;letter-spacing:.04em;color:var(--text-2)}td.num,th.num{text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.fdr{display:inline-block;min-width:54px;padding:3px 6px;border-radius:var(--r);text-align:center;font-family:var(--font-mono);font-weight:700;font-size:.74rem}
.fdr-1{background:var(--fdr-1);color:var(--fdr-ink-1)}.fdr-2{background:var(--fdr-2);color:var(--fdr-ink-2)}.fdr-3{background:var(--fdr-3);color:var(--fdr-ink-3)}.fdr-4{background:var(--fdr-4);color:var(--fdr-ink-4)}.fdr-5{background:var(--fdr-5);color:var(--fdr-ink-5)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}.stat{background:var(--surface-3);border-radius:var(--r);padding:12px}
.stat-l{font-size:.64rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);font-weight:700}.stat-v{font-family:var(--font-mono);font-size:1.35rem;font-weight:700;margin-top:2px}
.badge{display:inline-block;padding:2px 7px;border-radius:var(--r);font-size:.68rem;font-weight:700;background:var(--surface-3);color:var(--text-2)}
.badge-red{background:rgba(255,77,79,.14);color:var(--red)}.badge-amber{background:rgba(245,165,36,.14);color:var(--amber)}.badge-green{background:var(--green-soft);color:var(--green)}
.pos,.neg{font-family:var(--font-mono);font-weight:700}.pos{color:var(--green)}.neg{color:var(--red)}
.muted{color:var(--text-3);font-size:.8rem}.list{list-style:none;padding:0;margin:0;columns:2;column-gap:18px}.list li{break-inside:avoid;padding:3px 0}
@media (max-width:600px){.list{columns:1}h1{font-size:1.4rem}}
footer{border-top:1px solid var(--border);padding:18px 0 40px;color:var(--text-3);font-size:.78rem}footer a{color:var(--text-2)}.flinks a{margin-right:12px}
`;

export const LOGO = '<svg viewBox="0 0 38 38" fill="none" aria-hidden="true"><rect x="1" y="1" width="36" height="36" rx="8" fill="#00d26a"/><path d="M9 25.5 L16 17 L22 22 L30 11" stroke="#0a0c0f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="30" cy="11" r="3.4" fill="#0a0c0f"/></svg>';

export const TOOLS = [
  { path: '/tools/fixture-difficulty/', label: 'Fixture difficulty', app: '/fixtures' },
  { path: '/tools/price-changes/', label: 'Price changes', app: '/prices' },
  { path: '/tools/injuries/', label: 'Injuries and suspensions', app: '/injuries' },
  { path: '/tools/players/', label: 'Player pages', app: '/players' },
];

function frame({ title, desc, path, h1, lede, body, snap, jsonld, current, links }) {
  const url = SITE + path;
  const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Gameweek Edge', item: SITE + '/' },
    { '@type': 'ListItem', position: 2, name: 'Tools', item: SITE + '/tools/' },
    ...(path !== '/tools/' ? [{ '@type': 'ListItem', position: 3, name: h1, item: url }] : []) ] };
  return '<!DOCTYPE html>\n<html lang="en-GB" data-theme="dark">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n' +
    '<title>' + esc(title) + '</title>\n<meta name="description" content="' + esc(desc) + '">\n<link rel="canonical" href="' + esc(url) + '">\n' +
    '<meta property="og:type" content="website">\n<meta property="og:site_name" content="Gameweek Edge">\n<meta property="og:title" content="' + esc(title) + '">\n<meta property="og:description" content="' + esc(desc) + '">\n<meta property="og:url" content="' + esc(url) + '">\n<meta property="og:image" content="' + SITE + '/icons/og.png">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="' + esc(title) + '">\n<meta name="twitter:description" content="' + esc(desc) + '">\n<meta name="twitter:image" content="' + SITE + '/icons/og.png">\n' +
    '<meta name="theme-color" content="#0a0c0f">\n<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">\n<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">\n' +
    '<script type="application/ld+json">' + JSON.stringify(crumbs).replace(/<\//g, '<\\/') + '</script>\n' +
    (jsonld ? '<script type="application/ld+json">' + JSON.stringify(jsonld).replace(/<\//g, '<\\/') + '</script>\n' : '') +
    '<script>(function(){try{var t=localStorage.getItem("ge-theme");document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark");}catch(e){}})();</script>\n' +
    '<style>' + CSS + '</style>\n</head>\n<body>\n<a class="skip" href="#main">Skip to content</a>\n' +
    '<header class="hdr"><div class="wrap hdr-in"><a class="brand" href="/">' + LOGO + '<span>Gameweek Edge</span></a><span class="hdr-sp"></span>' +
    '<nav class="nav" aria-label="Tools">' + TOOLS.map((t) => '<a href="' + t.path + '"' + (t.path === current ? ' aria-current="page"' : '') + '>' + t.label + '</a>').join('') + '<a class="btn btn-primary" href="/">Open the app</a></nav></div></header>\n' +
    '<main id="main" class="wrap"><h1>' + h1 + '</h1><p class="lede">' + lede + '</p>' + body + '</main>\n' +
    '<footer><div class="wrap"><p>Data from the official Fantasy Premier League API, updated ' + esc(fmtStamp(snap.built)) + '. ' + (snap.event.nextName ? esc(snap.event.nextName) + ' deadline ' + esc(fmtDate(snap.event.deadline)) + '. ' : '') +
    'These pages are generated from the data, not written by hand. Gameweek Edge is an independent app and is not affiliated with, endorsed by or associated with the Premier League or the official Fantasy Premier League game.</p>' +
    '<p class="flinks"><a href="/">Gameweek Edge</a> <a href="/tools/">All tools</a> <a href="/methodology">Methodology</a> ' + footerLinksHtml(links || {}) + '</p></div></footer>\n</body>\n</html>\n';
}

const fdrCell = (d, opp, home) => '<span class="fdr fdr-' + d + '" title="Difficulty ' + d + ' of 5">' + esc(opp) + ' (' + (home ? 'H' : 'A') + ')</span>';

/* Every team's next fixtures, from the team's side. */
export function teamRuns(snap) {
  const byId = {}; snap.teams.forEach((t) => { byId[t.id] = t; });
  return snap.teams.map((t) => {
    const runs = snap.fixtures.filter((f) => f.h === t.id || f.a === t.id).map((f) => {
      const home = f.h === t.id; const opp = byId[home ? f.a : f.h];
      return { gw: f.gw, home, opp: opp ? opp.short : '?', oppName: opp ? opp.name : '', d: home ? f.dh : f.da, kick: f.kick };
    });
    const avg = runs.length ? runs.reduce((s, r) => s + r.d, 0) / runs.length : null;
    return { team: t, runs, avg };
  }).sort((x, y) => (x.avg == null) - (y.avg == null) || x.avg - y.avg || x.team.name.localeCompare(y.team.name));
}

function pageIndex(snap, links) {
  const body = '<div class="card"><p class="card-title">The tools</p><ul class="list">' + TOOLS.map((t) => '<li><a href="' + t.path + '">' + t.label + '</a></li>').join('') + '</ul></div>' +
    '<div class="card"><p class="card-title">Player pages, top ' + snap.players.length + ' by points</p><ul class="list">' +
    snap.players.map((p) => '<li><a href="/tools/players/' + p.slug + '/">' + esc(p.web) + '</a> <span class="muted">' + esc(teamShort(snap, p.team)) + ' · ' + POS[p.pos] + ' · ' + p.pts + ' pts</span></li>').join('') + '</ul></div>';
  return frame({ title: 'FPL tools: fixture difficulty, price changes, injuries and player pages | Gameweek Edge',
    desc: 'Free Fantasy Premier League reference pages generated from the official data: fixture difficulty by team, price changes, injuries and suspensions and a page for every top-200 player.',
    path: '/tools/', h1: 'FPL tools', lede: 'Reference pages generated from the official Fantasy Premier League data, refreshed on a schedule. Each one links into the app for the live version.', body, snap, links, current: '/tools/' });
}

function pageDifficulty(snap, links) {
  const runs = teamRuns(snap);
  const gws = [...new Set(snap.fixtures.map((f) => f.gw))].sort((a, b) => a - b);
  const rows = runs.map((r) => '<tr><td><a href="/tools/fixture-difficulty/' + r.team.slug + '/">' + esc(r.team.name) + '</a></td>' +
    gws.map((gw) => { const fs = r.runs.filter((x) => x.gw === gw); return '<td>' + (fs.length ? fs.map((f) => fdrCell(f.d, f.opp, f.home)).join(' ') : '<span class="muted">blank</span>') + '</td>'; }).join('') +
    '<td class="num">' + (r.avg == null ? '–' : r.avg.toFixed(2)) + '</td></tr>').join('');
  const body = '<div class="card"><p class="card-title">Next ' + gws.length + ' gameweeks, easiest run first</p><div class="scroll"><table><thead><tr><th>Club</th>' + gws.map((g) => '<th>GW' + g + '</th>').join('') + '<th class="num">Avg</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<p class="muted" style="margin:10px 0 0">Difficulty is FPL’s own 1 to 5 rating for each fixture, 1 the easiest. H is home, A is away. The app’s <a href="/fixtures">Fixture Planner</a> adds the model’s own read, clean-sheet odds and a points planner.</p></div>';
  return frame({ title: 'FPL fixture difficulty by team, next ' + gws.length + ' gameweeks | Gameweek Edge',
    desc: 'Every Premier League club’s next ' + gws.length + ' fixtures with FPL’s official difficulty rating, ranked from the easiest run to the hardest. Updated from the official data.',
    path: '/tools/fixture-difficulty/', h1: 'Fixture difficulty by team', lede: 'Each club’s next fixtures with the official difficulty rating, easiest run first. Tap a club for its fixtures and its most-owned players.', body, snap, links, current: '/tools/fixture-difficulty/' });
}

function pageTeam(snap, r, links) {
  const t = r.team;
  const rows = r.runs.map((f) => '<tr><td class="num">' + f.gw + '</td><td>' + esc(f.oppName) + ' (' + (f.home ? 'Home' : 'Away') + ')</td><td>' + fdrCell(f.d, f.opp, f.home) + '</td><td>' + esc(f.kick ? fmtDate(f.kick) : '') + '</td></tr>').join('');
  const squad = snap.players.filter((p) => p.team === t.id).sort((a, b) => b.pts - a.pts).slice(0, 12);
  const body = '<div class="card"><p class="card-title">Next ' + r.runs.length + ' fixtures' + (r.avg != null ? ', average difficulty ' + r.avg.toFixed(2) : '') + '</p><div class="scroll"><table><thead><tr><th class="num">GW</th><th>Opponent</th><th>Difficulty</th><th>Date</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
    (squad.length ? '<div class="card"><p class="card-title">' + esc(t.name) + ' players in the top ' + snap.players.length + '</p><div class="scroll"><table><thead><tr><th>Player</th><th>Pos</th><th class="num">Price</th><th class="num">Owned</th><th class="num">Points</th><th class="num">Form</th></tr></thead><tbody>' +
      squad.map((p) => '<tr><td><a href="/tools/players/' + p.slug + '/">' + esc(p.web) + '</a></td><td>' + POS[p.pos] + '</td><td class="num">' + money(p.cost) + '</td><td class="num">' + p.own.toFixed(1) + '%</td><td class="num">' + p.pts + '</td><td class="num">' + p.form.toFixed(1) + '</td></tr>').join('') + '</tbody></table></div></div>' : '') +
    '<p class="muted">In the app: <a href="/players?team=' + t.id + '">every ' + esc(t.name) + ' player</a> and the <a href="/fixtures">Fixture Planner</a>.</p>';
  return frame({ title: esc(t.name) + ' fixtures and FPL difficulty, next ' + r.runs.length + ' gameweeks | Gameweek Edge',
    desc: esc(t.name) + '’s next ' + r.runs.length + ' Premier League fixtures with FPL’s official difficulty rating' + (r.avg != null ? ', averaging ' + r.avg.toFixed(2) + ' of 5' : '') + ', and the club’s top FPL players.',
    path: '/tools/fixture-difficulty/' + t.slug + '/', h1: esc(t.name) + ' fixture difficulty', lede: 'The next fixtures from ' + esc(t.name) + '’s side, with FPL’s official difficulty rating, and the club’s players in the top ' + snap.players.length + '.', body, snap, links, current: '/tools/fixture-difficulty/' });
}

function pagePrices(snap, links) {
  const m = snap.movers;
  const tbl = (rows, cols) => rows.length ? '<div class="scroll"><table><thead><tr>' + cols.map((c) => '<th' + (c.num ? ' class="num"' : '') + '>' + c.h + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map((r) => '<tr>' + cols.map((c) => '<td' + (c.num ? ' class="num"' : '') + '>' + c.v(r) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '<p class="muted">None recorded.</p>';
  const name = (r) => { const p = snap.players.find((x) => x.id === r.id); return p ? '<a href="/tools/players/' + p.slug + '/">' + esc(r.web) + '</a>' : esc(r.web); };
  const dayUp = m.rows.filter((r) => r.to > r.from), dayDown = m.rows.filter((r) => r.to < r.from);
  const dayCols = [{ h: 'Player', v: name }, { h: 'Club', v: (r) => esc(r.team || '') }, { h: 'Pos', v: (r) => POS[r.pos] || '' }, { h: 'Was', num: 1, v: (r) => money(r.from) }, { h: 'Now', num: 1, v: (r) => money(r.to) }];
  const gwCols = [{ h: 'Player', v: name }, { h: 'Club', v: (r) => esc(teamShort(snap, r.team)) }, { h: 'Pos', v: (r) => POS[r.pos] || '' }, { h: 'Price', num: 1, v: (r) => money(r.cost) }, { h: 'Change', num: 1, v: (r) => '<span class="' + (r.cce > 0 ? 'pos' : 'neg') + '">' + (r.cce > 0 ? '+' : '') + (r.cce / 10).toFixed(1) + '</span>' }, { h: 'Owned', num: 1, v: (r) => r.own.toFixed(1) + '%' }];
  const trCols = [{ h: 'Player', v: name }, { h: 'Club', v: (r) => esc(teamShort(snap, r.team)) }, { h: 'Price', num: 1, v: (r) => money(r.cost) }, { h: 'Net transfers', num: 1, v: (r) => '<span class="' + (r.net > 0 ? 'pos' : 'neg') + '">' + (r.net > 0 ? '+' : '') + r.net.toLocaleString('en-GB') + '</span>' }];
  const body = (m.day ? '<div class="card"><p class="card-title">Price changes on ' + esc(fmtDate(m.day + 'T12:00:00Z')) + '</p><h2>Risers (' + dayUp.length + ')</h2>' + tbl(dayUp, dayCols) + '<h2 style="margin-top:14px">Fallers (' + dayDown.length + ')</h2>' + tbl(dayDown, dayCols) + '</div>' : '') +
    '<div class="card"><p class="card-title">Changes since the gameweek started</p><h2>Risers</h2>' + tbl(m.gwUp, gwCols) + '<h2 style="margin-top:14px">Fallers</h2>' + tbl(m.gwDown, gwCols) + '</div>' +
    '<div class="card"><p class="card-title">Net transfers this gameweek</p><h2>Most bought</h2>' + tbl(m.bought, trCols) + '<h2 style="margin-top:14px">Most sold</h2>' + tbl(m.sold, trCols) +
    '<p class="muted" style="margin:10px 0 0">Net transfers are what move a price. The app’s <a href="/prices">Price Predictor</a> shows how close each player is to a change tonight, the hourly momentum and a searchable history.</p></div>';
  return frame({ title: 'FPL price changes today: risers, fallers and net transfers | Gameweek Edge',
    desc: 'Today’s Fantasy Premier League price rises and falls, the changes since the gameweek started and the most bought and sold players, from the official data.',
    path: '/tools/price-changes/', h1: 'FPL price changes', lede: 'Who rose and who fell, the changes since the gameweek started and the net transfers driving the next ones.', body, snap, links, current: '/tools/price-changes/' });
}

function pageInjuries(snap, links) {
  const groups = [['i', 'Injured'], ['d', 'Doubtful'], ['s', 'Suspended'], ['u', 'Unavailable'], ['n', 'Not available'], ['a', 'Flagged but available']];
  const badge = (s) => '<span class="badge ' + (s === 'i' || s === 's' ? 'badge-red' : s === 'd' ? 'badge-amber' : '') + '">' + esc(STATUS[s] || s) + '</span>';
  const name = (r) => { const p = snap.players.find((x) => x.id === r.id); return p ? '<a href="/tools/players/' + p.slug + '/">' + esc(r.web) + '</a>' : esc(r.web); };
  const sections = groups.map(([s, label]) => {
    const rows = snap.flags.filter((f) => f.status === s);
    if (!rows.length) return '';
    return '<div class="card"><p class="card-title">' + label + ' (' + rows.length + ')</p><div class="scroll"><table><thead><tr><th>Player</th><th>Club</th><th>Pos</th><th>Status</th><th class="num">Chance</th><th>News</th></tr></thead><tbody>' +
      rows.map((r) => '<tr><td>' + name(r) + '</td><td>' + esc(teamShort(snap, r.team)) + '</td><td>' + POS[r.pos] + '</td><td>' + badge(r.status) + '</td><td class="num">' + (r.chance == null ? '–' : r.chance + '%') + '</td><td style="white-space:normal;min-width:220px">' + esc(r.news || '') + '</td></tr>').join('') + '</tbody></table></div></div>';
  }).join('');
  /* Card-ban proximity from the vendored ladder: who is one caution away. */
  const R = rule();
  const gw = snap.event.next || snap.event.current || 1;
  const edge = R ? snap.cautions.map((c) => ({ c, n: R.next(c.yc, gw) })).filter((x) => x.n && !x.n.dead && x.n.need === 1) : [];
  const bans = edge.length ? '<div class="card"><p class="card-title">One yellow card from a ban (' + edge.length + ')</p><div class="scroll"><table><thead><tr><th>Player</th><th>Club</th><th>Pos</th><th class="num">Yellows</th><th>Ban at</th><th>Cut-off</th></tr></thead><tbody>' +
    edge.map(({ c, n }) => '<tr><td>' + name(c) + '</td><td>' + esc(teamShort(snap, c.team)) + '</td><td>' + POS[c.pos] + '</td><td class="num">' + c.yc + '</td><td>' + n.at + ' cards, ' + n.ban + ' match' + (n.ban === 1 ? '' : 'es') + '</td><td>' + esc(n.by ? 'by ' + n.by : '') + '</td></tr>').join('') + '</tbody></table></div>' +
    '<p class="muted" style="margin:10px 0 0">From the Premier League’s caution ladder, the same rule the app’s suspension watch reads.</p></div>' : '';
  const body = (sections || '<div class="card"><p class="muted">Nobody is flagged right now.</p></div>') + bans +
    '<p class="muted">In the app: the <a href="/injuries">Fitness lens</a> on the players table, sorted by ownership, and push alerts for new flags.</p>';
  return frame({ title: 'FPL injuries and suspensions: every flagged player with the official news | Gameweek Edge',
    desc: 'Every Fantasy Premier League player flagged injured, doubtful, suspended or unavailable, with the official news and chance of playing, plus who is one yellow card from a ban.',
    path: '/tools/injuries/', h1: 'Injuries and suspensions', lede: 'Every flagged player with the official news and chance of playing, most-owned first, and the players one caution from a ban.', body, snap, links, current: '/tools/injuries/' });
}

function pagePlayer(snap, p, links) {
  const t = snap.teams.find((x) => x.id === p.team) || { name: '', short: '', slug: '' };
  const runs = teamRuns(snap).find((r) => r.team.id === p.team);
  const fixtures = runs ? runs.runs : [];
  const per90 = p.min > 0 ? (p.pts / (p.min / 90)).toFixed(1) : '–';
  const availability = p.status === 'a' && !p.news ? 'Available' : (STATUS[p.status] || p.status) + (p.chance != null ? ', ' + p.chance + '% chance of playing' : '') + (p.news ? '. ' + p.news : '');
  const stat = (l, v) => '<div class="stat"><div class="stat-l">' + l + '</div><div class="stat-v">' + v + '</div></div>';
  const body = '<div class="card"><div class="grid">' + stat('Price', money(p.cost)) + stat('Owned', p.own.toFixed(1) + '%') + stat('Points', p.pts) + stat('Form', p.form.toFixed(1)) + stat('Per 90', per90) + stat('Minutes', p.min.toLocaleString('en-GB')) + '</div></div>' +
    '<div class="card"><p class="card-title">This season</p><div class="scroll"><table><thead><tr><th class="num">Goals</th><th class="num">Assists</th><th class="num">Clean sheets</th><th class="num">Bonus</th><th class="num">xG</th><th class="num">xA</th><th class="num">Yellows</th><th class="num">Price change</th></tr></thead><tbody><tr>' +
    '<td class="num">' + p.g + '</td><td class="num">' + p.a + '</td><td class="num">' + p.cs + '</td><td class="num">' + p.bonus + '</td><td class="num">' + p.xg.toFixed(2) + '</td><td class="num">' + p.xa.toFixed(2) + '</td><td class="num">' + p.yc + '</td><td class="num"><span class="' + (p.ccs > 0 ? 'pos' : p.ccs < 0 ? 'neg' : '') + '">' + (p.ccs > 0 ? '+' : '') + (p.ccs / 10).toFixed(1) + '</span></td></tr></tbody></table></div></div>' +
    '<div class="card"><p class="card-title">Availability</p><p style="margin:0">' + esc(availability) + '</p></div>' +
    '<div class="card"><p class="card-title">Next ' + fixtures.length + ' fixtures</p>' + (fixtures.length ? '<div class="scroll"><table><thead><tr><th class="num">GW</th><th>Opponent</th><th>Difficulty</th><th>Date</th></tr></thead><tbody>' +
      fixtures.map((f) => '<tr><td class="num">' + f.gw + '</td><td>' + esc(f.oppName) + ' (' + (f.home ? 'Home' : 'Away') + ')</td><td>' + fdrCell(f.d, f.opp, f.home) + '</td><td>' + esc(f.kick ? fmtDate(f.kick) : '') + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted">No fixtures scheduled in the window.</p>') + '</div>' +
    '<p class="muted">In the app: <a href="/players?q=' + encodeURIComponent(p.web) + '">' + esc(p.web) + ' in the players table</a> with predicted points, the dossier and the form chart, and <a href="/tools/fixture-difficulty/' + t.slug + '/">' + esc(t.name) + '’s fixture run</a>.</p>';
  const full = (p.first + ' ' + p.second).trim() || p.web;
  /* Two players with one name: the club in the title keeps the pages apart. */
  const named = p.dup ? full + ' (' + t.name + ')' : full;
  const jsonld = { '@context': 'https://schema.org', '@type': 'Person', name: full, jobTitle: POS_LONG[p.pos] || 'Footballer', memberOf: { '@type': 'SportsTeam', name: t.name }, url: SITE + '/tools/players/' + p.slug + '/' };
  return frame({ title: esc(named) + ' FPL: price, ownership, form and fixtures | Gameweek Edge',
    desc: esc(full) + ' (' + esc(t.name) + ', ' + POS_LONG[p.pos] + '): ' + money(p.cost) + ', owned by ' + p.own.toFixed(1) + '% of managers, ' + p.pts + ' points, form ' + p.form.toFixed(1) + '. Next fixtures with difficulty and the latest availability news.',
    path: '/tools/players/' + p.slug + '/', h1: esc(full), lede: esc(t.name) + ' · ' + POS_LONG[p.pos] + ' · ' + money(p.cost) + ' · owned by ' + p.own.toFixed(1) + '% of ' + (snap.total ? Math.round(snap.total / 1e6) + ' million' : 'all') + ' managers.', body, snap, links, jsonld, current: '/tools/players/' });
}

function pagePlayersIndex(snap, links) {
  const byPos = [1, 2, 3, 4].map((pos) => { const rows = snap.players.filter((p) => p.pos === pos); return rows.length ? '<div class="card"><p class="card-title">' + POS_LONG[pos] + 's (' + rows.length + ')</p><ul class="list">' + rows.map((p) => '<li><a href="/tools/players/' + p.slug + '/">' + esc(p.web) + '</a> <span class="muted">' + esc(teamShort(snap, p.team)) + ' · ' + money(p.cost) + ' · ' + p.pts + ' pts</span></li>').join('') + '</ul></div>' : ''; }).join('');
  return frame({ title: 'FPL player pages: the top ' + snap.players.length + ' by points | Gameweek Edge',
    desc: 'A page for each of the top ' + snap.players.length + ' Fantasy Premier League players by points: price, ownership, form, this season’s numbers, availability and the next fixtures with difficulty.',
    path: '/tools/players/', h1: 'Player pages', lede: 'The top ' + snap.players.length + ' players by points, by position. Each page carries price, ownership, form, availability and the next fixtures.', body: byPos, snap, current: '/tools/players/' });
}

const teamShort = (snap, id) => { const t = snap.teams.find((x) => x.id === id); return t ? t.short : ''; };

export function renderAll(snap, links) {
  const out = new Map();
  const L = links || {};
  const withLinks = (html) => html.replace('<p class="flinks">', '<p class="flinks" data-links="' + (Object.keys(L).length ? '1' : '0') + '">');
  out.set('/tools/', pageIndex(snap, L));
  out.set('/tools/fixture-difficulty/', pageDifficulty(snap, L));
  teamRuns(snap).forEach((r) => out.set('/tools/fixture-difficulty/' + r.team.slug + '/', pageTeam(snap, r, L)));
  out.set('/tools/price-changes/', pagePrices(snap, L));
  out.set('/tools/injuries/', pageInjuries(snap, L));
  out.set('/tools/players/', pagePlayersIndex(snap, L));
  snap.players.forEach((p) => out.set('/tools/players/' + p.slug + '/', pagePlayer(snap, p, L)));
  for (const [k, v] of out) out.set(k, withLinks(v));
  return out;
}
