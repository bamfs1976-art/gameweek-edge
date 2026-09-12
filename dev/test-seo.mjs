/* Discoverability: every public route has its own title, description and
   canonical; the sitemap and robots are well formed; the pre-rendered
   shells carry the head, the copy and the schema; the rewrite rules and
   the pre-render list agree. Run: node dev/test-seo.mjs */
import { readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicRoutes, readHead, sitemapXml, robotsTxt, STATIC_PAGES, PRERENDER, SITE } from '../scripts/seo/routes.mjs';
import { methodologySections, landingFaq, appFaq, faqJsonLd, routeBody, shellFor } from '../scripts/seo/prerender.mjs';
import { buildSeo } from '../scripts/seo/build.mjs';

const ROOT = process.cwd();
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const landing = readFileSync(join(ROOT, 'landing.html'), 'utf8');
const privacy = readFileSync(join(ROOT, 'privacy.html'), 'utf8');
const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ok  ' + l); } else { fail++; console.log('  FAIL ' + l); } };
const section = (t) => console.log('\n• ' + t);
const noDash = (s) => !/—/.test(s);

section('the app head carries the full set once');
{
  const head = html.slice(0, html.indexOf('</head>'));
  for (const tag of ['<link rel="canonical"', '<meta property="og:title"', '<meta property="og:description"', '<meta property="og:image"', '<meta property="og:url"', '<meta property="og:site_name"', '<meta name="twitter:card"', '<meta name="twitter:title"', '<meta name="twitter:description"', '<meta name="twitter:image"', '<meta name="description"', '<title>']) {
    ok((head.match(new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length === 1, 'index.html head has exactly one ' + tag);
  }
  ok(!/name="robots"/.test(head) && !/noindex/.test(head), 'nothing in the head tells a crawler to stay away');
  ok(/function seoSync\(panelId\)/.test(html) && /seoSync\(panelId\);/.test(html.slice(html.indexOf('function renderPage('))), 'renderPage writes the route metadata through seoSync');
  ok(/try\{seoSync\(panelId\);\}catch/.test(html.slice(html.indexOf('function hubViewChanged('))), 'a view change re-syncs the canonical');
}

section('public routes: one title, one description and one canonical each');
const routes = publicRoutes(html);
{
  ok(routes.length > 30, routes.length + ' public routes read from NAV, PANEL_CONTENT and PANEL_PATH');
  ok(routes.every((r) => /^\//.test(r.path) && !/[?#]/.test(r.path)), 'every path is absolute and carries no query or hash');
  const titles = new Set(routes.map((r) => r.title)), descs = new Set(routes.map((r) => r.description)), paths = new Set(routes.map((r) => r.path));
  ok(titles.size === routes.length, 'titles are unique (' + titles.size + ' of ' + routes.length + ')');
  ok(descs.size === routes.length, 'descriptions are unique (' + descs.size + ' of ' + routes.length + ')');
  ok(paths.size === routes.length, 'paths are unique');
  ok(routes.every((r) => r.description.length >= 40 && r.description.length <= 400), 'every description is a real sentence, 40 to 400 characters');
  const siteDesc = (html.match(/const SITE_DESC='([^']*)';/) || [])[1];
  ok(siteDesc && routes[0].path === '/' && routes[0].description === siteDesc, 'the front door description is the one the app writes for home');
  ok(['design', 'glossary', 'fplbasics'].every((id) => routes.some((r) => r.id === id)) && !routes.some((r) => r.id === 'more' || r.id === 'onboard'), 'the hidden reference panels are routes; the More index and the first-run flow are not');
  ok(routes.every((r) => /\| Gameweek Edge$/.test(r.title) || r.path === '/'), 'every title names the site');
  ok(!routes.some((r) => /social|analytics|feedback/.test(r.id)), 'owner-only panels are not public routes');
  const meth = routes.find((r) => r.id === 'methodology');
  ok(meth && meth.path === '/methodology' && meth.hub === 'accountability' && meth.view === 'method' && meth.title === 'Methodology | Gameweek Edge', 'the methodology alias is its own page, pointing at the model hub view');
  ok(routes.find((r) => r.id === 'price').path === '/prices' && routes.find((r) => r.id === 'allplayers').path === '/players', 'public paths come from PANEL_PATH, not the ids');
  ok(routes.every((r) => noDash(r.title) && noDash(r.description)), 'no em dash in any title or description');
  for (const id of PRERENDER) ok(routes.some((r) => r.id === id), 'pre-render list names a real route: ' + id);
}

section('static pages: each has a title, a description, a canonical, an image and a card');
const pages = STATIC_PAGES.map((p) => readHead(ROOT, p)).filter(Boolean);
{
  ok(pages.length === STATIC_PAGES.length, 'every static page exists (' + pages.length + ')');
  ok(pages.every((p) => p.title && p.description && p.canonical.startsWith(SITE)), 'every static page has a title, a description and an absolute canonical');
  ok(new Set(pages.map((p) => p.title)).size === pages.length, 'static page titles are unique');
  for (const [name, src] of [['landing.html', landing], ['privacy.html', privacy], ['record/index.html', readFileSync(join(ROOT, 'record/index.html'), 'utf8')]]) {
    const head = src.slice(0, src.indexOf('</head>'));
    ok(/og:image/.test(head) && /twitter:card/.test(head) && /twitter:title/.test(head) && /twitter:description/.test(head) && /rel="canonical"/.test(head), name + ' has canonical, OG image and Twitter card tags');
  }
  const ld = landing.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const app = ld && JSON.parse(ld[1]);
  ok(app && app['@type'] === 'SoftwareApplication' && app.name === 'Gameweek Edge' && app.offers.length === 3, 'the landing page carries SoftwareApplication structured data');
  ok(app && app.offers.some((o) => o.price === '3.99') && app.offers.some((o) => o.price === '24.99') && /£3\.99/.test(landing) && /£24\.99/.test(landing), 'the offers match the prices printed on the page');
}

section('sitemap and robots');
{
  const xml = sitemapXml(routes, pages, new Date('2026-09-12T00:00:00Z'));
  ok(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/.test(xml) && /<\/urlset>\n$/.test(xml), 'a well-formed urlset');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  ok(locs.length === routes.length + pages.length && new Set(locs).size === locs.length, 'every route and page once (' + locs.length + ')');
  ok(locs.every((l) => l.startsWith(SITE + '/')) && locs.includes(SITE + '/') && locs.includes(SITE + '/welcome') && locs.includes(SITE + '/methodology') && locs.includes(SITE + '/fantasy-efl/'), 'absolute locations, the front door, the landing, the methodology and the EFL app included');
  ok(/<lastmod>2026-09-12<\/lastmod>/.test(xml) && !/&(?!amp;|lt;|gt;|quot;|#39;)/.test(xml), 'dated, and every ampersand escaped');
  const robots = robotsTxt();
  ok(/^User-agent: \*\nAllow: \/\n/.test(robots) && /Sitemap: https:\/\/gameweekedge\.co\.uk\/sitemap\.xml/.test(robots) && !/Disallow: \/\n/.test(robots), 'robots allows the site, hides the functions and names the sitemap');
}

section('pre-rendered shells: the head, the copy and the schema');
{
  const secs = methodologySections(html);
  ok(secs.length >= 3 && secs[0].title === 'Team-strength engine' && secs[0].paras.length >= 2 && /Dixon/.test(secs[0].paras.join(' ')), 'the methodology sections are read from its own hydrator (' + secs.length + ')');
  const faq = appFaq(html);
  ok(faq.length >= 5 && faq.every((f) => f.q.endsWith('?') && f.a.length > 40), 'the app FAQ is questions and answers (' + faq.length + ')');
  ok(JSON.stringify(landingFaq(landing)) === JSON.stringify(faq), 'the landing page FAQ and the app FAQ are the same words');
  ok(/sec\('Questions, answered',FAQ\.map/.test(html), 'the live methodology page shows the FAQ the schema describes');
  const ld = faqJsonLd(faq);
  ok(ld['@type'] === 'FAQPage' && ld.mainEntity.length === faq.length && ld.mainEntity[0].acceptedAnswer.text === faq[0].a, 'FAQPage structured data mirrors the FAQ');
  for (const id of PRERENDER) {
    const route = routes.find((r) => r.id === id);
    const body = routeBody(id, html, landing);
    ok(body.length > 200 && noDash(body), id + ': real copy in the body (' + body.length + ' chars)');
    const shell = shellFor(html, route, body, id === 'methodology' ? ld : null);
    const head = shell.slice(0, shell.indexOf('</head>'));
    ok(head.includes('<title>' + route.title + '</title>') && head.includes('content="' + route.description + '"') && head.includes('href="' + SITE + route.path + '"') && head.includes('<meta property="og:url" content="' + SITE + route.path + '"'), id + ': the head names the route');
    ok(shell.includes('<h1>' + route.label + '</h1>') && shell.includes(body), id + ': the page head and the copy are in the HTML');
    ok(shell.length > html.length && shell.includes('function seoSync(panelId)'), id + ': the shell is still the whole app');
  }
  const glossary = routeBody('glossary', html, landing);
  ok(/<dt class="dl-nm mono"[^>]*>xP<\/dt>/.test(glossary) && /Expected points/.test(glossary), 'the glossary shell lists the terms from GLOSSARY');
  ok(/Pick fifteen players/.test(routeBody('fplbasics', html, landing)), 'the basics shell carries the rules from FPL_BASICS');
  const meth = shellFor(html, routes.find((r) => r.id === 'methodology'), routeBody('methodology', html, landing), ld);
  const inline = meth.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  ok(inline && JSON.parse(inline[1])['@type'] === 'FAQPage' && /Questions, answered/.test(meth), 'the methodology shell carries the FAQPage schema and the visible FAQ it describes');
}

section('the rewrite rules and the build agree with the list');
{
  for (const id of PRERENDER) ok(new RegExp('from = "/' + id + '"\\n  to = "/' + id + '\\.html"\\n  status = 200').test(toml), 'netlify.toml rewrites /' + id + ' to its shell');
  const dir = mkdtempSync(join(tmpdir(), 'ge-seo-'));
  const res = await buildSeo(ROOT, dir);
  ok(res.shells.length === PRERENDER.length && existsSync(join(dir, 'sitemap.xml')) && existsSync(join(dir, 'robots.txt')) && PRERENDER.every((id) => existsSync(join(dir, id + '.html'))), 'buildSeo writes the sitemap, robots and every shell');
  ok(res.urls === routes.length + pages.length, 'and reports the url count');
  rmSync(dir, { recursive: true, force: true });
  ok(/buildSeo\(ROOT, OUT\)/.test(readFileSync(join(ROOT, 'scripts/build-web.mjs'), 'utf8')), 'npm run build:web runs the step');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
