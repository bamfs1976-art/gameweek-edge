/* Gameweek Edge — the articles pipeline: markdown in, pages and a feed out.

   content/posts/<yyyy-mm-dd>-<slug>.md, each with front matter (title,
   description, date, tags, draft), becomes <BLOG_BASE><slug>/ at build,
   with an index and an RSS feed at <BLOG_BASE>feed.xml. Drafts, files
   starting with an underscore and posts dated in the future are left out.
   With no published post the build writes nothing and says so: the
   scaffold ships, the content does not.

   BLOG_BASE is /articles/ because /blog is The Wire, the app's own
   auto-written briefings, which already answers at that address with a
   pre-rendered shell. Moving it is a one-line change here plus the Wire's
   path, once the owner decides which of the two owns the word. */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { frontMatter, renderMarkdown, excerpt, esc } from './markdown.mjs';
import { CSS, LOGO } from '../tools/pages.mjs';
import { footerLinksHtml } from '../site/links.mjs';

export const BLOG_BASE = '/articles/';
export const BLOG_TITLE = 'Gameweek Edge articles';
export const BLOG_DESC = 'Written pieces from the people behind Gameweek Edge: how the model thinks, what the data says, and how to use the app well.';
const SITE = 'https://gameweekedge.co.uk';

export function readPosts(dir, now) {
  if (!existsSync(dir)) return [];
  const today = (now ? new Date(now) : new Date()).toISOString().slice(0, 10);
  const posts = [];
  for (const f of readdirSync(dir).sort()) {
    if (!/\.md$/.test(f) || f.startsWith('_') || /^README/i.test(f)) continue;
    const { meta, body } = frontMatter(readFileSync(join(dir, f), 'utf8'));
    const fm = f.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
    const date = String(meta.date || (fm && fm[1]) || '').slice(0, 10);
    const slug = String(meta.slug || (fm && fm[2]) || f.replace(/\.md$/, '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!meta.title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !slug) continue;
    if (meta.draft || date > today) continue;
    posts.push({ file: f, slug, date, title: String(meta.title), description: String(meta.description || excerpt(body)), tags: meta.tags || [], author: meta.author ? String(meta.author) : '', body, html: renderMarkdown(body), path: BLOG_BASE + slug + '/' });
  }
  return posts.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

const fmtDate = (d) => { try { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (_) { return d; } };

function frame({ title, desc, path, body, links, rss }) {
  const url = SITE + path;
  return '<!DOCTYPE html>\n<html lang="en-GB" data-theme="dark">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n' +
    '<title>' + esc(title) + '</title>\n<meta name="description" content="' + esc(desc) + '">\n<link rel="canonical" href="' + esc(url) + '">\n' +
    '<link rel="alternate" type="application/rss+xml" title="' + esc(BLOG_TITLE) + '" href="' + SITE + BLOG_BASE + 'feed.xml">\n' +
    '<meta property="og:type" content="' + (rss ? 'website' : 'article') + '">\n<meta property="og:site_name" content="Gameweek Edge">\n<meta property="og:title" content="' + esc(title) + '">\n<meta property="og:description" content="' + esc(desc) + '">\n<meta property="og:url" content="' + esc(url) + '">\n<meta property="og:image" content="' + SITE + '/icons/og.png">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="' + esc(title) + '">\n<meta name="twitter:description" content="' + esc(desc) + '">\n<meta name="twitter:image" content="' + SITE + '/icons/og.png">\n' +
    '<meta name="theme-color" content="#0a0c0f">\n<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">\n' +
    '<script>(function(){try{var t=localStorage.getItem("ge-theme");document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark");}catch(e){}})();</script>\n' +
    '<style>' + CSS + '\n.post{max-width:70ch}.post h2{font-size:1.25rem;margin:22px 0 8px}.post h3{font-size:1.05rem;margin:18px 0 6px}.post p,.post li{color:var(--text-2);font-size:1rem;line-height:1.65}.post pre{background:var(--surface-3);border-radius:var(--r);padding:12px;overflow:auto;font-family:var(--font-mono);font-size:.84rem}.post code{font-family:var(--font-mono);font-size:.9em}.post blockquote{border-left:3px solid var(--green);margin:12px 0;padding:4px 14px;color:var(--text-2)}.post img{max-width:100%;height:auto;border-radius:var(--r)}.meta{color:var(--text-3);font-size:.82rem;margin:0 0 16px}.plist{list-style:none;padding:0;margin:0}.plist li{padding:12px 0;border-bottom:1px solid var(--border)}.plist a{font-weight:700;font-size:1.05rem}</style>\n</head>\n<body>\n<a class="skip" href="#main">Skip to content</a>\n' +
    '<header class="hdr"><div class="wrap hdr-in"><a class="brand" href="/">' + LOGO + '<span>Gameweek Edge</span></a><span class="hdr-sp"></span><nav class="nav" aria-label="Site"><a href="' + BLOG_BASE + '"' + (rss ? ' aria-current="page"' : '') + '>Articles</a><a href="/tools/">Tools</a><a class="btn btn-primary" href="/">Open the app</a></nav></div></header>\n' +
    '<main id="main" class="wrap">' + body + '</main>\n' +
    '<footer><div class="wrap"><p>Gameweek Edge is an independent app and is not affiliated with, endorsed by or associated with the Premier League or the official Fantasy Premier League game.</p><p class="flinks">' + footerLinksHtml(links) + '</p></div></footer>\n</body>\n</html>\n';
}

export function renderIndex(posts, links) {
  const body = '<h1>' + esc(BLOG_TITLE.replace('Gameweek Edge ', 'A')) + 'rticles</h1><p class="lede">' + esc(BLOG_DESC) + ' <a href="' + BLOG_BASE + 'feed.xml">RSS feed</a>.</p>' +
    '<ul class="plist">' + posts.map((p) => '<li><a href="' + p.path + '">' + esc(p.title) + '</a><div class="meta">' + fmtDate(p.date) + (p.author ? ' · ' + esc(p.author) : '') + '</div><p style="margin:0;color:var(--text-2)">' + esc(p.description) + '</p></li>').join('') + '</ul>';
  return frame({ title: BLOG_TITLE + ' | Gameweek Edge', desc: BLOG_DESC, path: BLOG_BASE, body, links, rss: true });
}

export function renderPost(p, links) {
  const jsonld = { '@context': 'https://schema.org', '@type': 'Article', headline: p.title, description: p.description, datePublished: p.date, url: SITE + p.path, publisher: { '@type': 'Organization', name: 'Gameweek Edge', url: SITE + '/' } };
  if (p.author) jsonld.author = { '@type': 'Person', name: p.author };
  const body = '<article class="post"><h1>' + esc(p.title) + '</h1><p class="meta"><time datetime="' + p.date + '">' + fmtDate(p.date) + '</time>' + (p.author ? ' · ' + esc(p.author) : '') + (p.tags.length ? ' · ' + p.tags.map(esc).join(', ') : '') + '</p>' + p.html + '</article>' +
    '<p class="muted" style="margin-top:22px"><a href="' + BLOG_BASE + '">All articles</a></p>';
  const html = frame({ title: p.title + ' | Gameweek Edge', desc: p.description, path: p.path, body, links });
  return html.replace('</head>', '<script type="application/ld+json">' + JSON.stringify(jsonld).replace(/<\//g, '<\\/') + '</script>\n</head>');
}

export function renderFeed(posts, built) {
  const rfc = (d) => new Date(d).toUTCString();
  const items = posts.map((p) => '  <item>\n    <title>' + esc(p.title) + '</title>\n    <link>' + SITE + p.path + '</link>\n    <guid isPermaLink="true">' + SITE + p.path + '</guid>\n    <pubDate>' + rfc(p.date + 'T09:00:00Z') + '</pubDate>\n    <description>' + esc(p.description) + '</description>\n  </item>').join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n  <title>' + esc(BLOG_TITLE) + '</title>\n  <link>' + SITE + BLOG_BASE + '</link>\n  <description>' + esc(BLOG_DESC) + '</description>\n  <language>en-gb</language>\n  <lastBuildDate>' + rfc(built || new Date()) + '</lastBuildDate>\n  <atom:link href="' + SITE + BLOG_BASE + 'feed.xml" rel="self" type="application/rss+xml"/>\n' + items + '\n</channel>\n</rss>\n';
}

export async function buildBlog(root, out, links, now) {
  const posts = readPosts(join(root, 'content', 'posts'), now);
  if (!posts.length) return { posts: 0, urls: [], note: 'no published post in content/posts (drafts, underscored files and future dates are left out)' };
  const base = join(out, BLOG_BASE);
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'index.html'), renderIndex(posts, links));
  writeFileSync(join(base, 'feed.xml'), renderFeed(posts, now));
  const urls = [{ path: BLOG_BASE, freq: 'weekly', pri: '0.7' }];
  for (const p of posts) {
    mkdirSync(join(out, p.path), { recursive: true });
    writeFileSync(join(out, p.path, 'index.html'), renderPost(p, links));
    urls.push({ path: p.path, freq: 'monthly', pri: '0.6' });
  }
  return { posts: posts.length, urls };
}
