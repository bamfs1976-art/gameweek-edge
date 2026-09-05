#!/usr/bin/env node
// Guard the phone.
//
// Modelled on pl-bookings' scripts/check-mobile.mjs, for the same reason:
// everything here failed SILENTLY on an iPhone. None of it threw, logged or
// looked wrong in a desktop browser.
//
//   The share buttons. iOS Safari ignores `download` on a blob: URL, so a
//   bare anchor is a dead button. Everything goes through PLDSave.
//
//   The layout viewport. A control wider than the screen does not overflow
//   on Safari; Safari widens the layout viewport and shrinks the whole page.
//   A <select> sizes itself to its longest option, so raising controls to
//   16px (which stops the focus zoom) needs a max-width cap to travel with it.
//
//   Touch targets. 44px under a coarse pointer, on every control a thumb
//   lands on — the tab bar, the rail, the tab strips, the chips, the menu.
//
//   The bottom bar and the notch. viewport-fit=cover puts content under the
//   home indicator and the status bar unless both insets are padded back.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const codeOnly = (src) => src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

const html = read('index.html');
const code = codeOnly(html);
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, ' ');

/* ---- 1. nothing saves a file through a bare anchor ---------------------- */
assert.ok(existsSync(join(root, 'vendor', 'save.js')), 'vendor/save.js is missing — nothing routes a phone to the share sheet');
const save = codeOnly(read('vendor/save.js'));
assert.ok(/navigator\.canShare/.test(save) && /navigator\.share\(/.test(save), 'save.js does not use the Web Share API');
assert.ok(/AbortError/.test(save), 'save.js does not special-case AbortError');
assert.equal((code.match(/\.download\s*=/g) || []).length, 0,
  'index.html sets a.download directly instead of going through PLDSave — that button does nothing on an iPhone');
assert.ok(/<script src="vendor\/save\.js">/.test(html), 'index.html does not load vendor/save.js');

/* ---- 2. installable, and padded for the notch and the home indicator --- */
for (const [needle, why] of [
  ['rel="manifest"', 'cannot be installed to a home screen'],
  ['apple-touch-icon', 'installs with a screenshot thumbnail instead of an icon'],
  ['name="theme-color"', 'gets a default browser chrome colour'],
  ['viewport-fit=cover', 'is letterboxed instead of using the full screen'],
  ['serviceWorker', 'launches into a Safari tab rather than the installed app']
]) assert.ok(html.includes(needle), `index.html has no ${needle} — it ${why}`);
assert.ok(/env\(safe-area-inset-top/.test(css), 'viewport-fit=cover but nothing pads the top — content sits under the status bar');
const bottomNav = /\.bottom-nav\s*\{[^}]*\}/g;
assert.ok([...css.matchAll(bottomNav)].some((m) => /env\(safe-area-inset-bottom/.test(m[0])),
  'the bottom tab bar does not pad env(safe-area-inset-bottom) — it sits under the home indicator');

/* ---- 3. the phone breakpoint ---------------------------------------------- */
/* Under 560px: the rail is a bottom bar of five panels plus More; the ticker
   is one line; the controls a phone does not need are gone. */
const phone = (/@media\(max-width:560px\)\{([\s\S]*?)\n\}/.exec(css) || [])[1] || '';
assert.ok(phone.length > 0, 'no @media(max-width:560px) block — the phone gets the desktop chrome');
assert.ok(/\.gwchip-dl\{[^}]*white-space:nowrap/.test(phone) || /\.gwchip\{[^}]*white-space:nowrap/.test(css),
  'the ticker is not forced onto one line on a phone');
assert.ok(/#export-btn\{display:none\}/.test(phone) || /\.tbm-export\{display:none\}/.test(phone),
  'CSV export is still offered on a phone — a control a phone does not need');
assert.ok(/#tbm-search kbd\{display:none\}/.test(phone), 'the ⌘K hint is still shown on a phone, which has no ⌘');
assert.ok(/function phoneNav\(\)/.test(code) && /phoneNav\(\)\?DESTINATIONS_SIMPLE:destinations\(\)/.test(code),
  'the bottom bar does not fall back to the five simple-mode panels plus More on a phone');

/* ---- 4. touch targets and the layout viewport ---------------------------- */
const coarseBlocks = [...css.matchAll(/@media\(pointer:coarse\)\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
assert.ok(coarseBlocks.length, 'no coarse-pointer block — controls stay at mouse size on a phone');
const coarse = coarseBlocks.join('\n');
assert.ok(/input,select,textarea\{[^}]*font-size:16px/.test(coarse) || /(input|select|textarea)[^{]*\{[^}]*font-size:16px/.test(coarse),
  'form controls are not raised to 16px under a coarse pointer, so iOS zooms the page when one takes focus');
assert.ok(/select[^{]*\{[^}]*max-width:100%/.test(coarse),
  'controls are raised to 16px without capping select width — a select sizes to its longest option and Safari shrinks the page to fit');
for (const sel of ['.btn', '.area-tab', '.lensbtn', '.seg-b', '.bn-item', '.nav-area-btn', '.more-it', '.tchip', '.tbm-row', '.acct-btn', '.theme-toggle', '.hamburger', '.ltf-browse', '.mode-opt', '.acct-link']) {
  const hit = coarseBlocks.some((b) => new RegExp('(^|[,{\\s])' + sel.replace('.', '\\.') + '(\\s*,|[^{]*\\{[^}]*min-height:44px)').test(b))
    || new RegExp(sel.replace('.', '\\.') + '\\{[^}]*min-height:44px').test(css);
  assert.ok(hit, `${sel} has no 44px minimum under a coarse pointer`);
}

console.log('check-mobile OK: share sheet routed, safe areas padded, phone breakpoint present, 16px controls capped, 44px targets on every control');
