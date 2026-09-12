/* Gameweek Edge — pre-rendered shells for the content routes.

   The app is one file, so a crawler that does not run scripts sees a
   title and a description and nothing else. For the routes whose copy
   needs no live data (the methodology, the design system, the glossary,
   the rules of the game, The Wire's front) this writes the SAME shell with
   that route's head already filled in and its copy already in #pages. The
   app boots on top and repaints #pages as it always does, so a reader
   sees no difference and a crawler sees the page.

   The copy is read out of index.html: GLOSSARY and FPL_BASICS are
   literals, the methodology's sections are the strings its own hydrator
   writes, and the FAQ is the landing page's. Nothing is restated here. */
import { evalLiteral, esc, describe, SITE } from './routes.mjs';
import { sliceBalanced } from '../extract-engine.mjs';

const unquote = (lit) => new Function('return ' + lit)();

/* The methodology hydrator is a string builder: sec('Title', p('…'), …).
   Read the titles and the paragraphs in order, from its own source. */
export function methodologySections(html) {
  const i = html.indexOf('async function hydrateMethodology(host){');
  if (i < 0) return [];
  const src = sliceBalanced(html, i, '{', '}');
  const out = [];
  const re = /sec\('((?:[^'\\]|\\.)*)'|p\('((?:[^'\\]|\\.)*)'\)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1] != null) out.push({ title: unquote("'" + m[1] + "'"), paras: [] });
    else if (out.length) out[out.length - 1].paras.push(unquote("'" + m[2] + "'"));
  }
  return out.filter((s) => s.paras.length);
}

/* The landing page's FAQ: <details><summary>Q</summary><p>A</p></details>. */
export function landingFaq(landing) {
  const out = [];
  const re = /<details><summary>([^<]*)<\/summary><p>([\s\S]*?)<\/p><\/details>/g;
  let m;
  while ((m = re.exec(landing))) out.push({ q: decode(m[1].trim()), a: decode(m[2].replace(/<[^>]+>/g, '').trim()) });
  return out;
}
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/* The app's own FAQ constant, the copy the methodology page shows. */
export function appFaq(html) {
  return evalLiteral(html, 'const FAQ=', '[', ']');
}

export function faqJsonLd(faq) {
  return { '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
}

const card = (title, body) => '<div class="card mb-20"><div class="card-title">' + esc(title) + '</div>' + body + '</div>';
const para = (t) => '<p class="dl-sub" style="margin:0 0 8px;font-size:13px;line-height:1.55">' + t + '</p>';

/* The static body for one route, from the app's own copy. */
export function routeBody(id, html, landing) {
  if (id === 'glossary') {
    const G = evalLiteral(html, 'const GLOSSARY=', '{', '}');
    return card('FPL and model terms', '<dl class="dl">' + Object.keys(G).map((k) =>
      '<div class="dl-row" style="display:block;padding:11px 0"><dt class="dl-nm mono" style="text-transform:none;color:var(--green-bright)">' + esc(k) + '</dt>' +
      '<dd class="dl-sub" style="margin:3px 0 0;line-height:1.5;font-size:12.5px">' + esc(G[k]) + '</dd></div>').join('') + '</dl>');
  }
  if (id === 'fplbasics') {
    const B = evalLiteral(html, 'const FPL_BASICS=', '[', ']');
    return B.map(([h, b]) => card(h, para(esc(b)))).join('');
  }
  if (id === 'methodology') {
    const secs = methodologySections(html);
    const faq = appFaq(html);
    return secs.map((s) => card(s.title, s.paras.map(para).join(''))).join('') +
      card('Questions, answered', faq.map((f) => '<details class="faq-d"><summary>' + esc(f.q) + '</summary>' + para(esc(f.a)) + '</details>').join(''));
  }
  if (id === 'design') {
    return card('The terminal design system', para('Tokens for colour, type and spacing, the type scale, the data table, cards, badges, buttons and every state the app draws, in the dark terminal and the light variant. The same primitives every panel is built from, so a screen never invents its own.'));
  }
  if (id === 'blog') {
    return card('The Wire', para('Briefings written from live data and our own model every gameweek: talking points, differentials, the price watch, fixture swings and captaincy. Each briefing says which numbers it read and when, and the pre-season guides stay pinned until the season settles.'));
  }
  return '';
}

/* One route's shell: index.html with its head filled in and its copy in
   #pages. The replacements target the exact tags the app's seoSync()
   writes at runtime, so the two are the same page. */
export function shellFor(html, route, body, jsonld) {
  const url = SITE + route.path;
  let out = html;
  const swap = (re, repl) => { if (!re.test(out)) throw new Error('shell anchor missing: ' + re); out = out.replace(re, repl); };
  swap(/<title>[^<]*<\/title>/, '<title>' + esc(route.title) + '</title>');
  swap(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + esc(route.description) + '">');
  swap(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + esc(url) + '">');
  swap(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + esc(route.title) + '">');
  swap(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + esc(route.description) + '">');
  swap(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + esc(url) + '">');
  swap(/<meta name="twitter:title" content="[^"]*">/, '<meta name="twitter:title" content="' + esc(route.title) + '">');
  swap(/<meta name="twitter:description" content="[^"]*">/, '<meta name="twitter:description" content="' + esc(route.description) + '">');
  if (jsonld) swap(/<link rel="canonical" href="[^"]*">/, (m) => m + '\n<script type="application/ld+json">' + JSON.stringify(jsonld).replace(/<\//g, '<\\/') + '</script>');
  const main = '<main class="page active" id="main" tabindex="-1"><div class="page-head"><div class="page-head-row"><div><h1>' + esc(route.label) + '</h1><p>' + esc(route.description.replace(/ Gameweek Edge\.$/, '')) + '</p></div></div></div>' + body + '</main>';
  swap(/<div id="pages"><\/div>/, '<div id="pages">' + main + '</div>');
  return out;
}
