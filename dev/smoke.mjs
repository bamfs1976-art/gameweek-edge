/*
 * Headless smoke test for Gameweek Edge.
 *
 * Renders every panel against the local mock server and fails if any panel
 * throws a console/page error or causes horizontal overflow on a phone
 * viewport. It's a fast "nothing is obviously broken" gate — not a substitute
 * for eyeballing a change.
 *
 * Prerequisites:
 *   npm install -D playwright
 *   npx playwright install chromium
 *
 * Run (mock server must already be running — see dev/mock_fpl.py):
 *   python3 dev/mock_fpl.py &        # in one shell
 *   node dev/smoke.mjs               # in another
 *
 * Environment overrides (all optional):
 *   BASE            base URL (default http://127.0.0.1:8700)
 *   MID             demo manager id (default 101)
 *   PLAYWRIGHT_PKG  module to import (default "playwright")
 *   CHROMIUM        explicit chromium executable path
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8700';
const MID = process.env.MID || '101';

const PANELS = [
  'dashboard', 'gw-actions', 'blog', 'squad', 'transfers', 'captain',
  'liverank', 'bonus', 'defcon', 'autosubs', 'whatif',
  'eo', 'template', 'rivals', 'scout',
  'allplayers', 'compare', 'price', 'setpiece', 'rotation',
  'fixtures', 'points5', 'csmatrix', 'seasonsim',
  'leagues', 'chips', 'gwhistory', 'watchlist', 'alerts',
  'results', 'matchforecast', 'lineups', 'titlerace', 'dossier', 'clubform',
  'myweek', 'scoutboard', 'news', 'draft', 'gwreport', 'methodology', 'accountability'
];

const pw = await import(process.env.PLAYWRIGHT_PKG || 'playwright');
const chromium = pw.chromium || (pw.default && pw.default.chromium);
const launchOpts = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 390, height: 800 } });

const errors = [];
let current = 'load';
page.on('pageerror', (e) => errors.push(`[${current}] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${current}] console: ${m.text()}`); });

await page.addInitScript(([base, mid]) => {
  localStorage.setItem('ge-api-base', base);
  localStorage.setItem('ge-mid', mid);
  localStorage.setItem('ge-tier', 'pro');
  localStorage.setItem('ge-onboarded', '1');
}, [BASE, MID]);

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });

let overflow = 0;
for (const p of PANELS) {
  current = p;
  await page.evaluate((pn) => window.renderPage(pn), p);
  await page.waitForTimeout(400);
  const [sw, vw] = await page.evaluate(() => [document.body.scrollWidth, window.innerWidth]);
  if (sw > vw + 2) { overflow++; console.error(`  OVERFLOW ${p}: ${sw} > ${vw}`); }
}

/* Every lens of the merged players table, in both tiers. The lens is where
   the column gate is applied, so a render error or a horizontal overflow
   there would only ever show up on one lens — the default one is not
   representative of the other nine. */
let lensChecks = 0;
for (const tier of ['pro', 'free']) {
  await page.evaluate((t) => setTier(t), tier);
  for (const lens of await page.evaluate(() => PL_LENSES.map((l) => l.id))) {
    current = `players:${lens}:${tier}`; lensChecks++;
    await page.evaluate((l) => { plSetLens(l); renderPage('allplayers'); }, lens);
    await page.waitForTimeout(400);
    const [sw, vw] = await page.evaluate(() => [document.body.scrollWidth, window.innerWidth]);
    if (sw > vw + 2) { overflow++; console.error(`  OVERFLOW ${current}: ${sw} > ${vw}`); }
    /* A Pro column must render a lock for a free reader and a value for a
       Pro one — the gate proved in the browser, not only in the unit test. */
    const locked = await page.evaluate(() => document.querySelectorAll('#pl-view .pl-lk').length);
    if (tier === 'free' && lens === 'eo' && !locked) { overflow++; console.error('  ! free EO lens showed no locks'); }
    if (tier === 'pro' && locked) { overflow++; console.error(`  ! pro ${lens} lens showed a lock`); }
  }
}
await page.evaluate(() => setTier('pro'));

// Ignore network noise from the offline CDN (photos/crests aren't reachable in tests).
const appErrors = errors.filter((e) => !/Failed to load resource|ERR_|404|501|net::/.test(e));

console.log(`panels: ${PANELS.length} | lens renders: ${lensChecks} | overflow: ${overflow || 'none'} | app errors: ${appErrors.length}`);
appErrors.forEach((e) => console.error('  ! ' + e));

await browser.close();
process.exit(overflow || appErrors.length ? 1 : 0);
