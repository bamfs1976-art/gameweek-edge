/*
 * Browser checks for the parts of the shell that only a browser can see.
 *
 * Run: node dev/test-ui.mjs        (needs Chromium; NOT wired into npm test)
 *
 * Why this file exists.
 *
 * The keyboard layer moved to tinykeys with a binding map that read
 * correctly and behaved wrongly. All eleven `g <key>` chords were
 * registered as separate sequences with a regex catch-all after them, so
 * that `g` would swallow a key it did not recognise. Registration order was
 * right, dev/test-core.mjs asserted it, and every test passed.
 *
 * In a browser, pressing `g` `f` opened Fixtures and then the very next `j`
 * did nothing. tinykeys stops at the first complete match, so when the
 * chord fired it never finished evaluating the catch-all — whose pending
 * state was left mid-sequence and ate the next keystroke inside the
 * timeout. A binding map cannot show that. A key press can.
 *
 * The same argument covers the charts: uPlot draws to a canvas, so "did a
 * sparkline render" is not answerable by parsing a string of HTML.
 *
 * dev/smoke.mjs is the precedent for a browser test living outside
 * `npm test`; CI has no display, so these run on demand and before a
 * keyboard or charting change is called done.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WWW = join(ROOT, 'www');
const PORT = 8094;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

if (!existsSync(join(WWW, 'vendor.js'))) {
  console.error('www/vendor.js missing — run `npm run build:web` first');
  process.exit(1);
}

let passes = 0, failures = 0;
const ok = (cond, label) => { if (cond) passes++; else { failures++; console.error('  ✗ ' + label); } };
const section = (n) => console.log('• ' + n);

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = join(WWW, p);
  if (!existsSync(f) || !extname(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'text/plain' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  .catch(() => chromium.launch());
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);

section('the bundle loads and the shell renders');
{
  const r = await page.evaluate(() => ({
    uPlot: typeof window.uPlot, Fuse: typeof window.Fuse, tinykeys: typeof window.tinykeys,
    rendered: !!(document.getElementById('pages') || {}).innerHTML,
    nav: document.querySelectorAll('#sb-nav a, #sb-nav button').length
  }));
  ok(r.uPlot === 'function', 'window.uPlot is defined');
  ok(r.Fuse === 'function', 'window.Fuse is defined');
  ok(r.tinykeys === 'function', 'window.tinykeys is defined');
  ok(r.rendered, 'the page rendered rather than throwing partway through the script');
  ok(r.nav > 0, 'navigation built (' + r.nav + ' items)');
}

section('keyboard: chords, and the state they must not leak');
{
  const out = await page.evaluate(() => {
    const seen = [];
    const oPanel = window.openPanel, oNav = window.rowNav;
    window.openPanel = (id) => seen.push('panel:' + id);
    window.rowNav = (n) => seen.push('rowNav:' + n);
    const send = (k) => document.dispatchEvent(new KeyboardEvent('keydown',
      { key: k, code: 'Key' + k.toUpperCase(), bubbles: true, cancelable: true }));
    const take = () => { const s = seen.slice(); seen.length = 0; return s; };
    send('g'); send('f');            const chord = take();
    send('j');                       const afterChord = take();
    send('g'); send('j');            const swallowed = take();
    send('k');                       const plainK = take();
    send('g'); send('a', {});        const badChord = take();
    window.openPanel = oPanel; window.rowNav = oNav;
    return { chord, afterChord, swallowed, plainK, badChord };
  });
  ok(out.chord.join() === 'panel:fixtures', 'g → f opens Fixtures (' + out.chord + ')');
  /* The regression this file was written for. */
  ok(out.afterChord.join() === 'rowNav:1',
    'a plain j immediately after a fired chord still navigates (' + out.afterChord + ')');
  ok(out.swallowed.length === 0, 'g → j is swallowed, as the hand-written chord did');
  ok(out.plainK.join() === 'rowNav:-1', 'plain k walks the other way');
  ok(out.badChord.length === 0, 'g → an unmapped letter does nothing');
}

section('keyboard: suppression rules');
{
  const r = await page.evaluate(() => {
    const kbd = document.getElementById('kbd-overlay');
    /* Dispatch from the element that would really have focus, and let the
       event bubble. Firing at `document` sets event.target to document no
       matter what is focused, which is precisely the field kbdIgnore reads
       — an earlier version of this test did that and "proved" the input
       rule was broken when it was the test that was. Reset between cases
       too: the overlay is a toggle, so a leftover open state reads as a
       pass for the next one. */
    const fire = (el, key, mods) => { kbd.hidden = true;
      el.dispatchEvent(new KeyboardEvent('keydown',
        { key, code: 'Slash', bubbles: true, ...(mods || {}) }));
      return !kbd.hidden; };
    const shiftQ = fire(document.body, '?', { shiftKey: true });
    const i = document.createElement('input'); document.body.appendChild(i); i.focus();
    const inInput = fire(i, '?', { shiftKey: true });
    i.remove();
    const withCtrl = fire(document.body, '?', { shiftKey: true, ctrlKey: true });
    kbd.hidden = true;
    return { shiftQ, inInput, withCtrl };
  });
  ok(r.shiftQ, '? opens the cheatsheet (real keyboards send key "?" with shiftKey)');
  ok(!r.inInput, 'and does nothing while a text field has focus');
  ok(!r.withCtrl, 'and nothing with a modifier held');
}

section('palette: opens on ⌘K and tolerates a typo');
{
  await page.evaluate(() => { document.body.focus && document.body.focus(); });
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(150);
  const open = await page.evaluate(() => !document.getElementById('cmdk').hidden);
  ok(open, '⌘K opens the palette');
  await page.keyboard.type('captian');
  await page.waitForTimeout(250);
  const hits = await page.evaluate(() =>
    [...document.querySelectorAll('#cmdk-list .cmdk-row b')].map((b) => b.textContent));
  ok(hits.length > 0, 'a misspelt query returns matches (' + JSON.stringify(hits.slice(0, 3)) + ')');
  ok(/captain/i.test(hits[0] || ''), 'and the captaincy panel is first');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  ok(await page.evaluate(() => document.getElementById('cmdk').hidden), 'Escape closes it');
}

section('charts: uPlot actually draws');
{
  const r = await page.evaluate(() => {
    const d = document.createElement('div');
    d.innerHTML = window.spark([1, 3, 2, 7, 9], { w: 60, h: 16 })
      + window.chartHost({ x: [1, 2, 3, 4],
        series: [{ label: 'Pts', color: 'var(--green-bright)', data: [2, 8, 4, 11], width: 2 }],
        opts: { height: 120 } }, '');
    document.getElementById('pages').appendChild(d);
    return new Promise((res) => setTimeout(() => res({
      sparkCanvas: d.querySelectorAll('.spark-host canvas').length,
      chartCanvas: d.querySelectorAll('.chart-host canvas').length,
      legend: !!d.querySelector('.chart-host .u-legend'),
      over: !!d.querySelector('.chart-host .u-over')
    }), 600));
  });
  ok(r.sparkCanvas === 1, 'a sparkline placeholder hydrates into a canvas');
  ok(r.chartCanvas === 1, 'and a chart placeholder does too');
  ok(r.legend, 'the full chart has a live legend');
  ok(r.over, 'and an overlay for the crosshair');

  const box = await page.evaluate(() => {
    const c = document.querySelector('.chart-host .u-over');
    const b = c.getBoundingClientRect();
    return { x: b.x + b.width * 0.6, y: b.y + b.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(200);
  const val = await page.evaluate(() => {
    const v = document.querySelector('.chart-host .u-legend .u-value');
    return v ? v.textContent.trim() : '';
  });
  ok(val !== '' && val !== '--', 'moving the pointer moves the crosshair and reads a value (' + val + ')');
}

section('no uncaught errors');
ok(pageErrors.length === 0, 'page threw nothing (' + pageErrors.slice(0, 3).join(' | ') + ')');

await browser.close();
server.close();
console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
