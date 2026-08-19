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
const server = createServer(staticHandler);
const apiServer = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (API[p] || PICKS_RE.test(p)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(readFileSync(join(ROOT, 'dev/fixtures', API[p] || 'fpl-mock-picks.json')));
  }
  return staticHandler(req, res);
});
await new Promise((r) => server.listen(PORT, r));
await new Promise((r) => apiServer.listen(API_PORT, r));

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
    priceCols: document.querySelectorAll('#fdr-tbody td.tm-px').length
  }));
  ok(!noSquad.toggle, 'with no team linked, the row-source toggle is not offered');
  ok(noSquad.priceCols === 0, 'and no player rows are drawn');

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
section('my squad rows, and a double gameweek that is visible as one');
{
  const sp = await browser.newPage();
  const spErrors = [];
  sp.on('pageerror', (e) => spErrors.push(e.message));
  /* The row source is offered only to a linked team, so link one before the
     page script runs. */
  await sp.addInitScript(() => { try { localStorage.setItem('ge-mid', '1234567'); } catch (_) {} });
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

section('no uncaught errors');
ok(pageErrors.length === 0, 'page threw nothing (' + pageErrors.slice(0, 3).join(' | ') + ')');

await browser.close();
server.close();
apiServer.close();
console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
