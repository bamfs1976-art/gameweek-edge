/* Gameweek Edge — the build-time discoverability step.
   Called by scripts/build-web.mjs after the static copy. Writes:
     www/sitemap.xml          every public route and static page, once
     www/robots.txt           allow all, name the sitemap
     www/<route>.html         a pre-rendered shell for each PRERENDER route
   netlify.toml rewrites /<route> to /<route>.html; dev/test-seo.mjs checks
   the two lists agree. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { publicRoutes, readHead, sitemapXml, robotsTxt, STATIC_PAGES, PRERENDER } from './routes.mjs';
import { routeBody, shellFor, appFaq, faqJsonLd } from './prerender.mjs';

export async function buildSeo(root, out, extra) {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const landing = readFileSync(join(root, 'landing.html'), 'utf8');
  const routes = publicRoutes(html);
  const pages = STATIC_PAGES.map((p) => readHead(root, p)).filter(Boolean);
  writeFileSync(join(out, 'sitemap.xml'), sitemapXml(routes, pages, null, extra));
  writeFileSync(join(out, 'robots.txt'), robotsTxt());
  const shells = [];
  for (const id of PRERENDER) {
    const route = routes.find((r) => r.id === id);
    if (!route) throw new Error('PRERENDER names a route the app does not have: ' + id);
    const jsonld = id === 'methodology' ? faqJsonLd(appFaq(html)) : null;
    writeFileSync(join(out, id + '.html'), shellFor(html, route, routeBody(id, html, landing), jsonld));
    shells.push(id);
  }
  return { urls: routes.length + pages.length + (extra || []).length, shells };
}
