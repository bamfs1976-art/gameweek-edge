/* The articles pipeline and the community links: markdown in, pages and
   a feed out, and one source of links for every footer.
   Run: node dev/test-blog.mjs */
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { frontMatter, renderMarkdown, excerpt } from '../scripts/blog/markdown.mjs';
import { readPosts, renderIndex, renderPost, renderFeed, buildBlog, BLOG_BASE } from '../scripts/blog/build.mjs';
import { siteLinks, footerLinks, footerLinksHtml, LEAGUE_JOIN } from '../scripts/site/links.mjs';

const ROOT = process.cwd();
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ok  ' + l); } else { fail++; console.log('  FAIL ' + l); } };
const section = (t) => console.log('\n• ' + t);

section('markdown: the documented subset, escaped first');
{
  const fm = frontMatter('---\ntitle: "Hello"\ndate: 2026-09-20\ntags: model, captaincy\ndraft: true\n---\nBody **here**.');
  ok(fm.meta.title === 'Hello' && fm.meta.date === '2026-09-20' && fm.meta.tags.join('|') === 'model|captaincy' && fm.meta.draft === true && fm.body === 'Body **here**.', 'front matter reads strings, tags and draft');
  ok(frontMatter('no front matter').meta.title === undefined && frontMatter('no front matter').body === 'no front matter', 'a file without front matter is all body');
  const md = renderMarkdown('# Title\n\nA **bold** and *italic* line with `code` and a [link](https://example.com/x) and [inner](/tools/).\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n> lines\n\n```\nlet x = 1 < 2;\n```\n\n---\n\n![alt text](/icons/og.png)\n\n<script>alert(1)</script>');
  ok(/^<h2>Title<\/h2>/.test(md), 'a # heading becomes h2, below the page h1');
  ok(/<strong>bold<\/strong>/.test(md) && /<em>italic<\/em>/.test(md) && /<code>code<\/code>/.test(md), 'bold, italic and inline code');
  ok(/<a href="https:\/\/example.com\/x" rel="noopener">link<\/a>/.test(md) && /<a href="\/tools\/">inner<\/a>/.test(md), 'external links get noopener, internal ones do not');
  ok(/<ul><li>one<\/li><li>two<\/li><\/ul>/.test(md) && /<ol><li>first<\/li><li>second<\/li><\/ol>/.test(md), 'bullet and numbered lists');
  ok(/<blockquote><p>quoted lines<\/p><\/blockquote>/.test(md) && /<pre><code>let x = 1 &lt; 2;<\/code><\/pre>/.test(md) && /<hr>/.test(md), 'quotes, fenced code and a rule, with the code escaped');
  ok(/<img src="\/icons\/og.png" alt="alt text" loading="lazy">/.test(md), 'images');
  ok(!/<script>/.test(md) && /&lt;script&gt;/.test(md), 'raw HTML is escaped, never rendered');
  ok(excerpt('# H\n\nA sentence that runs on for a while so the excerpt has to cut it somewhere sensible, ideally on a word boundary.', 60).endsWith('…') && excerpt('Short.', 60) === 'Short.', 'an excerpt cuts on a word and marks the cut');
}

section('posts: drafts, underscores and the future stay out');
const dir = mkdtempSync(join(tmpdir(), 'ge-blog-'));
mkdirSync(join(dir, 'content', 'posts'), { recursive: true });
const post = (name, fm, body) => writeFileSync(join(dir, 'content', 'posts', name), '---\n' + fm + '\n---\n' + body);
post('2026-09-01-first-post.md', 'title: The first post\ndescription: What this is for.\nauthor: Ant\ntags: app', '# Why\n\nBecause **reasons**.');
post('2026-09-10-second-post.md', 'title: The second post', 'Plain body with no description so the excerpt is used.');
post('2026-09-05-a-draft.md', 'title: Not yet\ndraft: true', 'Hidden.');
post('2027-01-01-future.md', 'title: Later', 'Hidden until the date.');
post('_template.md', 'title: Template', 'Ignored.');
writeFileSync(join(dir, 'content', 'posts', 'README.md'), '# notes');
const posts = readPosts(join(dir, 'content', 'posts'), '2026-09-12T12:00:00Z');
ok(posts.length === 2 && posts[0].slug === 'second-post' && posts[1].slug === 'first-post', 'two published posts, newest first (' + posts.map((p) => p.slug).join(', ') + ')');
ok(posts[1].date === '2026-09-01' && posts[1].author === 'Ant' && posts[1].tags.join() === 'app' && posts[1].path === BLOG_BASE + 'first-post/', 'date and slug come from the file name, the rest from the front matter');
ok(posts[0].description === 'Plain body with no description so the excerpt is used.', 'a missing description falls back to the excerpt');
ok(readPosts(join(dir, 'nowhere')).length === 0, 'no folder is no posts');

section('pages and the feed');
const L = { discord: 'https://discord.gg/abc', leagueCode: 'xyz12', contact: 'hello@example.com', terms: '' };
const idx = renderIndex(posts, L);
ok(/<title>Gameweek Edge articles \| Gameweek Edge<\/title>/.test(idx) && /rel="canonical" href="https:\/\/gameweekedge\.co\.uk\/articles\/"/.test(idx), 'the index has a title and its canonical');
ok(/rel="alternate" type="application\/rss\+xml"/.test(idx) && /href="\/articles\/second-post\/">The second post</.test(idx) && /10 September 2026/.test(idx), 'it links the feed and every post with its date');
const page = renderPost(posts[1], L);
ok(/<h1>The first post<\/h1>/.test(page) && /<h2>Why<\/h2>/.test(page) && /<strong>reasons<\/strong>/.test(page) && /<time datetime="2026-09-01">/.test(page), 'a post page renders the markdown under one h1 with a dated time element');
ok(/"@type":"Article"/.test(page) && /"author":\{"@type":"Person","name":"Ant"\}/.test(page) && /property="og:type" content="article"/.test(page), 'Article structured data and an article OG type');
ok(/href="mailto:hello@example.com">Contact</.test(page) && /href="https:\/\/discord.gg\/abc" rel="noopener">Discord</.test(page) && /leagues\/auto-join\/xyz12" rel="noopener">Official mini-league</.test(page) && /href="\/privacy.html">Privacy</.test(page) && !/>Terms</.test(page), 'the footer carries the community links that have a value and skips the one that does not');
ok(!/—/.test(page) && !/—/.test(idx), 'no em dash');
const feed = renderFeed(posts, '2026-09-12T12:00:00Z');
ok(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0"/.test(feed) && (feed.match(/<item>/g) || []).length === 2 && /<guid isPermaLink="true">https:\/\/gameweekedge\.co\.uk\/articles\/first-post\/<\/guid>/.test(feed), 'RSS 2.0 with an item per post and permalink guids');
ok(/<atom:link href="https:\/\/gameweekedge\.co\.uk\/articles\/feed\.xml" rel="self"/.test(feed) && /<language>en-gb<\/language>/.test(feed) && /<pubDate>Tue, 01 Sep 2026 09:00:00 GMT<\/pubDate>/.test(feed), 'a self link, the language and RFC dates');

section('the build writes the set, or says why not');
{
  const out = mkdtempSync(join(tmpdir(), 'ge-blog-out-'));
  const res = await buildBlog(dir, out, L, '2026-09-12T12:00:00Z');
  ok(res.posts === 2 && res.urls.length === 3 && existsSync(join(out, 'articles', 'index.html')) && existsSync(join(out, 'articles', 'feed.xml')) && existsSync(join(out, 'articles', 'first-post', 'index.html')), 'index, feed and a page per post, with sitemap entries');
  const empty = mkdtempSync(join(tmpdir(), 'ge-blog-empty-'));
  const none = await buildBlog(empty, out, L);
  ok(none.posts === 0 && none.urls.length === 0 && /no published post/.test(none.note), 'no published post writes nothing and says so');
  const repo = await buildBlog(ROOT, mkdtempSync(join(tmpdir(), 'ge-blog-repo-')), L);
  ok(repo.posts === 0, 'the repository ships the scaffold and no content (' + repo.note + ')');
  ok(existsSync(join(ROOT, 'content', 'posts', 'README.md')) && existsSync(join(ROOT, 'content', 'posts', '_template.md')), 'the folder carries the how-to and a template');
  rmSync(out, { recursive: true, force: true }); rmSync(empty, { recursive: true, force: true });
}
rmSync(dir, { recursive: true, force: true });

section('one source of links');
{
  const links = siteLinks(html);
  ok(links && 'discord' in links && 'leagueCode' in links && 'contact' in links && 'terms' in links, 'SITE_LINKS in index.html has the four keys');
  ok(Object.values(links).every((v) => v === ''), 'every value is empty until the owner fills it (the scaffold)');
  ok(footerLinks(links).length === 1 && footerLinks(links)[0].label === 'Privacy', 'with nothing filled only the privacy link renders');
  const all = footerLinks(L);
  ok(all.map((x) => x.label).join('|') === 'Contact|Privacy|Discord|Official mini-league' && all[3].href === LEAGUE_JOIN + 'xyz12', 'filled values render in one order everywhere');
  ok(footerLinks({ ...L, terms: '/terms.html' }).map((x) => x.label).join('|') === 'Contact|Terms|Privacy|Discord|Official mini-league', 'terms sits between contact and privacy when it exists');
  ok(/rel="noopener">Discord<\/a>/.test(footerLinksHtml(L)) && !/rel="noopener">Contact/.test(footerLinksHtml(L)), 'external links carry noopener');
  ok(/<!-- site:links -->/.test(readFileSync(join(ROOT, 'landing.html'), 'utf8')), 'the landing page carries the marker the build fills');
  ok(/id="sb-foot-links"/.test(html) && /function renderSiteLinks\(\)/.test(html) && /renderSiteLinks\(\);/.test(html), 'the app renders the same links into its sidebar footer at boot');
  ok(/\['__discord',/.test(html) && /\['__league',/.test(html) && /\['__contact',/.test(html) && /if\(!SITE_LINKS\.discord\)return '';/.test(html), 'the More sheet has the community rows and hides each one without a value');
  ok(/LEAGUE_JOIN='https:\/\/fantasy\.premierleague\.com\/leagues\/auto-join\/'/.test(html) && LEAGUE_JOIN === 'https://fantasy.premierleague.com/leagues/auto-join/', 'the app and the build agree on the auto-join address');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
