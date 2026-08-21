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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; } else { fails.push(m); console.error('  ✗ ' + m); } };

function extractBlock(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0, inStr = null, esc = false, com = 0;
  for (let j = open; j < src.length; j++) {
    const ch = src[j], nx = src[j + 1];
    if (com) { if (com === 1 && ch === '\n') com = 0; else if (com === 2 && ch === '*' && nx === '/') { com = 0; j++; } continue; }
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && nx === '/') { com = 1; j++; continue; }
    if (ch === '/' && nx === '*') { com = 2; j++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced block');
}
const fn = (n) => extractBlock(html, html.indexOf('function ' + n + '('));

/* The real builder, run for real — a copy of the prose would prove nothing. */
const ctx = vm.createContext({});
vm.runInContext([
  fn('chipStrategyArticle'),
  /* The availability briefing and the four helpers it leans on, lifted whole
     so the article under test is the article that ships. */
  fn('availabilityArticle'), fn('esc'), fn('timeAgo'), fn('fmtDeadline'),
  fn('teamShort'), fn('posShort'),
  'Object.assign(globalThis,{chipStrategyArticle,availabilityArticle});',
].join('\n'), ctx);
const { chipStrategyArticle, availabilityArticle } = ctx;

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

/* ── The availability briefing ─────────────────────────────
   The Wire's five other articles are all built from points, price and
   fixtures. This is the only one built from the availability fields, and it
   is the one a reader acts on in the twenty minutes before a deadline — so
   the ways it could quietly mislead are asserted, not trusted. */
console.log('\n• wire: the availability briefing');
{
  const H = 3600e3, NOW = Date.parse('2026-08-20T12:00:00Z');
  const p = (id, o) => Object.assign({
    id, web_name: 'P' + id, team: 1, element_type: 3, now_cost: 50,
    status: 'a', news: '', news_added: null, selected_by_percent: '5.0',
    chance_of_playing_next_round: null,
  }, o);
  const B = (els) => ({
    elements: els,
    teams: { 1: { short_name: 'ARS', name: 'Arsenal' } },
    types: { 3: { singular_name_short: 'MID' } },
  });
  const CUR = { id: 3, finished: false, deadline_time: '2026-08-22T11:30:00Z' };

  ok(availabilityArticle(B([p(1), p(2)]), CUR) === null,
    'a squad with nothing flagged produces no article at all, rather than an empty one');
  ok(availabilityArticle(B([p(1, { status: 'i', news: 'Out' })]), null) === null,
    'and no article without a current gameweek to hang it on');

  const els = [
    p(1, { status: 's', news: 'Three match ban', news_added: new Date(NOW - 5 * H).toISOString(), selected_by_percent: '41.2' }),
    p(2, { status: 'i', news: 'Hamstring', news_added: new Date(NOW - 30 * H).toISOString(), selected_by_percent: '28.7' }),
    p(3, { status: 'd', news: 'Knock', news_added: new Date(NOW - 2 * H).toISOString(), chance_of_playing_next_round: 75, selected_by_percent: '33.9' }),
    p(4, { status: 'd', news: 'Illness', news_added: new Date(NOW - 90 * H).toISOString(), chance_of_playing_next_round: 25, selected_by_percent: '12.4' }),
    p(5, { status: 'i', news: 'Knee - unknown return', news_added: null, selected_by_percent: '8.8' }),
    p(6, { status: 'a', news: '', selected_by_percent: '60.0' }),
  ];
  const a = availabilityArticle(B(els), CUR, NOW);

  for (const k of ['kick', 'title', 'dek', 'accent', 'mins', 'body']) {
    ok(a[k] !== undefined && a[k] !== '', 'the availability article carries a ' + k);
  }
  ok(ACCENTS.includes(a.accent), 'its accent has a stylesheet rule (' + a.accent + ')');
  ok(!/undefined|NaN|\[object Object\]/.test(a.body), 'no undefined/NaN leaking into the prose');
  ok((a.body.match(/<ul>/g) || []).length === (a.body.match(/<\/ul>/g) || []).length,
    'every list it opens, it closes');
  ok(!a.body.includes('P6'), 'an unflagged player is not in the article');

  /* A ban is arithmetic; an injury is a probability. Conflating the two is
     the single most misleading thing this article could do, so the suspended
     tier is its own heading and says outright that it is not a forecast. */
  ok(/Suspended — certain misses/.test(a.body), 'suspensions get their own tier');
  ok(/not a forecast/.test(a.body), 'and are marked as the only certain line');
  ok(a.body.indexOf('Suspended — certain misses') < a.body.indexOf('Ruled out'),
    'and lead the article, because they are the only thing it knows for sure');
  /* The tiers must PARTITION the flagged, not overlap them. A suspended player
     also listed under "Ruled out" reads as two separate absences and inflates
     every count in the dek. The recency list is a deliberate second pass over
     the same players, so it is excluded from the count. */
  {
    const tiers = a.body.slice(0, a.body.indexOf('Changed in the last 72 hours'));
    for (const e of els.filter((x) => x.status !== 'a')) {
      const seen = (tiers.match(new RegExp('>' + e.web_name + '<', 'g')) || []).length;
      ok(seen === 1, `${e.web_name} (${e.status}) appears in exactly one tier, not ${seen}`);
    }
  }

  /* Ownership-first inside a tier: a flagged player nobody owns is a fact, a
     flagged player a third of the game owns is the news. */
  ok(a.body.indexOf('33.9% owned') < a.body.indexOf('12.4% owned'),
    'inside a tier the most-owned player is listed first');
  ok(/<b>75%<\/b> to play/.test(a.body), 'a doubt carries its chance of playing');

  /* THE ONE THAT MATTERS. news_added is the only timestamp the API gives. A
     player without one must never be called new — undated is not recent, and
     a reader who sees "updated 2h ago" against a note from March acts on it. */
  const fresh = a.body.slice(a.body.indexOf('Changed in the last 72 hours'));
  ok(/Changed in the last 72 hours/.test(a.body), 'recent changes are surfaced');
  ok(!fresh.includes('P5'), 'a flagged player with NO timestamp is never listed as recently changed');
  ok(!fresh.includes('P4'), 'nor is one whose note is 90 hours old');
  ok(fresh.indexOf('P3') < fresh.indexOf('P1'), 'and the freshest note leads that list');
  ok(/1 flagged player carries no update timestamp/.test(a.body),
    'the article counts the undated rather than hiding them');
  ok(a.body.includes('P5'), 'though the undated player still appears in his own tier');

  /* The claim the whole article rests on, and the boundary it must not cross. */
  ok(/not a team sheet/i.test(a.body), 'it states that a flag is fitness, not selection');
  ok(/rotation question/i.test(a.body) && /not mixed in here/i.test(a.body),
    'and refuses to blend rotation risk into an availability piece');
  ok(!/PLDRotation|rotationRisk|clubBaseline/.test(a.body),
    'with nothing from the rotation model actually reaching the prose');

  /* Framing follows the deadline, because "who is fit" and "who was fit" are
     different questions and the reader is asking one of them. */
  const after = availabilityArticle(B(els), { ...CUR, finished: true }, NOW);
  ok(/Before Gameweek 3/.test(a.title) && /After Gameweek 3/.test(after.title),
    'the title turns with the deadline (' + a.title + ' / ' + after.title + ')');
  ok(/Deadline/.test(a.body) && !/Deadline/.test(after.body),
    'and the deadline is only quoted while it is still ahead');
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
