/*
 * Guards for the Wire's pinned pre-season articles.
 *
 * Run: node dev/test-wire.mjs   (wired into npm test)
 *
 * Why this file exists.
 *
 * The Wire had no test at all. Its articles are hand-written HTML strings
 * built by functions and concatenated straight into the DOM, which is the
 * one shape where a typo is invisible until a reader hits it: an unclosed
 * tag swallows the rest of the post, a missing accent class renders a
 * colourless hero, and a body that returns undefined prints "undefined" in
 * production. None of that throws.
 *
 * It matters more now the Wire carries a piece written against someone
 * else's column. The chip article ATTRIBUTES its rules half to the Premier
 * League's Scout and keeps its own claims separate — that separation is an
 * editorial commitment, not a detail, so the attribution line is asserted
 * here rather than left to survive the next edit on trust.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { extractBlock } from './extract.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; } else { fails.push(m); console.error('  ✗ ' + m); } };

const fn = (n) => extractBlock(html, html.indexOf('function ' + n + '('));

/* The real builder, run for real — a copy of the prose would prove nothing. */
const ctx = vm.createContext({});
vm.runInContext([
  fn('chipStrategyArticle'),
  'Object.assign(globalThis,{chipStrategyArticle});',
].join('\n'), ctx);
const { chipStrategyArticle } = ctx;

/* Accent classes that actually have a stylesheet rule. A post given an
   accent the CSS has never heard of renders an unstyled grey hero. */
const ACCENTS = [...html.matchAll(/\.(a-[a-z]+) \.post-hero\{/g)].map((m) => m[1]);

console.log('• wire: the pinned articles are well formed');
{
  ok(ACCENTS.length >= 4, 'the stylesheet defines post accents (' + ACCENTS.join(', ') + ')');

  const a = chipStrategyArticle();
  for (const k of ['kick', 'title', 'dek', 'accent', 'mins', 'body']) {
    ok(a[k] !== undefined && a[k] !== '', 'chip article carries a ' + k);
  }
  ok(ACCENTS.includes(a.accent), 'its accent has a stylesheet rule (' + a.accent + ')');
  ok(typeof a.mins === 'number' && a.mins > 0, 'and a read time');
  ok(!/undefined|NaN|\[object Object\]/.test(a.body), 'the body has no undefined/NaN leaking into prose');
  ok(a.body.length > 1500, 'the body is a real article (' + a.body.length + ' chars)');

  /* Tag balance. Not a parser — a counter, which is all that is needed to
     catch the failure that actually happens: one closing tag dropped while
     editing prose, which swallows everything after it. */
  for (const tag of ['p', 'ul', 'li', 'h4', 'b']) {
    const open = (a.body.match(new RegExp('<' + tag + '(?=[ >])', 'g')) || []).length;
    const close = (a.body.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    ok(open === close, '<' + tag + '> balances (' + open + ' open, ' + close + ' close)');
  }
}

console.log('• wire: the chip article separates its sources');
{
  const a = chipStrategyArticle();
  /* The rules half is the Premier League's and is credited. Publishing
     someone else's column as our own analysis is the failure this prevents. */
  ok(/Scout column/i.test(a.body), 'the Scout column is credited by name');
  ok(/7 August 2026/.test(a.body), 'and dated, so a reader can go and check it');
  ok(/are ours/i.test(a.body), 'and our own claims are marked as ours');

  /* Claims made in our own name have to match what the briefing actually
     says, or the article is inventing support for itself. */
  ok(/softest opening trio/i.test(a.body), 'the City claim matches the briefing wording');
  ok(/Gameweek 19|GW19/.test(a.body), 'the half boundary is stated');
  const md = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.md'), 'utf8');
  ok(/softest opening trio in the division/.test(md),
    'and the briefing really does say it (not asserted from memory)');
  for (const club of ['Hull', 'Sunderland', 'Coventry', 'Ipswich', 'Fulham', 'Bournemouth']) {
    ok(a.body.includes(club), 'the hardest-openers list names ' + club);
  }
  ok(/avoid early/i.test(md) || /brutal openers/i.test(md),
    'and the briefing carries that list too');
}

console.log('• wire: the article is pinned to the top');
{
  /* preseasonArticles is read as source rather than run: the other builders
     it calls pull in half the app. Order is the whole point of the list. */
  const list = extractBlock(html, html.indexOf('function preseasonArticles('));
  const names = (list.match(/\w+Article\(\)/g) || []).map((s) => s.replace('()', ''));
  ok(names.length >= 3, 'the pinned list has several articles (' + names.length + ')');
  ok(names[0] === 'chipStrategyArticle',
    'the chip article is first, so it leads the Wire (' + names.join(' → ') + ')');
  ok(new Set(names).size === names.length, 'and nothing is pinned twice');
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
