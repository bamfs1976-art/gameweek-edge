/* Gameweek Edge — the community and legal links, read from the app.
   SITE_LINKS in index.html is the one place the Discord invite, the
   official mini-league code, the contact address and the terms page live;
   the landing page, the tool pages and the articles read it at build time
   so no page can carry a different link. An empty value renders nothing,
   which is what makes this a scaffold: fill the value and every footer
   gains the link on the next build. */
import { sliceBalanced } from '../extract-engine.mjs';

export const LEAGUE_JOIN = 'https://fantasy.premierleague.com/leagues/auto-join/';

export function siteLinks(html) {
  const i = html.indexOf('const SITE_LINKS=');
  if (i < 0) throw new Error('index.html no longer declares SITE_LINKS');
  return new Function('return ' + sliceBalanced(html, i + 'const SITE_LINKS='.length, '{', '}'))();
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* The footer set a mainstream FPL site carries, in one order everywhere:
   contact, terms, privacy, then the community. Only links with a value. */
export function footerLinks(links, opts) {
  const l = links || {};
  const out = [];
  if (l.contact) out.push({ href: 'mailto:' + l.contact, label: 'Contact' });
  if (l.terms) out.push({ href: l.terms, label: 'Terms' });
  out.push({ href: '/privacy.html', label: 'Privacy' });
  if (l.discord) out.push({ href: l.discord, label: 'Discord', external: true });
  if (l.leagueCode) out.push({ href: LEAGUE_JOIN + encodeURIComponent(l.leagueCode), label: 'Official mini-league', external: true });
  if (opts && opts.articles) out.push({ href: opts.articles, label: 'Articles' });
  return out;
}

export function footerLinksHtml(links, opts) {
  return footerLinks(links, opts).map((x) => '<a href="' + esc(x.href) + '"' + (x.external ? ' rel="noopener"' : '') + '>' + esc(x.label) + '</a>').join('');
}
