#!/usr/bin/env node
/* Accessibility guard — WCAG 2.2 AA, held as assertions rather than a
 * checklist someone re-reads.
 *
 *   node scripts/check-a11y.mjs            # fail on any finding
 *   node scripts/check-a11y.mjs --report   # print the counts and exit 0
 *
 * Five checks, all static, all over index.html (and the record page):
 *
 *   1. FOCUS. Every interactive element keeps a visible focus style. The
 *      global :focus-visible ring must exist, be at least 2px and use a
 *      token; and no rule may set outline:none / outline:0 on a control
 *      unless the same rule draws a replacement (border-color, box-shadow).
 *   2. SPARKLINES. Every inline SVG sparkline (and the uPlot host that
 *      replaces it) carries a text alternative: role="img" with an
 *      aria-label. Other inline SVGs are either decorative (aria-hidden) or
 *      labelled (role="img" + aria-label, or a <title>).
 *   3. CONTRAST. Every ink token clears 4.5:1 against every surface it can
 *      sit on, in both themes; UI-only tokens clear 3:1; fills are judged by
 *      the ink on them. Recomputed from the shipped stylesheet every run.
 *   4. MOTION. Every animation and transition is neutralised under
 *      prefers-reduced-motion: reduce — either declared inside a
 *      no-preference block or covered by the global collapse rule.
 *   5. LABELS. Every <input>, <select> and <textarea> has an accessible
 *      name: aria-label / aria-labelledby, a <label for> that names its id,
 *      a wrapping <label>, or type="hidden".
 *
 * Static rather than a browser run so it costs seconds and runs on every
 * push; the browser suites cover what a parser cannot see.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const report = process.argv.includes('--report');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const record = readFileSync(join(root, 'record', 'index.html'), 'utf8');

const findings = { focus: [], sparkline: [], contrast: [], motion: [], labels: [] };
const note = (k, msg) => findings[k].push(msg);

/* ── the stylesheet, comments stripped ────────────────────────── */
const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const css = styleBlocks.replace(/\/\*[\s\S]*?\*\//g, ' ');

/* Split CSS into top-level rules with their enclosing @media (one level). */
function rules(src) {
  const out = [];
  let i = 0;
  const walk = (s, media) => {
    let depth = 0, start = -1, selStart = 0;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (c === '{') {
        if (depth === 0) { start = k; }
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          const sel = s.slice(selStart, start).trim();
          const body = s.slice(start + 1, k);
          if (sel.startsWith('@media') || sel.startsWith('@supports')) walk(body, sel.startsWith('@media') ? sel : media);
          else if (!sel.startsWith('@')) out.push({ sel, body, media });
          selStart = k + 1; start = -1;
        }
      }
    }
  };
  walk(src, null);
  void i;
  return out;
}
const RULES = rules(css);

/* ── 1. focus ───────────────────────────────────────────────────── */
{
  const global = RULES.filter((r) => /^:focus-visible$/.test(r.sel.trim()));
  if (!global.length) note('focus', 'no global :focus-visible rule — nothing draws a focus ring by default');
  for (const g of global) {
    const w = /outline\s*:\s*([\d.]+)px/.exec(g.body);
    if (!w || Number(w[1]) < 2) note('focus', ':focus-visible outline is thinner than 2px: ' + g.body.trim());
    if (!/var\(--/.test(g.body)) note('focus', ':focus-visible ring is not a token colour: ' + g.body.trim());
  }
  for (const r of RULES) {
    if (!/outline\s*:\s*(none|0)\b/.test(r.body)) continue;
    const replaced = /(border-color|box-shadow|background)\s*:/.test(r.body);
    const isFocus = /:focus/.test(r.sel);
    /* A focus rule that only removes the ring leaves a keyboard user with
       no cue. A non-focus rule removing the outline on a control strips the
       global ring from it. */
    if (isFocus && !replaced) note('focus', 'focus rule removes the outline with no replacement: ' + r.sel);
    if (!isFocus) note('focus', 'rule removes the outline outside a focus state: ' + r.sel);
  }
}

/* ── 2. sparklines and inline SVGs ───────────────────────────────── */
{
  const svgs = [...html.matchAll(/<svg\b[^>]*>/g)];
  for (const m of svgs) {
    const tag = m[0];
    const isSpark = /class=["'\\]*sparkline/.test(tag);
    const labelled = /role=["'\\]*img/.test(tag) && /aria-label/.test(tag);
    const hidden = /aria-hidden=["'\\]*true/.test(tag);
    const titled = /<title>/.test(html.slice(m.index, m.index + 300));
    if (isSpark) {
      if (!labelled) note('sparkline', 'sparkline SVG without role="img" + aria-label at offset ' + m.index);
    } else if (!(labelled || hidden || titled)) {
      note('sparkline', 'inline SVG neither decorative nor labelled at offset ' + m.index + ': ' + tag.slice(0, 80));
    }
  }
  /* The uPlot host stands in for the SVG on capable browsers; it must carry
     the same alternative or the chart is invisible to a reader. */
  for (const m of html.matchAll(/<span class=["'\\]*sparkline spark-host[^>]*>/g)) {
    if (!(/role=["'\\]*img/.test(m[0]) && /aria-label/.test(m[0]))) note('sparkline', 'sparkline host without role="img" + aria-label at offset ' + m.index);
  }
}

/* ── 3. contrast ────────────────────────────────────────────────── */
const rgb = (h) => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const chan = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const [r, g, b] = rgb(hex).map(chan); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) if (m[2].length <= 7) out[m[1]] = m[2];
  return out;
}
{
  const lightStart = css.search(/:root\s*\{\s*--bg:#f4f6f8/);
  const darkStart = css.search(/\[data-theme="dark"\]\s*\{\s*--bg:#10161c/);
  const cut = (i) => css.slice(i, css.indexOf('\n}', i));
  const light = tokens(cut(lightStart));
  const dark = Object.assign({}, light, tokens(cut(darkStart)));
  const SURFACES = ['--bg', '--surface', '--surface-2', '--surface-3', '--elevated'];
  /* Ink tokens and the bar each is held to. Text at body size needs 4.5;
     --text-4 and --green-bright are UI-only and need 3.0. */
  const INKS = [['--text', 4.5], ['--text-2', 4.5], ['--text-3', 4.5], ['--text-4', 3.0], ['--green', 4.5],
    ['--green-bright', 3.0], ['--tab-on', 4.5], ['--lock', 4.5], ['--red', 4.5], ['--blue', 4.5], ['--purple', 4.5],
    ['--accent-warn', 4.5], ['--hot', 4.5], ['--amber', 4.5], ['--pos-gk', 4.5], ['--pos-def', 4.5], ['--pos-mid', 4.5],
    ['--pos-fwd', 4.5], ['--conf-high', 4.5], ['--conf-med', 4.5], ['--conf-low', 4.5], ['--accent-alert', 4.5]];
  for (const [theme, t] of [['light', light], ['dark', dark]]) {
    for (const [ink, bar] of INKS) {
      if (!t[ink]) continue;
      for (const s of SURFACES) {
        if (!t[s]) continue;
        const r = contrast(t[ink], t[s]);
        if (r < bar) note('contrast', `${theme}: ${ink} ${t[ink]} on ${s} ${t[s]} = ${r.toFixed(2)}:1 (needs ${bar})`);
      }
    }
    /* Fills: the ink ON them, and 3:1 edge against the canvas. */
    for (const [fill, ink] of [['--accent-cta', '--accent-cta-ink'], ['--lock', '--lock-on'], ['--hero-a', '--hero-ink'], ['--hero-b', '--hero-ink']]) {
      if (!t[fill] || !t[ink]) continue;
      const r = contrast(t[ink], t[fill]);
      if (r < 4.5) note('contrast', `${theme}: ${ink} on ${fill} = ${r.toFixed(2)}:1 (needs 4.5)`);
    }
    /* Filled buttons with literal white ink. */
    for (const fill of ['--green', '--red']) {
      if (!t[fill]) continue;
      const r = contrast('#ffffff', t[fill]);
      if (r < 4.5) note('contrast', `${theme}: white text on ${fill} ${t[fill]} = ${r.toFixed(2)}:1 (needs 4.5; .btn-primary / .badge-red)`);
    }
  }
}

/* ── 4. motion ──────────────────────────────────────────────────── */
{
  const collapse = RULES.find((r) => r.media && /prefers-reduced-motion\s*:\s*reduce/.test(r.media)
    && /\*\s*,\s*\*::before\s*,\s*\*::after/.test(r.sel) && /animation-duration\s*:\s*\.01ms\s*!important/.test(r.body)
    && /transition-duration\s*:\s*\.01ms\s*!important/.test(r.body));
  if (!collapse) note('motion', 'no global prefers-reduced-motion collapse (*,*::before,*::after with !important durations)');
  /* Iteration count and delay are not collapsed by a duration rule: an
     infinite animation with a 0.01ms duration still repaints every frame.
     Every infinite animation must be switched off explicitly or declared
     only under no-preference. */
  for (const r of RULES) {
    if (!/animation\s*:[^;]*infinite/.test(r.body)) continue;
    if (r.media && /no-preference/.test(r.media)) continue;
    const name = (/animation\s*:\s*([a-zA-Z_-]+)/.exec(r.body) || [])[1];
    const off = RULES.some((o) => o.media && /reduce/.test(o.media) && /animation\s*:\s*none|animation-iteration-count\s*:\s*1/.test(o.body)
      && (o.sel.split(',').some((s) => r.sel.split(',').some((rs) => rs.trim() === s.trim())) || /\*\s*,\s*\*::before/.test(o.sel)));
    const globalOff = collapse && /animation-iteration-count\s*:\s*1\s*!important/.test(collapse.body);
    if (!off && !globalOff) note('motion', `infinite animation "${name}" on ${r.sel} is not stopped under reduce`);
  }
  if (/scroll-behavior\s*:\s*smooth/.test(css) && !RULES.some((r) => r.media && /reduce/.test(r.media) && /scroll-behavior\s*:\s*auto/.test(r.body))) {
    note('motion', 'scroll-behavior:smooth is not reset under reduce');
  }
  /* Script-driven smooth scrolling has no CSS fallback. */
  for (const m of html.matchAll(/behavior\s*:\s*['"]smooth['"]/g)) {
    const around = html.slice(Math.max(0, m.index - 200), m.index);
    if (!/reduced-motion|prefersReduced|smoothOk|motionOk/.test(around)) note('motion', 'scrollIntoView/scrollTo smooth without a reduced-motion check at offset ' + m.index);
  }
}

/* ── 5. labels ──────────────────────────────────────────────────── */
{
  const src = html.replace(/<!--[\s\S]*?-->/g, '');
  const forIds = new Set([...src.matchAll(/<label[^>]*\bfor=["'\\]*([a-zA-Z0-9_-]+)/g)].map((m) => m[1]));
  for (const m of src.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
    const tag = m[0];
    if (/type=["'\\]*hidden/.test(tag)) continue;
    if (/aria-label(ledby)?=/.test(tag)) continue;
    const id = (/\bid=["'\\]*([a-zA-Z0-9_-]+)/.exec(tag) || [])[1];
    if (id && forIds.has(id)) continue;
    /* Wrapped in a <label>: the nearest <label before it has no </label>
       between them. */
    const before = src.slice(Math.max(0, m.index - 400), m.index);
    const lo = before.lastIndexOf('<label'), lc = before.lastIndexOf('</label>');
    if (lo >= 0 && lo > lc) continue;
    /* A dynamic id (id="'+x+'") is named by a label built alongside it;
       accept when a for= with the same expression exists. */
    const dyn = (/\bid=["']\s*\+\s*([^+]+?)\s*\+/.exec(tag) || [])[1];
    if (dyn && src.includes('for="\'+' + dyn + '+\'"')) continue;
    const line = src.slice(0, m.index).split('\n').length;
    note('labels', `${m[1]} without an accessible name at line ${line}: ${tag.slice(0, 90)}`);
  }
  /* The record page is a real document too. */
  for (const m of record.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
    if (!/aria-label|type="hidden"/.test(m[0])) note('labels', 'record/index.html: ' + m[0].slice(0, 80));
  }
}

/* ── verdict ────────────────────────────────────────────────────── */
const total = Object.values(findings).reduce((n, a) => n + a.length, 0);
for (const [k, list] of Object.entries(findings)) {
  console.log(`  ${k}: ${list.length} finding${list.length === 1 ? '' : 's'}`);
  for (const f of list) console.log('    - ' + f);
}
if (total && !report) {
  console.error(`check-a11y: ${total} finding(s). Fix them or record a deliberate exemption in docs/A11Y_AUDIT.md and the rule above.`);
  process.exit(1);
}
console.log(`check-a11y ${report ? 'report' : 'OK'}: ${total} finding(s) across focus, sparklines, contrast, motion and labels`);
