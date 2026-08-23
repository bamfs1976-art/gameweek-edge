/*
 * Offline tests for the Social Studio caption table.
 *
 * A caption is the one part of the card that a machine cannot check by
 * looking at it. Three things can silently go wrong, and all three ship a
 * broken post rather than a broken build:
 *
 *   1. A preset gains a card but no caption, so the Copy buttons vanish for
 *      that card and the owner is back to hunting through a markdown file.
 *   2. A Bluesky caption creeps over 300 characters. Bluesky rejects the
 *      post outright — you find out standing in the kitchen at 20:00.
 *   3. A bracket placeholder survives editing. `[name] — [xP]` is exactly
 *      the friction the whole feature exists to remove, and it reads as
 *      finished text until you try to post it.
 *
 * So: every preset id pushed inside socialSpecs() must have an entry, every
 * Bluesky caption must fit, and no caption may contain a placeholder.
 *
 * Bluesky counts grapheme clusters, not UTF-16 code units, so the emoji in
 * these captions are one character each and [...str].length is the honest
 * measure. String.length would over-count them and pass a post that fails.
 *
 * Run: node dev/test-social-captions.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let failed = 0;
const fail = (m) => { console.error('  FAIL ' + m); failed++; };
const ok = (m) => console.log('  ok   ' + m);

/* ── Pull the caption table out of the page ──────────────────────────
   The values are template literals with no interpolation, so a scanner that
   understands the three quote characters and counts braces is exact here.
   An interpolation would break that assumption silently, so it is rejected
   loudly instead. */
function extractObject(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) throw new Error('could not find ' + decl);
  let i = src.indexOf('{', start);
  const from = i;
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      for (; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          throw new Error('caption table must not interpolate — the test cannot evaluate it safely');
        }
        if (src[i] === q) break;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return src.slice(from, i + 1); }
  }
  throw new Error('unbalanced braces in ' + decl);
}

const caps = new Function('return ' + extractObject(html, 'const SOC_CAPTIONS='))();
const ids = Object.keys(caps);
console.log('captions: ' + ids.length + ' entries');

/* ── 1. Every preset that can render a card has a caption ────────────
   socialSpecs() registers each preset with push('id', …). The four price
   ladders are registered inside a loop as 'ladder-'+pos, so they are added
   by hand rather than by regex. The two builder ids come from socBuildSpec. */
const specSrc = html.slice(html.indexOf('function socialSpecs('),
  html.indexOf('function renderSocialCard('));
/* The comma matters: it is what separates a literal id from the ladders'
   push('ladder-'+pos, whose first argument is an expression, not a name. */
const presetIds = [...specSrc.matchAll(/\bpush\('([a-z0-9-]+)'\s*,/g)].map(m => m[1]);
const expected = new Set([...presetIds, 'ladder-1', 'ladder-2', 'ladder-3', 'ladder-4',
  'custom-list', 'custom-squad']);

if (presetIds.length < 15) fail('only found ' + presetIds.length + ' presets — the scan is wrong');
else ok('scanned ' + presetIds.length + ' push() presets from socialSpecs()');

for (const id of expected) {
  if (!caps[id]) fail('preset "' + id + '" has a card but no caption');
}
if (!failed) ok('every one of the ' + expected.size + ' card ids has a caption');

/* An orphan is harmless at runtime but means a preset was renamed or dropped
   and the caption was left behind — worth knowing before it rots. */
for (const id of ids) {
  if (!expected.has(id)) fail('caption "' + id + '" matches no preset — stale entry?');
}

/* ── X's weighted character count ─────────────────────────────────────
   X does not count characters, it counts "weighted" ones: code points in a
   handful of ranges (Latin, punctuation, common dashes) weigh 1 and
   everything else — every emoji, and the → in the DefCon caption — weighs 2.
   On top of that every link is rewritten to a t.co URL and billed at a flat
   23 regardless of its real length, so gameweekedge.co.uk costs 23, not 18.
   Counting the naive way says these captions fit when they do not: the gap
   ran to 25 characters on the worst of them.
   Rules: https://developer.x.com/en/docs/counting-characters */
const X_LIGHT = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
const X_URL = /\b(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?/gi;
function xLen(s) {
  let n = 0;
  const stripped = s.replace(X_URL, () => { n += 23; return ''; });
  for (const ch of stripped) {
    const cp = ch.codePointAt(0);
    n += X_LIGHT.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2;
  }
  return n;
}

/* ── 2. Shape, and the two platform limits ───────────────────────────── */
const LIMIT = 300;
/* 280 is the limit on a standard X account. Premium raises it, but writing to
   the higher ceiling is what put fifteen of these captions over the edge in
   the first place — so the floor is what gets enforced. */
const X_LIMIT = 280;
let worst = { id: null, n: 0 };
let worstX = { id: null, n: 0 };
for (const id of ids) {
  const c = caps[id];
  for (const f of ['x', 'b', 'a']) {
    if (typeof c[f] !== 'string' || !c[f].trim()) { fail(id + '.' + f + ' is missing or empty'); continue; }
    if (/\[[^\]\n]{2,}\]/.test(c[f])) fail(id + '.' + f + ' still contains a [placeholder]');
    if (/\s$/.test(c[f])) fail(id + '.' + f + ' has trailing whitespace');
  }
  if (typeof c.b === 'string') {
    const n = [...c.b].length;
    if (n > LIMIT) fail(id + '.b is ' + n + ' characters — Bluesky will reject it');
    if (n > worst.n) worst = { id, n };
  }
  if (typeof c.x === 'string') {
    const n = xLen(c.x);
    if (n > X_LIMIT) fail(id + '.x is ' + n + ' weighted characters — X will reject it');
    if (n > worstX.n) worstX = { id, n };
  }
  /* The link is the entire point of posting. */
  for (const f of ['x', 'b']) {
    if (typeof c[f] === 'string' && !c[f].includes('gameweekedge.co.uk')) {
      fail(id + '.' + f + ' does not link to the site');
    }
  }
  /* #FPL is how a Bluesky post reaches the custom feeds; on X it leaks
     attention, which is why it belongs on one and not the other. */
  if (typeof c.b === 'string' && !c.b.includes('#FPL')) fail(id + '.b is missing #FPL');
  if (typeof c.x === 'string' && c.x.includes('#')) fail(id + '.x contains a hashtag');
}
if (!failed) {
  ok('all ' + ids.length + ' Bluesky captions fit 300 (longest: ' + worst.id + ' at ' + worst.n + ')');
  ok('all ' + ids.length + ' X captions fit 280 weighted (longest: ' + worstX.id + ' at ' + worstX.n + ')');
}

/* ── 3. The wiring is actually there ─────────────────────────────────── */
for (const [needle, why] of [
  ['socCapBlock(sp.id,i)', 'the preset gallery does not render caption blocks'],
  ['socCapBlock(spec.id,null)', 'the card builder does not render a caption block'],
  ['payload.text=c.b', 'the share sheet does not carry the caption'],
  ['function socCopyText(', 'the clipboard helper is missing'],
]) {
  if (!html.includes(needle)) fail(why);
}
if (!failed) ok('gallery, builder, share sheet and clipboard are wired');

console.log(failed ? '\n' + failed + ' failure(s)' : '\nsocial captions: all good');
process.exit(failed ? 1 : 0);
