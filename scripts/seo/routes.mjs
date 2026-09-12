/* Gameweek Edge — the public routes, read from the app itself.

   The app routes by three registries in index.html: NAV (areas and their
   panels, with tiers), PANEL_CONTENT (each panel's description) and
   PANEL_PATH / PANEL_VIEW (public paths, and the retired ids that still
   name a view of a hub). The app's seoSync() writes a title, description
   and canonical from them at runtime; this module reads the same
   registries at build time for the sitemap and the pre-rendered shells,
   so the two can only ever agree. Nothing here is hand-maintained except
   PRERENDER, the short list of content routes that get a static shell, and
   the label of one alias. */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sliceBalanced } from '../extract-engine.mjs';

export const SITE = 'https://gameweekedge.co.uk';
export const SITE_TITLE = 'Gameweek Edge: the calm, clear edge for FPL managers';
/* The front door's own description, the same string the app writes for
   its home screen (SITE_DESC in index.html); dev/test-seo.mjs holds the
   two together. */
export const SITE_DESC = 'The calm, clear companion for Fantasy Premier League managers: predicted points, an AI scout, live matchday tracking, mini-leagues, price predictions and alerts, built on the official FPL data.';
/* Panels the More sheet reaches rather than an area; the first-run flow
   and the More index itself are screens, not pages. */
const HIDDEN_SKIP = new Set(['more', 'onboard']);
/* Content routes that get a pre-rendered shell: marketing and reference
   copy that needs no live data to be worth reading. */
export const PRERENDER = ['methodology', 'design', 'glossary', 'fplbasics', 'blog'];
/* Static pages that live beside the app, each with its own head. */
export const STATIC_PAGES = [
  { path: '/welcome', file: 'landing.html' },
  { path: '/privacy.html', file: 'privacy.html' },
  { path: '/record/', file: 'record/index.html' },
  { path: '/fantasy-efl/', file: 'efl/app/index.html' },
  { path: '/fantasy-efl/fixtures/', file: 'efl/app/fixtures/index.html' },
  { path: '/fantasy-efl/players/', file: 'efl/app/players/index.html' },
  { path: '/fantasy-efl/clubs/', file: 'efl/app/clubs/index.html' },
  { path: '/fantasy-efl/record/', file: 'efl/app/record/index.html' },
  { path: '/fantasy-efl/how-to-play/', file: 'efl/app/how-to-play/index.html' },
];

export function evalLiteral(html, decl, open, close) {
  const i = html.indexOf(decl);
  if (i < 0) throw new Error('index.html no longer declares ' + decl);
  return new Function('return ' + sliceBalanced(html, i + decl.length, open, close))();
}
/* The same sentence the app writes: the description ends in a full stop
   and names the site. */
export const describe = (d) => {
  const t = String(d || '').replace(/\.?\s*$/, '.');
  return t === '.' ? '' : t + ' Gameweek Edge.';
};

export function publicRoutes(html) {
  const NAV = evalLiteral(html, 'const NAV = ', '[', ']');
  const CONTENT = evalLiteral(html, 'const PANEL_CONTENT = ', '{', '}');
  const PATH = evalLiteral(html, 'const PANEL_PATH=', '{', '}');
  const VIEW = evalLiteral(html, 'const PANEL_VIEW=', '{', '}');
  const out = [{ id: 'home', path: '/', label: 'Gameweek Edge', area: 'Home', tier: 'free',
    title: SITE_TITLE, description: SITE_DESC }];
  for (const area of NAV) {
    if (area.tier === 'owner') continue;
    for (const p of area.panels) {
      if (p.tier === 'owner') continue;
      const c = CONTENT[p.id] || {};
      out.push({ id: p.id, path: PATH[p.id] || ('/' + p.id), label: p.label, area: area.label, tier: p.tier,
        title: p.label + ' | Gameweek Edge', description: describe(c.desc) });
    }
  }
  /* The hidden panels: PANELS.<id>={…} lines after the NAV loop. */
  for (const m of html.matchAll(/^PANELS\.([a-z]+)=(\{[^\n]*\});$/gm)) {
    const id = m[1];
    if (HIDDEN_SKIP.has(id) || out.some((r) => r.id === id)) continue;
    const p = new Function('return ' + m[2])();
    if (p.tier === 'owner') continue;
    const c = CONTENT[id] || {};
    out.push({ id, path: PATH[id] || ('/' + id), label: p.label, area: p.areaLabel || 'Home', tier: p.tier || 'free',
      title: p.label + ' | Gameweek Edge', description: describe(c.desc) });
  }
  /* Retired ids that still name a view AND carry a label are pages of
     their own (/methodology); the rest are redirects into a hub. */
  for (const [alias, spec] of Object.entries(VIEW)) {
    if (!spec.label) continue;
    const c = CONTENT[alias];
    const hub = out.find((r) => r.id === spec.hub);
    if (!hub || !c) continue;
    const label = spec.label;
    out.push({ id: alias, path: '/' + alias, label, area: hub.area, tier: hub.tier,
      title: label + ' | Gameweek Edge', description: describe(c.desc), hub: spec.hub, view: spec.view });
  }
  return out;
}

/* A static page's own head, read rather than restated. */
export function readHead(root, page) {
  const file = join(root, page.file);
  if (!existsSync(file)) return null;
  const src = readFileSync(file, 'utf8');
  const title = (src.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  const description = (src.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  const canonical = (src.match(/<link rel="canonical" href="([^"]*)"/) || [])[1] || '';
  return { ...page, title: title.replace(/&amp;/g, '&'), description, canonical };
}

export function sitemapXml(routes, pages, built, extra) {
  const day = (built || new Date()).toISOString().slice(0, 10);
  const url = (loc, freq, pri) => '  <url><loc>' + esc(SITE + loc) + '</loc><lastmod>' + day + '</lastmod><changefreq>' + freq + '</changefreq><priority>' + pri + '</priority></url>';
  const seen = new Set();
  const rows = [];
  for (const r of routes) {
    if (seen.has(r.path)) continue; seen.add(r.path);
    rows.push(url(r.path, r.path === '/' ? 'daily' : 'daily', r.path === '/' ? '1.0' : r.tier === 'paid' ? '0.5' : '0.8'));
  }
  for (const p of pages) {
    if (!p || seen.has(p.path)) continue; seen.add(p.path);
    rows.push(url(p.path, 'weekly', p.path === '/welcome' ? '0.9' : '0.6'));
  }
  for (const e of extra || []) {
    if (!e || seen.has(e.path)) continue; seen.add(e.path);
    rows.push(url(e.path, e.freq || 'daily', e.pri || '0.6'));
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows.join('\n') + '\n</urlset>\n';
}

export function robotsTxt() {
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /.netlify/', '', 'Sitemap: ' + SITE + '/sitemap.xml', ''].join('\n');
}

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
