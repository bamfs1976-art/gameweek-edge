/*
 * Design-token guards: contrast and the type-scale floor.
 *
 * Run: node dev/test-tokens.mjs   (wired into CI)
 *
 * Why this file exists.
 *
 * The token block already carried hand-written contrast ratios in its
 * comments, and the ones that were there were ACCURATE — --tab-on claimed
 * 5.9:1 and measures 5.92, dark --text-3 claimed 6.3:1 and measures 6.36.
 * Somebody did that work properly with a real tool. The problem was never
 * rigour, it was coverage: the same pass was never run over --text-3 and
 * --text-4 in the light theme, over --hot, or over --accent-warn, and those
 * four sat between 1.65:1 and 2.80:1 for as long as the light theme existed.
 *
 * A comment cannot fail a build. This can. Every ratio below is recomputed
 * from the shipped stylesheet on every run, so a token edited to a prettier
 * hue six months from now trips here rather than in front of a user.
 *
 * Ratios are measured against --surface-3, the strictest surface in each
 * theme: the darkest of the three light surfaces, the lightest of the three
 * dark ones. Passing there means passing on --bg and --surface too.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

/* ---- colour maths (WCAG 2.x relative luminance) ---- */
const rgb = (h) => {
  h = h.trim().replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const chan = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const [r, g, b] = rgb(hex).map(chan); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/* ---- read the tokens back out of the shipped file ----
   Parsed rather than duplicated: a test that carries its own copy of the
   palette passes happily while the stylesheet says something else. */
function tokenBlock(startRe) {
  const i = html.search(startRe);
  assert.ok(i > -1, `token block not found: ${startRe}`);
  const end = html.indexOf('\n}', i);
  return html.slice(i, end);
}
function readTokens(block) {
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[m[1]] = m[2];
  return out;
}
/* The first :root is the light theme. The dark theme is the block that
   redefines --bg to the near-black canvas. */
const light = readTokens(tokenBlock(/:root\{\s*\n\s*\/\* Surfaces \*\//));
const dark = readTokens(tokenBlock(/--bg:#0A0C0F;/));

assert.ok(Object.keys(light).length > 20, `light theme parsed only ${Object.keys(light).length} tokens`);
assert.ok(Object.keys(dark).length > 8, `dark theme parsed only ${Object.keys(dark).length} tokens`);

/* ---- the requirements ----
   4.5 for anything that carries body-size text (WCAG 2.2 SC 1.4.3).
   3.0 for UI components and graphical objects (SC 1.4.11), which is what
   --text-4 is: it renders the "—" that means "no value", the blank fixture
   cell and the unfilled dot. Holding it to 4.5 would collapse it into
   --text-3 and cost the ramp a step, so the lower bar is a deliberate,
   documented choice rather than an oversight. --green-bright is decoration
   only — focus rings, borders, the tour spotlight — and must stay off text;
   --tab-on is the green ink. */
const RULES = [
  ['--text', 4.5, 'body'],
  ['--text-2', 4.5, 'secondary text'],
  ['--text-3', 4.5, 'faint text (110 uses)'],
  ['--text-4', 3.0, 'no-data glyph (UI threshold)'],
  ['--green', 4.5, 'brand ink (104 uses)'],
  ['--green-bright', 3.0, 'focus ring / borders — never text'],
  ['--tab-on', 4.5, 'active tab ink'],
  ['--lock', 4.5, 'paywall ink'],
  ['--red', 4.5, 'alert text'],
  ['--blue', 4.5, 'info text'],
  ['--purple', 4.5, 'purple text'],
  ['--accent-warn', 4.5, 'warning text'],
  ['--hot', 4.5, 'THE key number on the screen'],
];

let checked = 0;
for (const [theme, tokens] of [['light', light], ['dark', dark]]) {
  const surface = tokens['--surface-3'];
  assert.ok(surface, `${theme}: no --surface-3 to measure against`);
  for (const [name, min, role] of RULES) {
    const value = tokens[name];
    if (!value) continue;                    // dark theme redefines only some
    const ratio = contrast(value, surface);
    assert.ok(ratio >= min,
      `${theme} ${name} (${value}) is ${ratio.toFixed(2)}:1 on --surface-3 ${surface}, ` +
      `needs ${min}:1 — ${role}`);
    checked++;
  }
}

/* ---- fills, where the pair that matters is the ink ON them ----
   The easy mistake, and the one this caught on its first run: --accent-cta
   was measured against the canvas and looked fine at 3.32:1, while the white
   label sitting on it was 3.77:1 and every primary button in the app failed.
   A fill is judged by its ink, and separately by 3:1 against the canvas so
   the button still has a visible edge. */
const FILLS = [
  ['--accent-cta', '--accent-cta-ink', 'primary CTA button'],
  ['--lock', '--lock-on', 'paywall chip'],
];
for (const [theme, tokens] of [['light', light], ['dark', dark]]) {
  const surface = tokens['--surface-3'];
  for (const [fill, ink, role] of FILLS) {
    if (!tokens[fill] || !tokens[ink]) continue;
    const onInk = contrast(tokens[fill], tokens[ink]);
    assert.ok(onInk >= 4.5,
      `${theme} ${ink} (${tokens[ink]}) on ${fill} (${tokens[fill]}) is ${onInk.toFixed(2)}:1, ` +
      `needs 4.5:1 — ${role}`);
    const onCanvas = contrast(tokens[fill], surface);
    assert.ok(onCanvas >= 3.0,
      `${theme} ${fill} (${tokens[fill]}) is ${onCanvas.toFixed(2)}:1 against --surface-3, ` +
      `needs 3:1 to read as a distinct surface — ${role}`);
    checked += 2;
  }
}

/* ---- the type-scale floor ----
   59 distinct sizes down to 7.68px is not a scale. The floor is the part
   that can be enforced without rewriting 281 declarations at once: nothing
   new may go below it, so the file can only improve from here. */
const FLOOR = 10;
const sizes = [...html.matchAll(/font-size:\s*([0-9.]+)(px|rem)/g)]
  .map((m) => ({ px: m[2] === 'rem' ? +m[1] * 16 : +m[1], raw: m[0] }));
const tooSmall = sizes.filter((s) => s.px < FLOOR);
assert.equal(tooSmall.length, 0,
  `${tooSmall.length} font-size declarations below the ${FLOOR}px floor ` +
  `(${[...new Set(tooSmall.map((s) => s.raw))].slice(0, 6).join(', ')}) — ` +
  `use var(--fs-min) or a larger step from the scale`);

/* The floor token itself must exist and match. */
const floorDecl = html.match(/--fs-min:\s*([0-9.]+)px/);
assert.ok(floorDecl, 'no --fs-min token — the type scale block is missing');
assert.equal(+floorDecl[1], FLOOR, `--fs-min is ${floorDecl[1]}px but this guard enforces ${FLOOR}px`);

const distinct = new Set(sizes.map((s) => s.px)).size;
console.log(`token guard OK: ${checked} contrast pairs pass against --surface-3 in both themes; ` +
  `no font-size below ${FLOOR}px (${distinct} distinct literal sizes remain, migrating to --fs-* as components are touched)`);
