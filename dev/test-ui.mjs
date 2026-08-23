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
const PORT = 8094, API_PORT = 8095;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

if (!existsSync(join(WWW, 'vendor.js'))) {
  console.error('www/vendor.js missing — run `npm run build:web` first');
  process.exit(1);
}

let passes = 0, failures = 0;
const ok = (cond, label) => { if (cond) passes++; else { failures++; console.error('  ✗ ' + label); } };
const section = (n) => console.log('• ' + n);

/* ── two servers, on purpose ────────────────────────────────
   PORT serves static files only, exactly as this suite always did. Every
   assertion below the shell section was written against that world and stays
   in it: feeding the page data changes which charts render, and a harness
   that alters what it measures is not worth the tidiness. An early version of
   this change served the API to everyone and broke a crosshair assertion that
   had nothing to do with the work.

   API_PORT serves the same files PLUS a canned bootstrap and fixture list, for
   the panel checks at the end. Those need data by definition: a panel with no
   data renders its error state, and telling that apart from a working one is
   the entire point.

   The payloads are snapshots of dev/mock_fpl.py, committed so this needs no
   Python and no network. They keep the API's OWN shape — teams as an ARRAY,
   the way bootstrap-static really sends it — because the reshaping boot() does
   on the way in is exactly where the bug that prompted this lived. */
const staticHandler = (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = join(WWW, p);
  if (!existsSync(f) || !extname(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'text/plain' });
  res.end(readFileSync(f));
};
const API = {
  '/api/fpl/bootstrap-static': 'fpl-mock-bootstrap.json',
  '/api/fpl/fixtures': 'fpl-mock-fixtures.json'
};
/* The picks endpoint carries the manager id and gameweek in the path, so it
   is matched by shape rather than by string. Served to whichever id asks:
   this harness has exactly one squad and the point is the rendering, not the
   lookup. */
const PICKS_RE = /^\/api\/fpl\/entry\/\d+\/event\/\d+\/picks$/;
/* Two more routes the rival card needs. Neither existed here, which is why
   the card could not be exercised at all until now.

   The live payload is DERIVED from the picks fixture rather than written out
   beside it, so the two cannot drift into disagreement — and one starter is
   deliberately left out of it, because the interesting case is the player the
   feed has not mentioned yet. He must print as a dash and stay out of the
   total; a fixture where every row exists cannot tell a real zero from a
   missing one, which is the bug this card is most likely to grow. */
const ENTRY_RE = /^\/api\/fpl\/entry\/\d+$/;
const LIVE_RE = /^\/api\/fpl\/event\/\d+\/live$/;
const HISTORY_RE = /^\/api\/fpl\/entry\/\d+\/history$/;
const STANDINGS_RE = /^\/api\/fpl\/leagues-classic\/\d+\/standings$/;
/* `current` carries real gameweek rows because the detailed league view
   derives free transfers from them: transfers made per week, checked
   against the hit FPL charged. An empty season yields no count at all,
   which is correct behaviour but tests nothing. GW1 has transfers and no
   hit — squad building — and GW2 spends one of the allowance. */
const historyBody = () => JSON.stringify({
  current: [
    { event: 1, points: 55, total_points: 55, rank: 1, overall_rank: 791032,
      bank: 7, value: 1003, event_transfers: 0, event_transfers_cost: 0, points_on_bench: 5 },
    { event: 2, points: 48, total_points: 103, rank: 2, overall_rank: 640210,
      bank: 5, value: 1000, event_transfers: 1, event_transfers_cost: 0, points_on_bench: 2 },
  ],
  past: [], chips: [{ name: '3xc', event: 1, time: '2026-08-15T10:00:00Z' }]
});
/* Three managers, so a click can land on a row that is NOT the signed-in
   one — the interesting case is opening somebody else's team. */
const standingsBody = () => JSON.stringify({
  league: { id: 555, name: 'The Office League' },
  standings: { has_next: false, results: [
    { rank: 1, last_rank: 2, entry: 7654321, entry_name: 'Rival FC', player_name: 'Sam Rivers', event_total: 62, total: 120 },
    { rank: 2, last_rank: 1, entry: 1234567, entry_name: 'My Team', player_name: 'Me Myself', event_total: 55, total: 118 },
    { rank: 3, last_rank: 3, entry: 9998887, entry_name: 'Third Wheel', player_name: 'Pat Third', event_total: 40, total: 90 }
  ] }
});
const picksFixture = () => JSON.parse(readFileSync(join(ROOT, 'dev/fixtures/fpl-mock-picks.json'), 'utf8'));
const LIVE_MISSING = picksFixture().picks.find((p) => p.position === 3).element;
const liveBody = () => JSON.stringify({
  elements: picksFixture().picks
    .filter((p) => p.element !== LIVE_MISSING)
    .map((p) => ({ id: p.element, stats: { total_points: 2 } }))
});
const entryBody = (id) => JSON.stringify({
  id: Number(id), name: 'Rival FC', player_first_name: 'Sam', player_last_name: 'Rivers',
  summary_overall_points: 120
});
/* A third server, reproducing the state the app shipped broken into: a
   linked team whose picks the API refuses because the gameweek deadline has
   not passed. Real FPL answers 404 there, and the squad rows disappeared for
   the entire week before GW1 as a result — invisible to this suite, because
   the mock had GW1 finished and GW2 next so picks always existed. A harness
   that can only produce the working case cannot find the broken one. */
const NOPICKS_PORT = 8096;
const server = createServer(staticHandler);
const apiServer = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (ENTRY_RE.test(p)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(entryBody(p.split('/').pop()));
  }
  if (LIVE_RE.test(p)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(liveBody());
  }
  if (HISTORY_RE.test(p)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(historyBody());
  }
  if (STANDINGS_RE.test(p)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(standingsBody());
  }
  if (API[p] || PICKS_RE.test(p)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(readFileSync(join(ROOT, 'dev/fixtures', API[p] || 'fpl-mock-picks.json')));
  }
  return staticHandler(req, res);
});
const noPicksServer = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (PICKS_RE.test(p)) { res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end('{"detail":"Not found."}'); }
  /* Entry and live still answer here. Only picks are private before a
     deadline, and a harness where the whole manager disappears cannot tell
     "their XI is not public yet" from "this rival is broken" — which is
     precisely the distinction the row has to make. */
  if (ENTRY_RE.test(p)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(entryBody(p.split('/').pop()));
  }
  if (LIVE_RE.test(p)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(liveBody());
  }
  if (API[p]) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(readFileSync(join(ROOT, 'dev/fixtures', API[p])));
  }
  return staticHandler(req, res);
});
await new Promise((r) => server.listen(PORT, r));
await new Promise((r) => apiServer.listen(API_PORT, r));
await new Promise((r) => noPicksServer.listen(NOPICKS_PORT, r));

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

/* ── the two sticky bars must not land on the same pixel ────
   .tickbar and .topbar are siblings, both position:sticky, and both were
   pinned at top:0 — so once the page scrolled they occupied the same strip
   and the ticker (z-index 150) covered the topbar (z-index 100). The
   hamburger, the panel title, refresh, export and the account button all
   went behind it, on every panel, with no way to reach the navigation on a
   narrow screen. The source said what it wanted — "Slimmer topbar under the
   ticker" — and never gave it an offset to sit at.

   Reported from a phone. Nothing here could have caught it, because every
   assertion in this file ran at scroll position 0, where sticky elements sit
   in normal flow and the collision does not exist yet. So this one scrolls
   first, then asks the document what is actually on top.

   Not asserted, deliberately: the ticker's z-index. It mattered only while
   the two bars shared a strip — the ticker won at 150 and buried the topbar
   at 100. Now that they occupy different pixels their relative order changes
   nothing, and a mutation run dropping the ticker to 50 confirmed it: every
   check stayed green because there is nothing left for the z-index to
   decide. A check that cannot fail is not worth adding to make the count
   look better. */
section('the topbar survives scrolling, and stays clickable');
{
  /* A phone viewport, because that is where it was reported and because the
     hamburger only exists below 1024px — at desktop width it is display:none,
     so "is the hamburger reachable" is not even a question there. An earlier
     version asked it on the shared 1280px page and got a meaningless answer:
     elementFromPoint landed on the sidebar, through a zero-sized button. */
  const mp = await browser.newPage({ viewport: { width: 430, height: 900 } });
  await mp.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await mp.waitForTimeout(900);
  const r = await mp.evaluate(async () => {
    /* Ask the document which element scrolls rather than assuming. Two
       earlier versions of this check assumed wrongly — first the window,
       then body (whose overflow-y computes to auto but never overflows,
       because its height is auto) — and both "ran" without scrolling a
       pixel. A scroll test that does not scroll measures the harness. The
       assertion below that scrollTop actually moved is what makes the
       difference visible instead of silent. */
    const scroller = document.scrollingElement || document.documentElement;
    const spacer = document.createElement('div');
    spacer.style.height = '3000px';
    document.getElementById('pages').appendChild(spacer);
    scroller.scrollTop = 900;
    await new Promise((res) => setTimeout(res, 250));
    const rect = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
    const tick = rect('.tickbar'), top = rect('.topbar'), burger = rect('#hamburger');
    /* elementFromPoint answers the only question that matters: if the user
       taps the hamburger, what receives the tap? */
    const hit = burger
      ? document.elementFromPoint(burger.left + burger.width / 2, burger.top + burger.height / 2)
      : null;
    const out = {
      scrolled: scroller.scrollTop,
      tickTop: tick && Math.round(tick.top), tickBottom: tick && Math.round(tick.bottom),
      topTop: top && Math.round(top.top), topBottom: top && Math.round(top.bottom),
      burgerVisible: !!(burger && burger.top >= 0 && burger.height > 0),
      strip: (() => { const e = document.getElementById('link-ribbon');
        if (!e) return null;
        e.classList.remove('hidden');            /* only rendered when unlinked */
        const t = Math.round(e.getBoundingClientRect().top);
        e.classList.add('hidden');
        return t; })(),
      hitsBurger: !!(hit && hit.closest('#hamburger')),
      hitTag: hit ? (hit.id || hit.className || hit.tagName) : null
    };
    spacer.remove();
    scroller.scrollTop = 0;
    return out;
  });
  ok(r.scrolled > 0, 'the page actually scrolled (' + r.scrolled + 'px) — otherwise this proves nothing');
  /* Flush, not merely clear of it. `>=` also passes when the topbar pins too
     LOW — offset by the wrong variable, say — which leaves a gap with page
     content scrolling visibly through it between the two bars. A mutation
     run proved that: swapping --tickbar-h for --topbar-h changed nothing
     here. Equality is the actual requirement. */
  ok(r.topTop !== null && r.topTop === r.tickBottom,
    'the topbar pins flush under the ticker (ticker ends '
    + r.tickBottom + ', topbar starts ' + r.topTop + ')');
  /* The not-linked strip is the third sticky in the same column and has to
     clear BOTH bars. Nothing tested it, so its offset could silently go back
     to sitting under the ticker. */
  ok(r.strip === null || r.strip >= r.topBottom,
    'the not-linked strip clears both bars (topbar ends ' + r.topBottom
    + ', strip starts ' + r.strip + ')');
  ok(r.burgerVisible, 'the hamburger is still on screen after scrolling');
  ok(r.hitsBurger,
    'and a tap on it reaches the hamburger, not whatever is covering it (hit: ' + r.hitTag + ')');
  await mp.close();
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

/* ── panels must RENDER, not just fail politely ─────────────
   The app wraps each panel in a try/catch that prints "Could not load this
   view" and carries on. That is the right behaviour, and it is also why a
   broken panel looks like a working app from the outside: nothing crashes,
   nothing goes red, the page just quietly has a hole in it.

   The Fixture Difficulty grid shipped that way on 16 Aug 2026. A call site did
   `(b.teams||[]).forEach` where b.teams is an id-keyed OBJECT — boot() builds
   it as `b.teams.forEach(t=>teams[t.id]=t)` — so it threw on every rebuild.
   It passed 3,451 unit assertions, because the pure functions it called were
   all correct, and a green browser suite, because that suite served no data
   and so never ran the call site at all.

   Runs on its own page against the API server, so nothing above is affected. */
section('panels render with data behind them, rather than their error state');
{
  const dataPage = await browser.newPage();
  const dataErrors = [];
  dataPage.on('pageerror', (e) => dataErrors.push(e.message));
  await dataPage.goto(`http://localhost:${API_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await dataPage.waitForTimeout(1200);

  const grid = await dataPage.evaluate(async () => {
    try { openPanel('fixtures'); } catch (e) { return { err: e.message }; }
    await new Promise((r) => setTimeout(r, 2500));
    const host = document.querySelector('#pages') || document.body;
    return { txt: (host.innerText || '').slice(0, 3000),
      rows: document.querySelectorAll('table tr').length,
      lenses: [...document.querySelectorAll('#fdr-view .seg-b')].map((b) => b.textContent.trim()) };
  });
  ok(!grid.err, 'opening the fixtures panel did not throw (' + (grid.err || '') + ')');
  ok(!/Could not load this view/i.test(grid.txt || ''),
    'the grid rendered rather than falling back to "Could not load this view"');
  ok(/FIXTURE DIFFICULTY/i.test(grid.txt || ''), 'it drew its own heading');
  ok(grid.rows > 5, 'it drew a table with rows (' + grid.rows + ')');

  /* Every lens in FDR_LENS has a button — asserted in test-core against the
     source, and here against the DOM the user actually gets. */
  ok((grid.lenses || []).length === 5,
    'all five lenses are offered (' + (grid.lenses || []).join(', ') + ')');

  /* No team is linked on this page, so there is no squad to put in the rows.
     The toggle must not appear: a control that switches to an empty table is
     worse than no control. Asserted HERE rather than in the squad section
     below, because that page always has a squad and so could never see this
     go wrong — which is exactly what it did, silently, until a mutation run
     asked whether the check could fail at all. */
  const noSquad = await dataPage.evaluate(() => ({
    toggle: !!document.getElementById('fdr-rows'),
    priceCols: document.querySelectorAll('#fdr-tbody td.tm-px').length,
    explains: /save a team in/i.test(document.body.innerText)
  }));
  ok(!noSquad.toggle, 'with no team linked, the row-source toggle is not offered');
  ok(noSquad.priceCols === 0, 'and no player rows are drawn');
  ok(!noSquad.explains,
    'and with no team linked it does not nag about a draft — nothing has been asked for yet');

  /* The lens that prompted all this must produce numbers, not a column of
     dashes — which is what an absent b.teams lookup would have left behind
     even if it had failed quietly instead of throwing. */
  const strength = await dataPage.evaluate(async () => {
    /* Scope to the grid's OWN table. The panel draws fifteen tables and a
       first pass counted cells across all of them, which found 102 dashes
       belonging to other panels and reported the lens as empty when it was
       working. #fdr-tot-h is the grid's total header, so its table is the
       grid. */
    const grid = () => {
      const h = document.getElementById('fdr-tot-h');
      return h ? h.closest('table') : null;
    };
    const texts = () => grid() ? [...grid().querySelectorAll('td')].map((t) => t.textContent.trim()) : [];
    const before = texts();
    const btn = [...document.querySelectorAll('#fdr-view .seg-b')]
      .find((b) => /strength/i.test(b.textContent));
    if (!btn) return { found: false };
    btn.click();
    await new Promise((r) => setTimeout(r, 900));
    const after = texts();
    /* A cell reads "1.00FUL (a)" — the lens number then the opponent — so the
       ratio is matched anywhere in the cell, not anchored to the whole of it. */
    return { found: true,
      active: [...document.querySelectorAll('#fdr-view .seg-b')]
        .filter((b) => b.classList.contains('on')).map((b) => b.textContent.trim()).join(','),
      ratios: after.filter((c) => /\d\.\d\d/.test(c)).length,
      dashes: after.filter((c) => c === '—').length,
      changed: before.join('|') !== after.join('|') };
  });
  ok(strength.found, 'the Strength lens button is in the rendered grid');
  ok(strength.active === 'Strength', 'clicking it actually selects it (' + strength.active + ')');
  ok(strength.changed, 'and the grid redrew rather than keeping the previous lens');
  ok(strength.found && strength.ratios > 0,
    'the cells carry ratios (' + (strength.ratios || 0) + ' with a ratio, '
    + (strength.dashes || 0) + ' dashes)');
  ok(dataErrors.length === 0,
    'the data-backed page threw nothing (' + dataErrors.slice(0, 2).join(' | ') + ')');
  await dataPage.close();
}

/* ── the squad ticker, and the double gameweek it exists to show ──
   dev/test-fixture-ticker.mjs proves the combination and ordering rules as
   arithmetic. Neither of them is worth anything if the rows never reach the
   screen, and "reaches the screen" is not a question a string of HTML can
   answer — the grid is built by a hydrate function behind a try/catch that
   prints "Could not load this view" and carries on, which is exactly how the
   FDR grid shipped broken on 16 Aug 2026 with a green unit suite behind it.

   The mock carries a real double: fixture 81 puts ARS v AVL into GW4 on top
   of the fixtures both clubs already have that week, and both clubs are in
   the mock squad. Before it was added there was no double anywhere in this
   harness, so a "doubles render" check had nothing it could possibly find —
   it would have passed by measuring itself. */
section('the price panel shows FPL\u2019s own figure, and says so');
{
  /* The panel makes a CLAIM about where its number comes from. The unit
     suite proves priceSource() decides correctly; this proves the copy and
     the tables that follow from that decision actually render — the new
     offTbl/projCell path is not reachable from any other test, and "the
     structure was tested, the rendering was not" is how the last three
     visible bugs in this app got shipped. */
  const pp = await browser.newPage();
  const pErr = [];
  pp.on('pageerror', (e) => pErr.push(e.message));
  await pp.goto(`http://localhost:${API_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await pp.waitForTimeout(1200);

  const price = await pp.evaluate(async () => {
    try { openPanel('price'); } catch (e) { return { err: e.message }; }
    await new Promise((r) => setTimeout(r, 2500));
    const host = document.querySelector('#pages') || document.body;
    const txt = host.innerText || '';
    return { txt, html: host.innerHTML.length };
  });
  ok(!price.err, 'the price panel rendered (' + (price.err || '') + ')');
  ok(price.html > 2000, 'and produced a real panel rather than an empty host');

  /* The mock carries FPL figures, so the official path must be the one on
     screen — and the estimate wording must NOT be, because both claims
     cannot be true at once. */
  /* Case-INSENSITIVE on purpose. innerText returns the RENDERED text, and
     .card-title carries text-transform:uppercase, so the title arrives as
     "FPL'S OWN FIGURE". A case-sensitive match here failed while the panel
     was perfectly correct — the assertion was testing my memory of the CSS,
     not the page. */
  ok(/FPL\u2019s own (published )?figure/i.test(price.txt),
     'it names FPL as the source of the number');
  ok(!/our estimates/i.test(price.txt),
     'and does NOT simultaneously call it our estimate');

  /* The projections column is the new capability; a single number hides it. */
  ok(/32\.5/.test(price.txt), 'today\u2019s projected figure is on screen');
  ok(/72\.5/.test(price.txt), 'and the +2 day projection with it');

  /* Ranked by magnitude: the biggest faller leads its table. */
  ok(/-23\.3|−23\.3/.test(price.txt), 'the biggest faller appears');
  ok(/\+19\.9/.test(price.txt), 'the biggest riser appears, signed');

  /* The locked player has the LARGEST figure in the fixture (40.0) and must
     still be absent — he cannot move price, so listing him first would be
     the most prominent possible wrong answer. */
  ok(!/40\.0/.test(price.txt), 'the locked player is excluded despite having the biggest figure');
  ok(/locked/i.test(price.txt), 'and the exclusion is disclosed rather than silent');

  ok(pErr.length === 0, 'the price panel threw nothing (' + pErr.slice(0, 2).join(' | ') + ')');
  await pp.close();
}

section('my squad rows, and a double gameweek that is visible as one');
{
  const sp = await browser.newPage();
  const spErrors = [];
  sp.on('pageerror', (e) => spErrors.push(e.message));
  /* The row source is offered only to a linked team, so link one before the
     page script runs. */
  /* A linked team AND a saved draft, both present. Which one wins is the
     whole question once the deadline passes: the live squad must, and the
     draft must go back to being a draft. Nothing tested this until a
     mutation run flipped `if(!squadPicks)` to `if(true)` and every check
     stayed green — because no page in this suite had both at once. A
     harness that cannot produce the conflict cannot adjudicate it. The
     fifteen below share no player with dev/fixtures/fpl-mock-picks.json,
     so the two sources are told apart by name, not by count. */
  await sp.addInitScript(() => { try {
    localStorage.setItem('ge-mid', '1234567');
    localStorage.setItem('ge-draft-v1', JSON.stringify({
      ids: [67, 73, 68, 74, 80, 86, 92, 70, 76, 82, 88, 94, 84, 90, 96], t: 1 }));
  } catch (_) {} });
  await sp.goto(`http://localhost:${API_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await sp.waitForTimeout(1200);

  const gridTable = () => {
    const h = document.getElementById('fdr-tot-h');
    return h ? h.closest('table') : null;
  };

  const clubs = await sp.evaluate(async (fnSrc) => {
    window.__grid = eval(fnSrc);
    try { openPanel('fixtures'); } catch (e) { return { err: e.message }; }
    await new Promise((r) => setTimeout(r, 2500));
    const t = window.__grid();
    return {
      hasToggle: !!document.getElementById('fdr-rows'),
      labels: [...document.querySelectorAll('#fdr-rows .seg-b')].map((b) => b.textContent.trim()),
      on: [...document.querySelectorAll('#fdr-rows .seg-b.on')].map((b) => b.textContent.trim()).join(','),
      firstHead: t ? (t.querySelector('th') || {}).textContent : null,
      teamFilter: !!document.getElementById('fdr-teams'),
      /* #fdr-tbody, not 'tbody tr': the header row is emitted as a bare
         <tr> and the browser wraps it in an implicit tbody of its own, so a
         table-wide selector counts it as a row. */
      rows: document.querySelectorAll('#fdr-tbody tr').length,
      /* The double, in the CLUB rows — the fix is not squad-only. */
      dgwCells: t ? [...t.querySelectorAll('td.fdr-dgw')].length : 0,
      dgwText: t ? [...t.querySelectorAll('td.fdr-dgw .fdr-opp')].map((s) => s.textContent.trim()) : []
    };
  }, gridTable.toString());

  ok(!clubs.err, 'the fixtures panel opened with a linked team (' + (clubs.err || '') + ')');
  ok(clubs.hasToggle, 'a linked team is offered the row-source toggle');
  ok(clubs.labels.join(',') === 'Clubs,My squad', 'it offers both sources (' + clubs.labels.join(',') + ')');
  ok(clubs.on === 'Clubs', 'and it opens on Clubs, never on the squad (' + clubs.on + ')');
  ok(clubs.rows >= 20, 'the club grid still draws every club (' + clubs.rows + ' rows)');
  ok(/team/i.test(clubs.firstHead || ''), 'its first column is still Team (' + clubs.firstHead + ')');
  ok(clubs.teamFilter, 'and the club filter is present in club mode');

  /* The regression the whole exercise turns on. */
  ok(clubs.dgwCells === 2, 'the GW4 double renders as a double for BOTH clubs in it ('
    + clubs.dgwCells + ' marked cells)');
  ok(clubs.dgwText.length === 2 && clubs.dgwText.every((s) => s.includes('+')),
    'and each marked cell names two opponents (' + JSON.stringify(clubs.dgwText) + ')');
  ok(clubs.dgwText.every((s) => /AVL|ARS/.test(s)),
    'including the rearranged tie that was previously overwritten');
  /* Kickoff order, not API order. ARS play BRE on the Saturday and AVL on the
     Wednesday; a cell reading "AVL + BRE" is describing a week that does not
     happen. The label is the only place this is checkable, because the
     combined numbers are order-free. */
  ok(clubs.dgwText.includes('BRE + AVL'),
    'the double is listed in kickoff order (' + JSON.stringify(clubs.dgwText) + ')');
  ok(clubs.dgwText.includes('NEW + ARS (a)'),
    'and from the other club\'s side, with its own venue on the away leg');

  const squad = await sp.evaluate(async (fnSrc) => {
    const grid = eval(fnSrc);
    const btn = [...document.querySelectorAll('#fdr-rows .seg-b')].find((b) => /squad/i.test(b.textContent));
    if (!btn) return { found: false };
    btn.click();
    await new Promise((r) => setTimeout(r, 1400));
    const t = grid();
    const rows = [...document.querySelectorAll('#fdr-tbody tr')];
    const playerRows = rows.filter((r) => r.querySelector('td.tm-px'));
    return {
      found: true,
      on: [...document.querySelectorAll('#fdr-rows .seg-b.on')].map((b) => b.textContent.trim()).join(','),
      heads: t ? [...t.querySelectorAll('th')].slice(0, 2).map((h) => h.textContent.trim()) : [],
      playerRows: playerRows.length,
      prices: playerRows.map((r) => r.querySelector('td.tm-px').textContent.trim()),
      names: playerRows.map((r) => r.querySelector('td.tm-nm').textContent.trim()),
      benchDivider: rows.filter((r) => /^bench$/i.test(r.textContent.trim())).length,
      benchIndex: rows.findIndex((r) => /^bench$/i.test(r.textContent.trim())),
      captains: playerRows.filter((r) => /\bC\b/.test(r.querySelector('td.tm-nm').textContent)).length,
      teamFilter: !!document.getElementById('fdr-teams'),
      dgwCells: t ? [...t.querySelectorAll('td.fdr-dgw')].length : 0,
      mult: t ? [...t.querySelectorAll('.fdr-mult')].map((s) => s.textContent.trim())[0] : null
    };
  }, gridTable.toString());

  ok(squad.found, 'the My squad button is in the rendered grid');
  ok(squad.on === 'My squad', 'clicking it selects it (' + squad.on + ')');
  ok(squad.playerRows === 15, 'it draws one row per pick, all fifteen (' + squad.playerRows + ')');
  ok(JSON.stringify(squad.heads) === '["Price","Player"]',
    'the header becomes Price then Player (' + JSON.stringify(squad.heads) + ')');
  ok((squad.prices || []).every((p) => /^£\d+\.\d$/.test(p)),
    'every row carries a real price (' + JSON.stringify((squad.prices || []).slice(0, 3)) + ')');
  ok(new Set(squad.names || []).size === 15, 'fifteen distinct players, so no row is drawn twice');
  ok(squad.benchDivider === 1, 'one bench divider, not none and not one per player');
  ok(squad.benchIndex === 11,
    'and it sits after the eleventh player, where the bench actually starts (index ' + squad.benchIndex + ')');
  ok(squad.captains === 1, 'the captain is marked, exactly once (' + squad.captains + ')');
  /* The live squad wins over the saved draft, and says so. */
  ok(squad.on === 'My squad',
    'with picks available the toggle reads My squad, not My draft (' + squad.on + ')');
  ok(!(squad.names || []).some((n) => /IPS|LEE|LIV|MCI|MUN/.test(n)),
    'and the rows are the LIVE squad — no player from the saved draft appears ('
    + JSON.stringify((squad.names || []).slice(0, 3)) + ')');
  ok(squad.benchDivider === 1,
    'the bench divider is back, because a submitted squad does have an XI');
  ok(!squad.teamFilter, 'the club filter is withdrawn — it would delete players from your own squad');

  /* Six of the fifteen play in the double: three ARS and three AVL. This is
     the assertion the panel exists for. */
  ok(squad.dgwCells === 6,
    'every squad member in the double gets a marked cell (' + squad.dgwCells + ' of an expected 6)');
  ok(squad.mult === '×2', 'and the badge reads ×2 (' + squad.mult + ')');

  /* The FPL lens, on the double. Found by looking at a screenshot: the lens
     sanity-checks its rating against 1-5, which is right for one raw rating
     from the API and wrong for a cell holding two of them summed. AVL's 2 + 4
     fell outside the range and printed as the neutral fallback 3 — the wrong
     number, in the one cell the ×2 badge was pointing at. Asserted against
     the mock's real arithmetic: ARS 3 + 2 = 5, AVL 2 + 4 = 6. */
  const fpl = await sp.evaluate(async (fnSrc) => {
    const grid = eval(fnSrc);
    [...document.querySelectorAll('#fdr-view .seg-b')].find((b) => /FPL/i.test(b.textContent)).click();
    await new Promise((r) => setTimeout(r, 1000));
    const t = grid();
    const cells = [...t.querySelectorAll('td.fdr-dgw')];
    const byOpp = {};
    for (const c of cells) byOpp[c.querySelector('.fdr-opp').textContent.trim()] =
      c.querySelector('.fdr-val').textContent.trim();
    /* The run total for one ARS row, checked against its own cells rather
       than a number copied off a screenshot — the window is adjustable, so a
       hardcoded total would be asserting the default window, not the
       arithmetic. The two come from different code paths (the lens's `cell`
       and its `total`), so agreeing is a real check and not a tautology. */
    const arsRow = [...document.querySelectorAll('#fdr-tbody tr')]
      .find((r) => /ARSGkp/.test(r.textContent));
    const vals = arsRow ? [...arsRow.querySelectorAll('td.cell:not(.fdr-tot) .fdr-val')]
      .map((s) => parseInt(s.textContent, 10)) : [];
    return { byOpp,
      total: arsRow ? parseInt(arsRow.querySelector('td.fdr-tot .fdr-val').textContent, 10) : null,
      cellSum: vals.reduce((a, c) => a + c, 0),
      cells: vals.length,
      doubles: arsRow ? arsRow.querySelectorAll('td.fdr-dgw').length : 0 };
  }, gridTable.toString());

  ok(fpl.byOpp['BRE + AVL'] === '5×2',
    'the FPL lens sums both halves of ARS\'s double (' + fpl.byOpp['BRE + AVL'] + ')');
  ok(fpl.byOpp['NEW + ARS (a)'] === '6×2',
    'and AVL\'s, whose 2 + 4 lands outside the single-fixture 1-5 range ('
    + fpl.byOpp['NEW + ARS (a)'] + ')');
  ok(fpl.doubles === 1, 'the row being totalled actually contains a double (' + fpl.doubles + ')');
  ok(fpl.cells > 1 && fpl.total === fpl.cellSum,
    'the run total equals the sum of its own cells, doubles included (total '
    + fpl.total + ' vs ' + fpl.cellSum + ' over ' + fpl.cells + ' cells)');

  /* Back again: a toggle that only goes one way is half a control. */
  const back = await sp.evaluate(async (fnSrc) => {
    const grid = eval(fnSrc);
    [...document.querySelectorAll('#fdr-rows .seg-b')].find((b) => /clubs/i.test(b.textContent)).click();
    await new Promise((r) => setTimeout(r, 1400));
    const t = grid();
    return { head: t ? (t.querySelector('th') || {}).textContent : null,
      rows: document.querySelectorAll('#fdr-tbody tr').length,
      priceCols: t ? t.querySelectorAll('td.tm-px').length : 0,
      teamFilter: !!document.getElementById('fdr-teams') };
  }, gridTable.toString());
  ok(/team/i.test(back.head || ''), 'switching back restores the Team column (' + back.head + ')');
  ok(back.rows >= 20, 'and every club (' + back.rows + ')');
  ok(back.priceCols === 0, 'with no price column left behind');
  ok(back.teamFilter, 'and the club filter comes back with them');

  ok(spErrors.length === 0, 'the squad ticker threw nothing (' + spErrors.slice(0, 2).join(' | ') + ')');
  await sp.close();
}

/* ── before the first deadline, when there are no picks to have ──
   The state the squad rows shipped broken into, and the one the owner was
   actually in: a linked team, a gameweek whose deadline has not passed, and
   an API that answers 404 for picks until it does. The toggle vanished, and
   so did the pre-existing "My teams" chip that reads the same payload.

   The fallback is the draft the user saved in this app. It is their own
   squad, so showing it is not fabrication — but a draft has no XI and no
   captain, so the assertions below are mostly about what must NOT appear. */
section('a saved draft stands in when the deadline has not passed');
{
  /* #fdr-tot-h is the grid's own total header, so its table is the grid —
     the panel draws fifteen tables and an unscoped selector finds the wrong
     one. Same helper as the section above, redeclared because that one is
     block-scoped to it. */
  const gridTable = () => {
    const h = document.getElementById('fdr-tot-h');
    return h ? h.closest('table') : null;
  };
  const dp = await browser.newPage();
  const dErrors = [];
  dp.on('pageerror', (e) => dErrors.push(e.message));
  await dp.addInitScript(() => {
    try {
      localStorage.setItem('ge-mid', '1234567');
      /* Fifteen ids in the mock's own element range, in no useful order —
         2 GKP, 5 DEF, 5 MID, 3 FWD, saved the way the draft builder saves. */
      localStorage.setItem('ge-draft-v1', JSON.stringify({
        ids: [16, 1, 24, 3, 28, 9, 2, 22, 7, 17, 36, 8, 14, 30, 23], t: 1 }));
    } catch (_) {}
  });
  await dp.goto(`http://localhost:${NOPICKS_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await dp.waitForTimeout(1300);

  const draft = await dp.evaluate(async (fnSrc) => {
    const grid = eval(fnSrc);
    try { openPanel('fixtures'); } catch (e) { return { err: e.message }; }
    await new Promise((r) => setTimeout(r, 2500));
    const labels = [...document.querySelectorAll('#fdr-rows .seg-b')].map((b) => b.textContent.trim());
    const btn = [...document.querySelectorAll('#fdr-rows .seg-b')].find((b) => /draft|squad/i.test(b.textContent));
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 1400));
    const t = grid();
    const rows = [...document.querySelectorAll('#fdr-tbody tr')];
    const playerRows = rows.filter((r) => r.querySelector('td.tm-px'));
    return {
      labels,
      playerRows: playerRows.length,
      benchDividers: rows.filter((r) => /^bench$/i.test(r.textContent.trim())).length,
      dimmed: playerRows.filter((r) => (r.getAttribute('style') || '').includes('opacity')).length,
      captains: playerRows.filter((r) => /\bC\b/.test(r.querySelector('td.tm-nm').textContent)).length,
      heads: t ? [...t.querySelectorAll('th')].slice(0, 2).map((h) => h.textContent.trim()) : [],
      explains: /draft saved on this device/i.test(document.body.innerText),
      says404: /could not load this view/i.test(document.body.innerText)
    };
  }, gridTable.toString());

  ok(!draft.err, 'the panel opened with picks 404ing (' + (draft.err || '') + ')');
  ok(!draft.says404, 'a refused picks call does not take the panel down');
  ok(draft.labels.join(',') === 'Clubs,My draft',
    'the toggle appears, and calls it a DRAFT rather than a squad (' + draft.labels.join(',') + ')');
  ok(draft.playerRows === 15, 'all fifteen drafted players get a row (' + draft.playerRows + ')');
  ok(JSON.stringify(draft.heads) === '["Price","Player"]', 'with price and player columns');
  /* The three things a draft must not claim. */
  ok(draft.benchDividers === 0, 'no bench divider — a draft has not picked an XI');
  ok(draft.dimmed === 0, 'and no row is dimmed as benched');
  ok(draft.captains === 0, 'no captain armband — the draft never named one');
  ok(draft.explains, 'and the panel says in words that this is the saved draft, and why');
  ok(dErrors.length === 0, 'nothing threw (' + dErrors.slice(0, 2).join(' | ') + ')');
  await dp.close();

  /* The state the owner was actually in: team linked, deadline not passed,
     and no draft saved in THIS app either — their drafts lived on the FPL
     site. The rows genuinely cannot be filled, so the control stays hidden.
     But hiding it silently is what made a new feature look broken rather
     than empty, so the panel has to say what would fill it. */
  const np = await browser.newPage();
  const npErrors = [];
  np.on('pageerror', (e) => npErrors.push(e.message));
  await np.addInitScript(() => { try { localStorage.setItem('ge-mid', '1234567'); } catch (_) {} });
  await np.goto(`http://localhost:${NOPICKS_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await np.waitForTimeout(1300);
  const bare = await np.evaluate(async () => {
    try { openPanel('fixtures'); } catch (e) { return { err: e.message }; }
    await new Promise((r) => setTimeout(r, 2500));
    const txt = document.body.innerText;
    return { err: null,
      toggle: !!document.getElementById('fdr-rows'),
      rows: document.querySelectorAll('#fdr-tbody tr').length,
      explains: /save a team in/i.test(txt),
      namesTheDraft: /Squad Planner/i.test(txt),
      saysDeadline: /deadline passes/i.test(txt),
      down: /could not load this view/i.test(txt) };
  });
  ok(!bare.err && !bare.down, 'the grid still renders with neither picks nor a draft');
  ok(bare.rows >= 20, 'and still shows every club (' + bare.rows + ')');
  ok(!bare.toggle, 'the toggle stays hidden — it would switch to an empty table');
  ok(bare.explains, 'but the panel now says what would fill those rows');
  ok(bare.saysDeadline, 'naming the deadline as the reason there is no squad yet');
  ok(bare.namesTheDraft, 'and naming the panel that can fill them today');
  ok(npErrors.length === 0, 'nothing threw (' + npErrors.slice(0, 2).join(' | ') + ')');
  await np.close();
}

/* Feedback: the one flow where the app could lie to a user. The vm test in
   dev/test-feedback.mjs stubs the DOM, so it proves the control flow but not
   that the button is reachable or the dialog opens. This does that part in a
   real browser, and then makes the send FAIL to check the app says so. */
section('feedback: the button opens, and a failed send is never called success');
{
  const fp = await browser.newPage();
  const fErrors = [];
  fp.on('pageerror', (e) => fErrors.push(e.message));
  await fp.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await fp.waitForTimeout(900);

  const opened = await fp.evaluate(() => {
    const b = document.getElementById('feedback-btn');
    if (!b) return { err: 'no #feedback-btn' };
    b.click();
    const m = document.getElementById('fb-modal');
    return { shown: !!m && m.classList.contains('show'),
      label: b.getAttribute('aria-label') || '',
      kinds: [...document.querySelectorAll('#fb-kinds .fb-kind')].length };
  });
  ok(!opened.err, 'the feedback button exists (' + (opened.err || '') + ')');
  ok(opened.shown === true, 'clicking it opens the dialog');
  ok(opened.kinds >= 3, 'the dialog offers feedback kinds (' + opened.kinds + ')');
  ok(/feedback/i.test(opened.label), 'the button is labelled for screen readers');

  /* Force the send to fail the way an unconfigured server would. */
  const failed = await fp.evaluate(async () => {
    window.fetch = async () => ({ ok: false, status: 503,
      json: async () => ({ error: 'Feedback storage is not configured on the server, so this was not saved.' }) });
    let toasted = null; window.toast = (m) => { toasted = m; };
    document.getElementById('fb-text').value = 'the fixture grid is empty for me';
    await submitFeedback();
    return {
      toasted,
      err: (document.getElementById('fb-err').textContent || ''),
      kept: document.getElementById('fb-text').value,
      stillOpen: document.getElementById('fb-modal').classList.contains('show')
    };
  });
  ok(failed.toasted === null, 'a failed send shows NO success toast');
  ok(/not sent/i.test(failed.err), 'it says plainly that it was not sent');
  ok(failed.kept === 'the fixture grid is empty for me', "the user's typed message is still in the box");
  ok(failed.stillOpen === true, 'and the dialog stays open so they can retry or copy');

  /* Escape must dismiss an aria-modal dialog. */
  const esc = await fp.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return document.getElementById('fb-modal').classList.contains('show');
  });
  ok(esc === false, 'Escape closes the dialog');
  ok(fErrors.length === 0, 'the feedback flow threw nothing (' + fErrors.slice(0, 2).join(' | ') + ')');
  await fp.close();
}

/* The feedback inbox renders text a STRANGER typed, inside the owner's own
   session. That is the highest-severity path in the app: a payload in a
   message would execute with the owner signed in. dev/test-feedback.mjs
   checks the escaping by reading the source, which proves esc() is written
   but not that it works. This fires a real payload through a real browser. */
section('feedback inbox: a hostile message renders as text, not as markup');
{
  const ip = await browser.newPage();
  const ipErrors = [];
  ip.on('pageerror', (e) => ipErrors.push(e.message));
  await ip.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await ip.waitForTimeout(900);

  const res = await ip.evaluate(async () => {
    window.__XSS__ = false;
    window.GE_OWNER = true;
    window.aiToken = () => 'fake-owner-token';
    const PAYLOAD = '<img src=x onerror="window.__XSS__=true"><script>window.__XSS__=true<\/script>';
    const canned = { windowDays: 90, truncated: false,
      totals: { all: 1, last7: 1, awaitingReply: 0, unusableEmail: 0, distinctPanels: 1 },
      byKind: [{ kind: 'bug', n: 1 }], byPanel: [{ panel: '<b>evil</b>', n: 1 }], byDay: [],
      items: [{ message: PAYLOAD, kind: 'bug', email: null, emailUnusable: false,
        panel: '<b>evil</b>', app: '<i>ua</i>', ts: new Date().toISOString() }] };
    window.fetch = async (u) => String(u).includes('/api/feedback-inbox')
      ? { ok: true, status: 200, json: async () => canned }
      : { ok: false, status: 404, json: async () => ({}) };
    try { buildNav(); openPanel('feedback'); } catch (e) { return { err: e.message }; }
    await new Promise((r) => setTimeout(r, 800));
    const el = document.querySelector('.fbi-msg');
    return {
      xss: window.__XSS__,
      injectedImg: !!document.querySelector('.fbi-msg img'),
      text: el ? el.textContent : null,
      literal: el ? el.textContent.includes('<img src=x') : false
    };
  });
  ok(!res.err, 'the feedback panel opened (' + (res.err || '') + ')');
  ok(res.xss === false, 'the payload did NOT execute');
  ok(res.injectedImg === false, 'no element was injected from the message');
  ok(res.literal === true, 'the markup is shown to the owner as literal text');
  ok(ipErrors.length === 0, 'the inbox threw nothing (' + ipErrors.slice(0, 2).join(' | ') + ')');
  await ip.close();
}

section('a rival opens, on a pitch, marked against my own XI');
{
  /* The rival is a DIFFERENT id from the linked manager, but this harness
     serves one squad to whoever asks — so every player comes back shared.
     That is fine for the rendering, and the differential path is covered by
     the unit suite where two squads can actually differ. What only a browser
     can show is that the card opens at all, that eleven and four land in the
     right places, and that the missing live row prints as a dash. */
  const rp = await browser.newPage();
  const rErrors = [];
  rp.on('pageerror', (e) => rErrors.push(e.message));
  /* ge-tier MUST be seeded. Rivals is a Pro panel — "Rival intelligence" is
     one of the three listed PRO_BENEFITS — so a free tier gets the real panel
     rendered blurred and `inert` behind the unlock strip. Without this line
     the harness was testing the LOCKED panel and calling it working, because
     element.click() fires through `inert` and `pointer-events:none` exactly
     as if neither existed. The locked state is asserted separately below. */
  await rp.addInitScript(() => { try {
    localStorage.setItem('ge-mid', '1234567');
    localStorage.setItem('ge-tier', 'pro');
    localStorage.setItem('ge-rivals', JSON.stringify(['7654321']));
  } catch (_) {} });
  await rp.goto(`http://localhost:${API_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await rp.waitForTimeout(1200);

  /* A REAL click, at real coordinates, through Playwright's actionability
     checks — not element.click(). The synthetic version fires the handler
     regardless of whether anything is on top of the button, whether an
     ancestor is inert, or whether pointer-events is off, so it can pass on a
     button no human can press. That is exactly the gap that let "clicking a
     rival does nothing" ship green. */
  /* FIRST, the state the owner actually reported from: signed out. Rivals is
     a paid panel and Pro rides on the account — renderPage's own comment
     says "no session means no Pro on this device" — so the real panel is
     rendered blurred and inert behind the unlock strip, and NOTHING in it is
     clickable. That is correct, and it is pinned here so nobody "fixes"
     a future report of this by deleting the inert attribute. */
  await rp.evaluate(() => { try { openPanel('rivals'); } catch (_) {} });
  await rp.waitForTimeout(1800);
  const locked = await rp.evaluate(() => {
    const b = document.querySelector('[data-rival]');
    if (!b) return { err: 'no rival row rendered even locked' };
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    let n = b, inertAncestor = null;
    while (n) { if (n.inert) { inertAncestor = n.className; break; } n = n.parentElement; }
    return { inertAncestor, topEl: top ? top.className : null,
      strip: !!document.querySelector('.pro-lockstrip') };
  });
  ok(!locked.err, 'the locked panel still renders the real rows (' + (locked.err || '') + ')');
  ok(/pro-blur/.test(locked.inertAncestor || ''), 'signed out, the rivals panel is inert');
  ok(locked.strip === true, 'and shows the unlock strip that explains why');
  ok(/pro-lockstrip/.test(locked.topEl || ''),
    'so a click lands on the unlock strip, not the rival — this is the reported behaviour');

  /* NOW unlock it. The tier is set after load rather than seeded, because the
     auth check strips a stored 'pro' when there is no Supabase session and
     this harness has none. */
  await rp.evaluate(() => {
    try { localStorage.setItem('ge-tier', 'pro'); } catch (_) {}
    try { reflectTier(); } catch (_) {}
    try { renderPage('rivals'); } catch (_) {}
  });
  await rp.waitForTimeout(1800);

  /* What is actually under the pointer at the button's centre? If it is not
     the button or one of its own children, something is intercepting and the
     name of that something is the bug. */
  const hitTest = await rp.evaluate(() => {
    const b = document.querySelector('[data-rival]');
    if (!b) return { err: 'no rival row rendered' };
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const inertAncestor = (() => { let n = b; while (n) { if (n.inert) return n.className || n.tagName; n = n.parentElement; } return null; })();
    const cs = getComputedStyle(b);
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      pointerEvents: cs.pointerEvents, visibility: cs.visibility, display: cs.display,
      topEl: top ? (top.tagName + '.' + (top.className || '')) : null,
      topIsButtonOrChild: !!(top && (top === b || b.contains(top))),
      inertAncestor
    };
  });
  ok(!hitTest.err, 'a rival row rendered (' + (hitTest.err || '') + ')');
  ok(hitTest.w > 0 && hitTest.h > 0, `the opener has a real box (${hitTest.w}x${hitTest.h})`);
  ok(hitTest.pointerEvents !== 'none', 'the opener is not pointer-events:none');
  ok(hitTest.inertAncestor === null, 'no inert ancestor swallows the click (' + hitTest.inertAncestor + ')');
  ok(hitTest.topIsButtonOrChild === true,
    'the element under the pointer IS the opener, not something covering it (' + hitTest.topEl + ')');

  await rp.locator('[data-rival]').first().click({ timeout: 5000 })
    .catch((e) => { ok(false, 'a real click on the rival reached it (' + e.message.split('\n')[0] + ')'); });
  await rp.waitForTimeout(2200);

  const res = await rp.evaluate(async () => {
    const m = document.getElementById('rival-modal');
    const body = document.getElementById('rival-body');
    const cells = [...body.querySelectorAll('.qd-pitch .pp')];
    const pts = cells.map((c) => (c.querySelector('.pp-pt') || {}).textContent);
    return {
      shown: !!m && m.classList.contains('show'),
      name: (body.querySelector('#rival-title') || {}).textContent || '',
      xi: cells.length,
      bench: body.querySelectorAll('.rv-bench .pp').length,
      caps: body.querySelectorAll('.rv-cap').length,
      ringed: body.querySelectorAll('.qd-pitch .pp.rv-shared, .qd-pitch .pp.rv-diff').length,
      dashes: pts.filter((t) => t === '—').length,
      zeroes: pts.filter((t) => t === '0').length,
      head: (body.textContent || '').slice(0, 400)
    };
  });

  ok(!res.err, 'the rivals panel opened and a rival was clickable (' + (res.err || '') + ')');
  ok(res.shown === true, 'the rival modal is showing');
  ok(/Rival FC/.test(res.name), 'it names the rival (' + res.name + ')');
  ok(res.xi === 11, 'eleven players on the pitch, got ' + res.xi);
  ok(res.bench === 4, 'four on the bench, got ' + res.bench);
  ok(res.ringed === 11, 'every starter is marked shared or differential, got ' + res.ringed);
  ok(res.caps >= 1, 'the captain is badged, got ' + res.caps);
  /* The one that matters. One starter is absent from the live feed and must
     read as unknown, not as a blank gameweek. */
  ok(res.dashes === 1, 'the player missing from the live feed shows a dash, got ' + res.dashes);
  ok(res.zeroes === 0, 'and nothing invents a zero, got ' + res.zeroes);
  ok(/of their XI in yours/.test(res.head), 'the header states how much of their XI is in mine');
  /* The count used to clip to "0 different…" in a modal heading, because
     .dl-row .dl-sub is nowrap+ellipsis for dense list rows. */
  ok(/differential/.test(res.head) && !/different\u2026|different\.\.\./.test(res.head),
    'and prints the word "differentials" in full rather than clipping it');
  ok(rErrors.length === 0, 'the rival card threw nothing (' + rErrors.slice(0, 2).join(' | ') + ')');

  /* Before the deadline FPL 404s picks. That is not an error and must not be
     dressed as one — the harness on 8096 reproduces exactly that. */
  const np2 = await browser.newPage();
  await np2.addInitScript(() => { try {
    localStorage.setItem('ge-mid', '1234567');
    localStorage.setItem('ge-tier', 'pro');
    localStorage.setItem('ge-rivals', JSON.stringify(['7654321']));
  } catch (_) {} });
  await np2.goto(`http://localhost:${NOPICKS_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await np2.waitForTimeout(1200);
  const nr = await np2.evaluate(async () => {
    try { openPanel('rivals'); } catch (e) { return { err: e.message }; }
    await new Promise((r) => setTimeout(r, 1600));
    const opener = document.querySelector('[data-rival]');
    if (!opener) return { err: 'no rival row' };
    opener.click();
    await new Promise((r) => setTimeout(r, 1800));
    return { text: (document.getElementById('rival-body').textContent || '') };
  });
  ok(!nr.err, 'the pre-deadline page rendered a rival row (' + (nr.err || '') + ')');
  ok(/hidden until the deadline/i.test(nr.text),
    'a 404 on picks reads as "not yet", not as a failure (' + (nr.text || '').slice(0, 120) + ')');
  ok(!/Couldn.t load/i.test(nr.text), 'and is not reported as a load error');
  await np2.close();
  await rp.close();
}

section('a mini-league standing opens that manager\u2019s team');
{
  /* THE ONE THAT WAS ACTUALLY ASKED FOR. Mini-Leagues is tier:'free' and
     Rival Scout is tier:'paid' — two different panels. The card was built in
     the paid one, so a Pro user looking at their mini-league table clicked a
     rival and nothing happened, because there was nothing there to click.
     No tier is seeded here on purpose: this table is free, and if it ever
     stops being reachable without Pro this check goes red. */
  const lp = await browser.newPage();
  const lErrors = [];
  lp.on('pageerror', (e) => lErrors.push(e.message));
  await lp.addInitScript(() => { try { localStorage.setItem('ge-mid', '1234567'); } catch (_) {} });
  await lp.goto(`http://localhost:${API_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await lp.waitForTimeout(1200);

  const opened = await lp.evaluate(async () => {
    try {
      LEAGUE_SEL = 555; LEAGUE_TYPE = 'classic'; LEAGUE_PAGE = 1;
      renderPage('leagues');
    } catch (e) { return { err: e.message }; }
    await new Promise((r) => setTimeout(r, 1800));
    const rows = [...document.querySelectorAll('[data-rival]')];
    return { rows: rows.length, ids: rows.map((b) => b.dataset.rival) };
  });
  ok(!opened.err, 'the league standings rendered (' + (opened.err || '') + ')');
  ok(opened.rows === 3, 'every standing is an opener, got ' + opened.rows);
  ok((opened.ids || []).includes('7654321'), 'and carries the entry id, not the rank');

  /* ── The two lines must actually be two lines ──────────────────────
     Reported by a user, not by this file: "The spacing of the text is
     awful", with the team name and the manager name run together —
     "LammenadeMax Sargeant · GW 20". .dl-grow was a flex column and that
     column was what stacked them; wrapping both spans in a display:block
     button made them inline siblings again.

     Nothing here could see it. Every existing check reads textContent,
     which concatenates the two spans identically whether they render on
     one line or two, so the suite was green through two deploys and two
     rounds of screenshots. Geometry is the only thing that can tell the
     difference: compare the boxes, not the strings. */
  const lay = await lp.evaluate(() => {
    const btn = document.querySelector('[data-rival]');
    const nm = btn.querySelector('.dl-nm');
    const sub = btn.querySelector('.dl-sub');
    const b = btn.getBoundingClientRect();
    const n = nm.getBoundingClientRect();
    const s = sub.getBoundingClientRect();
    return {
      nmBottom: Math.round(n.bottom), subTop: Math.round(s.top),
      nmH: Math.round(n.height), btnW: Math.round(b.width),
      nmW: Math.round(n.width), subW: Math.round(s.width),
      rowW: Math.round(btn.closest('.dl-row').getBoundingClientRect().width),
      nmDisp: getComputedStyle(nm).display, subDisp: getComputedStyle(sub).display
    };
  });
  /* Allow a pixel of rounding slack, but not a shared line: if they sat on
     one line the sub's top would be at the name's top, a full line-height
     above its bottom. */
  ok(lay.subTop >= lay.nmBottom - 1,
     'the manager line sits below the team name, not beside it (name bottom ' +
     lay.nmBottom + ', sub top ' + lay.subTop + ')');
  ok(lay.nmDisp === 'block' && lay.subDisp === 'block',
     'both lines are block boxes so they can ellipse (' + lay.nmDisp + '/' + lay.subDisp + ')');
  /* The button wrapping them must not defeat the row's clipping either —
     a long name has to ellipse inside the row, not push it wide. */
  ok(lay.nmW <= lay.btnW && lay.subW <= lay.btnW,
     'neither line overflows the button (' + lay.nmW + '/' + lay.subW + ' in ' + lay.btnW + ')');
  ok(lay.btnW <= lay.rowW,
     'and the button does not force the row wider (' + lay.btnW + ' in ' + lay.rowW + ')');

  /* A real click, on a manager who is NOT the signed-in one. */
  const target = lp.locator('[data-rival="7654321"]').first();
  const hit = await lp.evaluate(() => {
    const b = document.querySelector('[data-rival="7654321"]');
    /* Bring the row into view before asking what is on top of it. The
       onboarding tour scrolls the hero card to centre on a fresh page,
       and this test drives renderPage directly rather than showPanel, so
       it never gets showPanel's scrollTo(0) — the league table therefore
       renders at the tour's offset and the first row can sit behind the
       sticky topbar. A real click scrolls first (Playwright's does, and
       so does a thumb), so measuring un-scrolled tested a position no
       user clicks from. What this check is actually for — an inert
       ancestor, pointer-events:none, or an overlay covering the row —
       is unaffected: all three still fail it with the row in view. */
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    let n = b, inertAncestor = null;
    while (n) { if (n.inert) { inertAncestor = n.className; break; } n = n.parentElement; }
    return { inertAncestor, reachable: !!(top && (top === b || b.contains(top))),
      topEl: top ? top.className : null, pe: getComputedStyle(b).pointerEvents };
  });
  ok(hit.inertAncestor === null, 'the free league table is not inert (' + hit.inertAncestor + ')');
  ok(hit.pe !== 'none', 'and not pointer-events:none');
  ok(hit.reachable === true, 'the row is what the pointer hits (' + hit.topEl + ')');

  await target.click({ timeout: 5000 })
    .catch((e) => { ok(false, 'a real click reached the standing (' + e.message.split('\n')[0] + ')'); });
  await lp.waitForTimeout(2200);

  const card = await lp.evaluate(() => {
    const body = document.getElementById('rival-body');
    return {
      shown: (document.getElementById('rival-modal') || {}).className || '',
      name: (body.querySelector('#rival-title') || {}).textContent || '',
      xi: body.querySelectorAll('.qd-pitch .pp').length,
      bench: body.querySelectorAll('.rv-bench .pp').length,
      total: ((body.querySelector('.dl-col') || {}).textContent || '').trim(),
      text: (body.textContent || '').slice(0, 500)
    };
  });
  /* The total's PROVENANCE has to match the number. This harness's gameweek
     is finished, so the official figure is correct here even though it is 0 —
     the live-versus-finished rule itself is unit-tested in dev/test-rivals.mjs,
     where both states can actually be produced. What a browser adds is that
     the label and the figure come from the same decision rather than drifting
     apart in the markup. */
  ok(/Gameweek points from FPL|Live total/.test(card.text), 'the total says where it came from');
  ok(!(/Gameweek points from FPL/.test(card.text) && /Live total/.test(card.text)),
     'and says it once, not both ways at the same time');

  ok(/show/.test(card.shown), 'the card opens from the league table');
  ok(/Rival FC/.test(card.name), 'and names the manager clicked (' + card.name + ')');
  ok(card.xi === 11, 'eleven on the pitch, got ' + card.xi);
  ok(card.bench === 4, 'four on the bench, got ' + card.bench);
  ok(/Triple Captain/.test(card.text), 'and the chip ledger reaches it from history');
  ok(lErrors.length === 0, 'the league table threw nothing (' + lErrors.slice(0, 2).join(' | ') + ')');
  await lp.close();
}

section('gameweek awards compute themselves');
{
  /* Asked for: "can these just automatically display instead of having
     to press the compute button". The button existed because the awards
     cost eleven API calls — which is a reason to cache the result, not a
     reason to make the reader ask twice for what the card promises. */
  const ap = await browser.newPage();
  const aErrors = [];
  ap.on('pageerror', (e) => aErrors.push(e.message));
  await ap.addInitScript(() => { try { localStorage.setItem('ge-mid', '1234567'); } catch (_) {} });
  await ap.goto(`http://localhost:${API_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await ap.waitForTimeout(1200);

  const aw = await ap.evaluate(async () => {
    try {
      LEAGUE_SEL = 555; LEAGUE_TYPE = 'classic'; LEAGUE_PAGE = 1;
      LEAGUE_VIEW = 'compact'; LEAGUE_SORT = 'rank'; LEAGUE_DIR = 0;
      renderPage('leagues');
    } catch (e) { return { err: e.message }; }
    /* No click anywhere in here — that is the whole assertion. */
    await new Promise((r) => setTimeout(r, 2600));
    const box = document.getElementById('league-awards');
    const card = box && box.closest('.card');
    return {
      found: !!box,
      rows: box ? box.querySelectorAll('.dl-row').length : 0,
      text: box ? box.innerText : '',
      /* The button must be gone, not merely bypassed. */
      buttons: card ? [...card.querySelectorAll('button')].map((b) => b.textContent.trim()) : ['NO CARD'],
      skeleton: box ? box.querySelectorAll('.sk').length : -1,
    };
  });

  ok(aw.found === true, 'the awards box is on the page (' + (aw.err || '') + ')');
  ok(aw.buttons.length === 0,
     'and there is no Compute button left to press (' + aw.buttons.join(',') + ')');
  ok(aw.skeleton === 0, 'the skeleton has been replaced by real content');
  ok(aw.rows >= 3, 'the awards rendered on their own, got ' + aw.rows + ' rows');
  ok(/Top score/i.test(aw.text), 'top score is there');
  ok(/Best captain/i.test(aw.text), 'best captain is there');
  ok(/Bench tragedy/i.test(aw.text), 'bench tragedy is there');
  ok(/top \d+ manager/i.test(aw.text),
     'and the card says how many managers it measured (' + aw.text.replace(/\n/g, ' ').slice(-60) + ')');

  /* Re-rendering the panel — which a sort or a view toggle does — must
     not refetch. The result is cached per league and gameweek, so the
     second render paints from cache and the request count does not move. */
  const cacheWorks = await ap.evaluate(async () => {
    const before = window.__apiCalls || 0;
    renderPage('leagues');
    await new Promise((r) => setTimeout(r, 1800));
    const box = document.getElementById('league-awards');
    return { rows: box ? box.querySelectorAll('.dl-row').length : 0, before };
  });
  ok(cacheWorks.rows >= 3, 'and they are still there after a re-render, got ' + cacheWorks.rows);

  ok(aErrors.length === 0, 'the awards threw nothing (' + aErrors.slice(0, 2).join(' | ') + ')');
  await ap.close();
}

section('the title race renders, and the odds add up on screen');
{
  /* Asked for after a screenshot of a rival app: six managers, a title
     race panel, and win odds that summed to 68%. Exactly one manager
     wins a league, so the odds are a probability distribution — a table
     that does not add up is a table that cannot be right. The engine
     guarantees the sum by simulating jointly; this checks the sum
     SURVIVES rendering, which is a separate claim and the one the user
     can actually see. */
  const rp = await browser.newPage();
  const rErrors = [];
  rp.on('pageerror', (e) => rErrors.push(e.message));
  await rp.addInitScript(() => { try { localStorage.setItem('ge-mid', '1234567'); } catch (_) {} });
  await rp.goto(`http://localhost:${API_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await rp.waitForTimeout(1200);

  const race = await rp.evaluate(async () => {
    try {
      LEAGUE_SEL = 555; LEAGUE_TYPE = 'classic'; LEAGUE_PAGE = 1;
      renderPage('leagues');
    } catch (e) { return { err: e.message }; }
    await new Promise((r) => setTimeout(r, 2000));
    /* .card-title is text-transform:uppercase, so innerText comes back
       shouting; match case-insensitively on the rendered string rather
       than on what the source writes. */
    const card = [...document.querySelectorAll('.card')]
      .find((c) => /title race/i.test((c.querySelector('.card-title') || {}).innerText || ''));
    if (!card) return { found: false };
    const pcts = [...card.querySelectorAll('.dl-row .dl-col')]
      .map((e) => parseFloat(e.textContent.replace('%', '')))
      .filter((n) => Number.isFinite(n));
    const bar = card.querySelector('.tr-bar');
    const fill = card.querySelector('.tr-bar i');
    return {
      found: true,
      text: card.innerText,
      pcts,
      rows: card.querySelectorAll('.dl-row').length,
      mine: card.querySelectorAll('.dl-row.league-me').length,
      strip: !!card.querySelector('.tr-me'),
      barBg: bar ? getComputedStyle(bar).backgroundColor : null,
      fillW: fill ? fill.getBoundingClientRect().width : 0,
      barW: bar ? bar.getBoundingClientRect().width : 0,
      stack: (() => {
        const row = card.querySelector('.dl-row');
        const nm = row.querySelector('.dl-nm').getBoundingClientRect();
        const sub = row.querySelector('.dl-sub').getBoundingClientRect();
        const br = row.querySelector('.tr-bar').getBoundingClientRect();
        return { nmBottom: nm.bottom, subTop: sub.top, subBottom: sub.bottom, barTop: br.top };
      })(),
    };
  });

  ok(race.found === true, 'the title race card renders for a classic league');
  ok(race.rows === 3, 'one row per manager, got ' + race.rows);
  ok(race.mine === 1, 'the signed-in manager’s row is highlighted');
  ok(race.strip === true, 'and their own odds get the headline strip');

  /* THE POINT OF THE WHOLE FEATURE. Whole-percent rounding across three
     rows can move the visible total by at most a point or so; anything
     further out means the numbers on screen are not a distribution. */
  const total = (race.pcts || []).reduce((a, b) => a + b, 0);
  ok((race.pcts || []).length === 3, 'every manager shows a percentage, got ' + (race.pcts || []).length);
  ok(Math.abs(total - 100) <= 2, 'the odds on screen add up to 100% (got ' + total + ')');

  /* The leader of a three-way race that is 30 points clear should be the
     favourite, and the table is sorted best-first. */
  ok(race.pcts[0] >= race.pcts[2], 'the rows are ordered by odds, best first');

  /* REGRESSION on a CSS variable that does not exist. The bar track was
     written as var(--line); this codebase calls it --border-2. An
     undefined custom property is not an error — it falls back to
     transparent, so the bar silently vanishes in both themes and every
     text-based assertion still passes. Only a computed style can see it. */
  ok(race.barBg && !/rgba\(0, 0, 0, 0\)|transparent/.test(race.barBg),
     'the likelihood bar has a visible track (' + race.barBg + ')');
  ok(race.barW > 0 && race.fillW > 0, 'and the bar actually occupies space');
  ok(race.fillW <= race.barW + 1, 'with the fill inside its track');

  /* Same trap the Mini-Leagues rows fell into, and the reason the bar
     was zero-width first time round: .dl-row .dl-grow lays its children
     out in a ROW, so three spans dropped straight in end up beside each
     other rather than stacked, and a flex item with no content gets no
     width at all. textContent cannot see any of that — only the boxes
     can. */
  ok(race.stack.subTop >= race.stack.nmBottom - 1,
     'the manager line sits below the team name, not beside it (' +
     Math.round(race.stack.nmBottom) + ' / ' + Math.round(race.stack.subTop) + ')');
  ok(race.stack.barTop >= race.stack.subBottom - 1,
     'and the bar sits below both, not alongside them');

  /* Never present a simulation as a forecast. */
  ok(/not a forecast/i.test(race.text), 'the card says these are odds, not a forecast');
  ok(/add up to 100%/i.test(race.text), 'and states the property the reader can check');

  ok(rErrors.length === 0, 'the title race threw nothing (' + rErrors.slice(0, 2).join(' | ') + ')');
  await rp.close();
}

section('your matchday: which of my players are on, and when');
{
  /* Asked for: a way to see when squad players are due to play, so the
     matches worth watching are obvious before kickoff. The fixture list
     already had the times and the squad already had the players; nothing
     joined them. */
  const mp = await browser.newPage();
  const mErrors = [];
  mp.on('pageerror', (e) => mErrors.push(e.message));
  await mp.addInitScript(() => { try { localStorage.setItem('ge-mid', '1234567'); } catch (_) {} });
  await mp.goto(`http://localhost:${API_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await mp.waitForTimeout(1200);

  const md = await mp.evaluate(async () => {
    /* The panel is registered as 'results'; 'matchday' is the label. */
    try { openPanel('results'); } catch (e) { return { err: e.message }; }
    await new Promise((r) => setTimeout(r, 2200));
    const card = [...document.querySelectorAll('.card')]
      .find((c) => /your matchday/i.test((c.querySelector('.card-title') || {}).innerText || ''));
    if (!card) return { found: false, panels: document.body.innerText.slice(0, 200) };
    const rows = [...card.querySelectorAll('.dl-row')];
    const head = document.querySelector('.mc-head');
    const when = card.querySelector('.md-when');
    const nm = rows[0] && rows[0].querySelector('.dl-nm');
    const sub = rows[0] && rows[0].querySelector('.dl-sub');
    return {
      found: true,
      text: card.innerText,
      rows: rows.length,
      markers: document.querySelectorAll('.mc-mine').length,
      /* .mc-head is a five-column grid; the squad marker was folded in
         beside the state badge precisely so it stays five. */
      headKids: head ? head.children.length : null,
      badgeHasBoth: !!(head && head.querySelector('.mc-badge .mc-mine')),
      whenW: when ? when.getBoundingClientRect().width : 0,
      stack: (nm && sub) ? { nmBottom: nm.getBoundingClientRect().bottom,
                             subTop: sub.getBoundingClientRect().top } : null,
      counts: [...document.querySelectorAll('.mc-mine')].map((e) => e.textContent),
    };
  });

  ok(md.found === true, 'the matchday card renders (' + (md.panels || '') + ')');
  /* Six of GW1's ten fixtures involve this squad — derived from the mock,
     not guessed: the other four are between clubs nobody here owns. */
  ok(md.rows === 6, 'one row per fixture involving my squad, got ' + md.rows);

  /* The card and the fixture list below it are two renderings of the same
     join, so they have to agree. If one drifts, this catches it. */
  ok(md.markers > 0 && md.markers === md.rows,
     'every fixture flagged in the list is a row in the card (' + md.markers + ' vs ' + md.rows + ')');

  /* REGRESSION on the grid. Adding a sixth child to .mc-head would
     re-flow every fixture row in the panel — teams and score would slide
     out of their columns — and no text assertion would notice. */
  ok(md.headKids === 5, '.mc-head is still a five-column grid, got ' + md.headKids);
  ok(md.badgeHasBoth === true, 'and the squad marker shares the badge cell rather than adding one');

  ok(md.whenW > 0, 'the kickoff column has width');
  ok(md.stack && md.stack.subTop >= md.stack.nmBottom - 1,
     'the players line sits below the fixture, not beside it');

  /* The point of the card: it says how many are left, and marks the
     captain, so the matches that matter most are obvious. */
  ok(/still to play|playing now|finished/i.test(md.text),
     'the card summarises where the gameweek stands');
  ok(/\(C\)/.test(md.text), 'and marks the captain');
  ok(md.counts.every((c) => /^●\d/.test(c)),
     'each flagged fixture shows how many of mine are in it (' + md.counts.join(' ') + ')');

  ok(mErrors.length === 0, 'the matchday panel threw nothing (' + mErrors.slice(0, 2).join(' | ') + ')');
  await mp.close();

  /* ── The layout, at the width people actually read it ──────────────
     Reported: "Text layout and format is awful", with a fixture reading
     "IFO v LEE" — the N clipped off the FRONT — and the line under it
     cut at both ends.

     Cause, found by measuring rather than reading: .dl-grow resolves to
     flex-direction:column (base rule) with align-items:center (the
     .dl-row override). Neither rule was written expecting the other, and
     together they centre and shrink-wrap a block child instead of
     letting it fill. The cell measured 312px inside a 510px parent,
     99px in on each side — so overflow clipped at both ends, which is
     why the missing letter was at the START of the word.

     Every check in this file was green through that, because they all
     read text content and the text content was complete: the DOM had
     "NFO v LEE" and the screen showed "IFO v LEE". Only geometry can
     tell those apart, and only at a width where the text is tight —
     which is why this runs at phone size. */
  const np = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const nErrors = [];
  np.on('pageerror', (e) => nErrors.push(e.message));
  await np.addInitScript(() => { try { localStorage.setItem('ge-mid', '1234567'); } catch (_) {} });
  await np.goto(`http://localhost:${API_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await np.waitForTimeout(1200);

  const lay = await np.evaluate(async () => {
    try { openPanel('results'); } catch (e) { return { err: e.message }; }
    await new Promise((r) => setTimeout(r, 2200));
    const card = [...document.querySelectorAll('.card')]
      .find((c) => /your matchday/i.test((c.querySelector('.card-title') || {}).innerText || ''));
    if (!card) return { found: false };
    const rows = [...card.querySelectorAll('.dl-row')];
    const L = (e) => Math.round(e.getBoundingClientRect().left);
    const R = (e) => Math.round(e.getBoundingClientRect().right);
    return {
      found: true,
      /* Every fixture name must start at the same x. Under the centring
         bug each row started somewhere different, which is what made the
         card look ragged even where nothing was clipped. */
      nmLefts: [...new Set(rows.map((r) => L(r.querySelector('.dl-nm'))))],
      subLefts: [...new Set(rows.map((r) => L(r.querySelector('.dl-sub'))))],
      /* The cell must fill the space it is given, not sit centred in it. */
      fills: rows.every((r) => {
        const cell = r.querySelector('.tr-cell'), grow = r.querySelector('.dl-grow');
        return Math.abs(L(cell) - L(grow)) <= 1 && Math.abs(R(cell) - R(grow)) <= 1;
      }),
      /* Nothing overflows its box: a wrapped line has scrollWidth equal
         to clientWidth, a truncated one does not. */
      clipped: rows.filter((r) => {
        const w = r.querySelector('.md-who');
        return w && w.scrollWidth > w.clientWidth + 1;
      }).length,
      nmClipped: rows.filter((r) => {
        const n = r.querySelector('.dl-nm');
        return n && n.scrollWidth > n.clientWidth + 1;
      }).length,
      /* Nor does the row push the card sideways. */
      overflowX: card.scrollWidth > card.clientWidth + 1,
      counts: rows.map((r) => (r.querySelector('.md-count') || {}).textContent),
      multiline: rows.some((r) => r.querySelector('.md-who').getBoundingClientRect().height > 20),
      text: card.innerText,
    };
  });

  ok(lay.found === true, 'the matchday card renders at phone width');
  ok(lay.nmLefts.length === 1,
     'every fixture name starts at the same x (' + lay.nmLefts.join(',') + ')');
  ok(lay.subLefts.length === 1,
     'and so does every players line (' + lay.subLefts.join(',') + ')');
  ok(lay.fills === true, 'the text cell fills its column rather than sitting centred in it');
  ok(lay.nmClipped === 0, 'no fixture name is clipped, got ' + lay.nmClipped);
  ok(lay.clipped === 0, 'no players line is clipped — long lists wrap, got ' + lay.clipped);
  ok(lay.overflowX === false, 'and the card does not scroll sideways');

  /* THE SCORELINE PROBLEM. A bare "2" to the right of "ARS v COV" reads
     as a result. The dot marks it as a squad count. */
  ok((lay.counts || []).every((c) => /^●\d+$/.test(c)),
     'the squad count is marked, not a bare number (' + (lay.counts || []).join(' ') + ')');
  ok(!/bench only/i.test(lay.text), 'the redundant "bench only" label is gone');

  ok(nErrors.length === 0, 'the phone-width layout threw nothing (' + nErrors.slice(0, 2).join(' | ') + ')');
  await np.close();
}

section('mini-league detailed view: every squad, with effective ownership');
{
  /* Asked for after a screenshot of LiveFPL's detailed table: each
     manager expanding to their squad, with each player's ownership
     across the league beside his live score. */
  const dp = await browser.newPage();
  const dErrors = [];
  dp.on('pageerror', (e) => dErrors.push(e.message));
  await dp.addInitScript(() => { try { localStorage.setItem('ge-mid', '1234567'); } catch (_) {} });
  await dp.goto(`http://localhost:${API_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await dp.waitForTimeout(1200);

  const view = await dp.evaluate(async () => {
    try {
      LEAGUE_SEL = 555; LEAGUE_TYPE = 'classic'; LEAGUE_PAGE = 1;
      LEAGUE_VIEW = 'detailed';
      renderPage('leagues');
    } catch (e) { return { err: e.message }; }
    await new Promise((r) => setTimeout(r, 3000));
    const card = [...document.querySelectorAll('.card')]
      .find((c) => /detailed view/i.test((c.querySelector('.card-title') || {}).innerText || ''));
    if (!card) return { found: false, body: document.body.innerText.slice(0, 250) };
    const mgrs = [...card.querySelectorAll('.lg-mgr')];
    const first = mgrs[0];
    const sq = first && first.querySelector('.lg-sq');
    const beforeOpen = sq ? getComputedStyle(sq).display : null;
    /* Expand the first manager and see the squad appear. */
    first.querySelector('.lg-head').click();
    await new Promise((r) => setTimeout(r, 150));
    const afterOpen = sq ? getComputedStyle(sq).display : null;
    const tiles = [...first.querySelectorAll('.lg-p')];
    const eos = [...first.querySelectorAll('.lg-eo')].map((e) => e.textContent);
    return {
      found: true, text: card.innerText,
      managers: mgrs.length,
      beforeOpen, afterOpen,
      tiles: tiles.length,
      eos,
      /* Compact rows must be gone — the same ranks twice is noise. */
      compactRows: document.querySelectorAll('#league-standings .dl-row').length,
      legend: card.querySelectorAll('.lg-legend span').length,
      states: [...new Set(tiles.map((t) => [...t.classList].find((c) => /^lg-(done|live|toPlay|blank)$/.test(c))))],
      swing: !![...document.querySelectorAll('.card')]
        .find((c) => /who separates this league/i.test((c.querySelector('.card-title') || {}).innerText || '')),
      progW: (() => { const p = first.querySelector('.lg-prog i');
        return p ? p.getBoundingClientRect().width : 0; })(),
      pills: [...first.querySelectorAll('.lg-pill')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
      pillsVisible: (() => { const p = first.querySelector('.lg-pills');
        return p ? p.getBoundingClientRect().height > 0 : false; })(),
      chipCodes: [...first.querySelectorAll('.lg-chip')].map((e) => e.textContent),
    };
  });

  ok(view.found === true, 'the detailed view renders (' + (view.body || '') + ')');
  ok(view.managers === 3, 'one block per manager, got ' + view.managers);

  /* Expanding is the whole interaction. */
  ok(view.beforeOpen === 'none', 'squads start collapsed');
  ok(view.afterOpen !== 'none', 'and open when the manager row is clicked');

  /* Fifteen tiles: eleven plus a four-man bench. */
  ok(view.tiles === 15, 'the squad is fifteen players, got ' + view.tiles);

  /* THE NUMBER THE SCREENSHOT IS ABOUT. Every player carries effective
     ownership across the league, and it has to be a real percentage
     rather than a blank or NaN. */
  ok(view.eos.length === 15, 'every player carries an ownership figure, got ' + view.eos.length);
  ok(view.eos.every((s) => /^\d+(\.\d+)?%$/.test(s)),
     'and each is a percentage (' + view.eos.slice(0, 3).join(' ') + ')');
  /* All three mock managers share this squad, so everyone starting is at
     100% and the bench at 0% — which is exactly the case a headcount
     would get wrong by calling the bench 100% owned. */
  ok(view.eos.some((s) => s === '0.0%'),
     'a player nobody starts reads 0%, not 100% (' + view.eos.join(' ') + ')');

  ok(view.compactRows === 0, 'the compact table is replaced, not duplicated');
  ok(view.legend === 4, 'the four player states are spelled out, got ' + view.legend);
  ok(view.states.filter(Boolean).length >= 1, 'and tiles carry a state class');
  ok(view.progW > 0, 'the played-so-far bar has width');
  ok(view.swing === true, 'the swing card names who actually separates the league');

  /* Never let a scoped percentage read as a league-wide one. */
  ok(/effective ownership/i.test(view.text), 'the card says what the percentages are');
  ok(/captain counts twice/i.test(view.text), 'and how they are counted');

  /* ── The markers ──────────────────────────────────────────────────
     Free transfers, team value, money in the bank, overall rank,
     progress and the chip ledger — the row a manager scans. They must
     be readable WITHOUT expanding, which is why the height is checked
     rather than just the text: a pill row inside the collapsed squad
     block would pass every string assertion and be invisible. */
  ok(view.pillsVisible === true, 'the marker row is visible without expanding');
  const pillText = (view.pills || []).join(' | ');
  ok(/FT ?\d/.test(pillText), 'free transfers are shown (' + pillText + ')');
  ok(/TV ?£\d/.test(pillText), 'team value is shown');
  ok(/ITB ?£\d/.test(pillText), 'money in the bank is shown');
  ok(/OR ?[\d,]+/.test(pillText), 'overall rank is shown');
  ok(/PLAYED ?\d+\/\d+/.test(pillText), 'progress is shown');

  /* The chip ledger: what they have already spent this season. */
  ok(/CHIPS/.test(pillText), 'the chip ledger is shown');
  ok((view.chipCodes || []).includes('TC'),
     'a chip played earlier in the season appears (' + (view.chipCodes || []).join(',') + ')');

  ok(dErrors.length === 0, 'the detailed view threw nothing (' + dErrors.slice(0, 2).join(' | ') + ')');
  await dp.close();
}

section('mini-league sorting: a different order, not a different league');
{
  /* Asked for alongside the compact/detailed toggle. The mock league is
     Rival FC 120 (GW 62), My Team 118 (GW 55), Third Wheel 90 (GW 40) —
     so league order and gameweek order agree, and reversing is what
     actually proves the control is wired. */
  const sp = await browser.newPage();
  const sErrors = [];
  sp.on('pageerror', (e) => sErrors.push(e.message));
  await sp.addInitScript(() => { try { localStorage.setItem('ge-mid', '1234567'); } catch (_) {} });
  await sp.goto(`http://localhost:${API_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await sp.waitForTimeout(1200);

  const out = await sp.evaluate(async () => {
    const names = () => [...document.querySelectorAll('#league-standings .dl-row:not(.head) .dl-nm')]
      .map((e) => e.textContent.replace(' · you', '').trim());
    try {
      LEAGUE_SEL = 555; LEAGUE_TYPE = 'classic'; LEAGUE_PAGE = 1;
      LEAGUE_VIEW = 'compact'; LEAGUE_SORT = 'rank'; LEAGUE_DIR = 0;
      renderPage('leagues');
    } catch (e) { return { err: e.message }; }
    await new Promise((r) => setTimeout(r, 1600));
    const sel = document.getElementById('lg-sort');
    const dir = document.getElementById('lg-dir');
    if (!sel || !dir) return { found: false };
    const base = names();
    const opts = [...sel.options].map((o) => o.value);
    const dirBefore = dir.textContent;

    /* Reverse the default sort — league order, worst first. */
    dir.click();
    await new Promise((r) => setTimeout(r, 1400));
    const reversed = names();

    return {
      found: true, base, reversed, opts, dirBefore,
      dirAfter: document.getElementById('lg-dir').textContent,
      /* Position labels must survive: reordering rows is not renumbering. */
      ranks: [...document.querySelectorAll('#league-standings .dl-row:not(.head) .dl-rank')]
        .map((e) => e.textContent.trim()),
      barVisible: (() => { const b = document.querySelector('.lg-bar');
        return b ? b.getBoundingClientRect().height > 0 : false; })(),
      selW: document.getElementById('lg-sort').getBoundingClientRect().width,
    };
  });

  ok(out.found === true, 'the sort control renders (' + (out.err || '') + ')');
  ok(out.barVisible === true, 'on the same row as the view toggle');
  ok(out.selW > 0, 'and the field select has width');

  /* The compact table must not offer sorts it cannot perform: team
     value and overall rank need squads, which compact has not loaded. */
  ok(out.opts.join(',') === 'rank,total,gw,move',
     'compact offers only the sorts standings can answer (' + out.opts.join(',') + ')');

  ok(out.base.join(',') === 'Rival FC,My Team,Third Wheel',
     'league order first (' + out.base.join(',') + ')');
  ok(out.reversed.join(',') === 'Third Wheel,My Team,Rival FC',
     'and the direction button reverses it (' + out.reversed.join(',') + ')');
  /* The arrow must report the direction actually in force, in both
     states — asserting one of them alone passes on a button that is
     merely stuck. League position reads ascending by default (1 is
     best), so it starts up and flips down. */
  ok(out.dirBefore === '▲', 'league position starts ascending (' + out.dirBefore + ')');
  ok(out.dirAfter === '▼', 'and the arrow turns over with the order (' + out.dirAfter + ')');

  /* THE POSITION COLUMN IS NOT RECOMPUTED. Reversed, the rows read
     3, 2, 1 — the same league, differently ordered. Renumbering to
     1, 2, 3 would be a claim about a different table. */
  ok(out.ranks.join(',') === '3,2,1',
     'positions travel with their managers rather than being renumbered (' + out.ranks.join(',') + ')');

  /* Detailed view offers the squad-dependent sorts as well. */
  const deep = await sp.evaluate(async () => {
    LEAGUE_VIEW = 'detailed'; LEAGUE_SORT = 'rank'; LEAGUE_DIR = 0;
    renderPage('leagues');
    await new Promise((r) => setTimeout(r, 3000));
    const sel = document.getElementById('lg-sort');
    if (!sel) return { opts: [] };
    return {
      opts: [...sel.options].map((o) => o.value),
      mgrs: document.querySelectorAll('.lg-mgr').length,
    };
  });
  ok(deep.opts.join(',') === 'rank,total,gw,move,or,tv,yet,played',
     'detailed adds the squad-dependent sorts (' + deep.opts.join(',') + ')');
  ok(deep.mgrs === 3, 'and the detailed rows still render, got ' + deep.mgrs);

  ok(sErrors.length === 0, 'sorting threw nothing (' + sErrors.slice(0, 2).join(' | ') + ')');
  await sp.close();
}

section('the sidebar at tablet widths: no hover, so nothing may depend on it');
{
  /* Reported: "Sidebar menu on iPad isn't right" — an iPad in landscape
     showed a 48px strip of unlabelled icons with the FPL/EFL switcher
     sliced down the middle.

     The rail between 901px and 1279px opens on :hover. A touch screen
     has no hover, so on an iPad in landscape (1024 and 1180 CSS px, both
     inside that band) it could not be opened by any gesture: labels
     stuck at opacity 0, the brand and gameweek strip at display:none,
     and the competition switcher — wider than 48px — clipped by the
     rail's overflow:hidden, which put the EFL link off the page rather
     than merely out of reach.

     Every viewport this suite used was a desktop one, where hover exists
     and the rail behaves. The bug lives entirely in the combination of
     width AND pointer type, so the check has to vary both. */
  const CASES = [
    { name: 'iPad portrait', w: 820, h: 1180, touch: true, drawer: true },
    { name: 'iPad landscape', w: 1024, h: 768, touch: true, pinned: true },
    { name: 'iPad 11in landscape', w: 1180, h: 820, touch: true, pinned: true },
    { name: 'iPad Pro landscape', w: 1366, h: 1024, touch: true, pinned: true },
    { name: 'desktop, mouse', w: 1180, h: 820, touch: false, rail: true },
  ];
  for (const c of CASES) {
    const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, hasTouch: c.touch });
    const p = await ctx.newPage();
    await p.goto(`http://localhost:${API_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(900);
    const r = await p.evaluate(() => {
      const sb = document.querySelector('.sidebar');
      const g = document.querySelector('.sb-game');
      const lab = document.querySelector('.nav-area-label');
      const sbR = Math.round(sb.getBoundingClientRect().right);
      const gHidden = g ? getComputedStyle(g).display === 'none' : true;
      return {
        hoverNone: matchMedia('(hover:none)').matches,
        w: Math.round(sb.getBoundingClientRect().width),
        labels: lab ? getComputedStyle(lab).opacity : null,
        onScreen: Math.round(sb.getBoundingClientRect().left) >= 0,
        switcherHidden: gHidden,
        /* Visible but running past the sidebar's own edge is the defect:
           a control the user can see part of and cannot reach. */
        switcherClipped: !gHidden && g
          ? [...g.querySelectorAll('.sb-game-btn')].some((b) => {
              const bb = b.getBoundingClientRect();
              return bb.width === 0 || Math.round(bb.right) > sbR + 1;
            })
          : false,
      };
    });

    ok(r.hoverNone === c.touch,
       c.name + ': pointer type is what the case says (hover:none=' + r.hoverNone + ')');
    /* A control is never half-visible: either fully reachable, or
       deliberately hidden with the rest of the collapsed rail. */
    ok(r.switcherClipped === false,
       c.name + ': the competition switcher is not sliced by the rail');

    if (c.pinned) {
      ok(r.w >= 200, c.name + ': the sidebar is pinned open, got ' + r.w + 'px');
      ok(r.labels === '1', c.name + ': its labels are readable without hovering (' + r.labels + ')');
      ok(r.switcherHidden === false, c.name + ': and the EFL link is on the page');
    }
    if (c.rail) {
      /* The mouse case must NOT change — the rail is the desktop design. */
      ok(r.w <= 60, c.name + ': keeps the collapsed icon rail, got ' + r.w + 'px');
      ok(r.labels === '0', c.name + ': with labels revealed on hover, not before');
      ok(r.switcherHidden === true, c.name + ': and the switcher hidden rather than half-drawn');
    }
    if (c.drawer) {
      ok(r.w >= 200, c.name + ': the drawer keeps its full width, got ' + r.w + 'px');
    }
    await ctx.close();
  }
}

section('squad planner: a rebuild against your own budget, not a clean £100m');
{
  /* Asked for: turn the pre-season draft into a planner usable all
     season. Two things change once the season is running — the budget is
     your squad's value rather than the game's opening £100.0m, and the
     useful output is the TRANSFERS from your team to the plan rather
     than a squad in a vacuum. */
  const pp = await browser.newPage();
  const pErrors = [];
  pp.on('pageerror', (e) => pErrors.push(e.message));
  await pp.addInitScript(() => { try { localStorage.setItem('ge-mid', '1234567'); } catch (_) {} });
  await pp.goto(`http://localhost:${API_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await pp.waitForTimeout(1200);

  const plan = await pp.evaluate(async () => {
    try { openPanel('draft'); } catch (e) { return { err: e.message }; }
    await new Promise((r) => setTimeout(r, 3200));
    const S = window._draft;
    const txt = document.body.innerText;
    return {
      err: null,
      booted: !!S,
      /* The linked squad reached the planner, so a comparison is possible. */
      mySquad: S && S.mySquad ? S.mySquad.ids.length : 0,
      budgetFromEntry: !!(S && S.mySquad && S.mySquad.budget && S.mySquad.budget.fromEntry),
      budgetTenths: (S && S.mySquad && S.mySquad.budget) ? S.mySquad.budget.tenths : null,
      planBudget: typeof planBudgetTenths === 'function' ? planBudgetTenths() : null,
      /* The panel is no longer branded pre-season only. */
      named: /Squad Planner/i.test(txt),
      stillPreseasonNamed: /Pre-season Draft/i.test(txt),
      vsBox: !!document.getElementById('draft-vs'),
    };
  });

  ok(plan.booted === true, 'the planner boots (' + (plan.err || '') + ')');
  ok(plan.named === true, 'and is named as a planner rather than a pre-season draft');
  ok(plan.stillPreseasonNamed === false, 'with the old name gone from the page');
  ok(plan.vsBox === true, 'the plan-vs-team slot exists');

  /* THE BUDGET. The mock squad is worth 1000 tenths (£100.0m) with the
     bank already inside it, which the probe established against six real
     squads. The planner must spend that, not the game's opening budget
     plus a bank on top. */
  ok(plan.mySquad === 15, 'the linked squad reached the planner, got ' + plan.mySquad);
  ok(plan.budgetFromEntry === true, 'and supplied the budget');
  ok(plan.budgetTenths === 1000, 'which is the squad value alone, got ' + plan.budgetTenths);
  ok(plan.planBudget === plan.budgetTenths,
     'and that is what the validator spends (' + plan.planBudget + ')');

  /* Adding a player the squad does not own must produce a transfer line. */
  const diff = await pp.evaluate(async () => {
    const S = window._draft;
    const mine = new Set(S.mySquad.ids);
    const outsider = S.pool.find((e) => !mine.has(e.id));
    DRAFT_IDS = S.mySquad.ids.slice(0, 14).concat([outsider.id]);
    renderDraft();
    await new Promise((r) => setTimeout(r, 250));
    const box = document.getElementById('draft-vs');
    return { text: box ? box.innerText : '', rows: box ? box.querySelectorAll('.dl-row').length : 0 };
  });
  ok(/transfer/i.test(diff.text), 'a plan that differs from the squad reports transfers');
  ok(diff.rows >= 2, 'listing what comes in and what goes out, got ' + diff.rows + ' rows');
  ok(/In\b/.test(diff.text) && /Out\b/.test(diff.text), 'both directions are named');

  /* And a plan identical to the squad says so rather than showing an
     empty transfer list. */
  const same = await pp.evaluate(async () => {
    DRAFT_IDS = window._draft.mySquad.ids.slice();
    renderDraft();
    await new Promise((r) => setTimeout(r, 250));
    const box = document.getElementById('draft-vs');
    return box ? box.innerText : '';
  });
  ok(/already own|nothing to do/i.test(same),
     'a plan matching the squad says there is nothing to do (' + same.slice(0, 70) + ')');

  /* ── Fixtures on the tile ────────────────────────────────────────
     A squad planner is a fixture decision as much as a player one, and
     the board showed exactly one opponent per player — a kind opener
     followed by two hard weeks looked identical to three kind ones. */
  const fx = await pp.evaluate(async () => {
    DRAFT_IDS = window._draft.mySquad.ids.slice();
    renderDraft();
    await new Promise((r) => setTimeout(r, 250));
    const tiles = [...document.querySelectorAll('#draft-pitch .pp, .qd-pitch .pp, .pp')]
      .filter((t) => t.querySelector('.pp-nm') && t.closest('.card'));
    const runs = tiles.map((t) => t.querySelector('.pp-run')).filter(Boolean);
    const segs = runs.map((r) => r.querySelectorAll('i').length);
    const painted = runs.length ? [...runs[0].querySelectorAll('i')]
      .map((i) => getComputedStyle(i).backgroundColor) : [];
    return {
      tiles: tiles.length,
      runs: runs.length,
      segs: [...new Set(segs)],
      painted,
      /* Each segment must have real width, or the bar is decoration. */
      widths: runs.length ? [...runs[0].querySelectorAll('i')]
        .map((i) => Math.round(i.getBoundingClientRect().width)) : [],
      titled: runs.length ? (runs[0].getAttribute('title') || '') : '',
      /* The named next fixture stays — colour alone is not a fixture. */
      named: tiles.length ? !!tiles[0].querySelector('.pp-sub .l') : false,
    };
  });

  ok(fx.runs > 0, 'players carry a fixture run, got ' + fx.runs + ' of ' + fx.tiles + ' tiles');
  ok(fx.segs.length === 1 && fx.segs[0] === 3,
     'and it is three gameweeks, got segment counts ' + fx.segs.join('/'));
  ok(fx.named === true, 'the next opponent is still named, not reduced to a colour');
  ok(fx.widths.every((w) => w > 0), 'every segment has width (' + fx.widths.join(',') + ')');
  /* Colour is the whole signal, so a segment that never got one is a
     blank bar pretending to be a difficulty rating. */
  ok(fx.painted.every((c) => c && !/rgba\(0, 0, 0, 0\)/.test(c)),
     'every segment is painted (' + fx.painted.join(' ') + ')');
  ok(/GW\d/.test(fx.titled), 'and the run names its gameweeks on hover (' + fx.titled.slice(0, 50) + ')');

  ok(pErrors.length === 0, 'the planner threw nothing (' + pErrors.slice(0, 2).join(' | ') + ')');
  await pp.close();
}

section('no uncaught errors');
ok(pageErrors.length === 0, 'page threw nothing (' + pageErrors.slice(0, 3).join(' | ') + ')');

await browser.close();
server.close();
apiServer.close();
noPicksServer.close();
console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
