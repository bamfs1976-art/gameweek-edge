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
  'liverank', 'whatif',
  'eo', 'template', 'rivals', 'scout',
  'allplayers', 'compare', 'price', 'setpiece', 'rotation',
  'fixtures', 'seasonsim',
  'leagues', 'chips', 'gwhistory', 'watchlist', 'alerts',
  'results', 'titlerace', 'dossier', 'clubform',
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

/* The model bundle lives on an external host, so offline every panel that
   reads it renders an error box — which a smoke test happily accepts as
   "rendered". Stub it, and those panels are actually exercised: the Clean
   Sheet view, the Title Race and the season simulator all run their real
   renderers instead of their failure path. */
const CLUBS = ['Arsenal', 'Aston Villa', 'Bournemouth', 'Brentford', 'Brighton', 'Chelsea',
  'Coventry', 'Crystal Palace', 'Everton', 'Fulham', 'Hull', 'Ipswich', 'Leeds', 'Liverpool',
  'Man City', 'Man Utd', 'Newcastle', "Nott'm Forest", 'Sunderland', 'Spurs'];
const bundleTeams = {};
CLUBS.forEach((c, i) => {
  bundleTeams[c] = { attack: 0.8 + i * 0.02, defence: 0.8 + (19 - i) * 0.02, home: 1.15 };
});
const bundleFixtures = [];
for (let md = 0; md < 38; md++) {
  const row = [];
  for (let i = 0; i < 20; i += 2) row.push([CLUBS[(i + md) % 20], CLUBS[(i + 1 + md) % 20]]);
  bundleFixtures.push(row);
}
await page.route('**/model.json', (r) => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({
    constants: { BASE_H: 1.45, BASE_A: 1.15, DC_RHO: -0.05 },
    teams: bundleTeams, fixtures: bundleFixtures,
    season_state: { live: false, played_md: 0, label: '2026/27' }
  })
}));

await page.addInitScript(([base, mid]) => {
  localStorage.setItem('ge-api-base', base);
  localStorage.setItem('ge-mid', mid);
  localStorage.setItem('ge-tier', 'pro');
  localStorage.setItem('ge-onboarded', '1');
}, [BASE, MID]);

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });

/* Did a hub view actually paint? Three outcomes worth telling apart:
     skeleton — the hydrator never resolved, or resolved without painting
     failed   — it THREW, and the hub caught it (.hub-fail)
     empty    — the whole body is one state box: nothing to show at all
   A state box NESTED among real cards is not a failure. The projected XI
   renders exactly that against pre-season data — three cards, one of which
   says "Not enough data yet" because projectXI needs starts and minutes the
   mock has none of. Treating that as an error is how this check first went
   wrong. */
await page.addScriptTag({ content: `
  window.viewState = (id) => {
    const b = document.getElementById(id);
    if (!b || !b.children.length || b.querySelector('.sk')) return 'skeleton';
    if (b.querySelector('.hub-fail')) return 'failed';
    const cards = b.querySelectorAll('.card');
    if (cards.length === 1 && cards[0].querySelector('.ge-state')) return 'empty';
    return 'ok';
  };
` });

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

/* Every view of the Live hub, in both tiers — three of the five are paid, so
   the gate lives inside the panel and only one view is on screen at a time. */
let lvChecks = 0;
for (const tier of ['pro', 'free']) {
  await page.evaluate((t) => setTier(t), tier);
  for (const view of await page.evaluate(() => LV_VIEWS.map((v) => v.id))) {
    current = `live:${view}:${tier}`; lvChecks++;
    await page.evaluate((v) => { lvSetView(v); renderPage('liverank'); }, view);
    await page.waitForTimeout(900);
    const [sw, vw] = await page.evaluate(() => [document.body.scrollWidth, window.innerWidth]);
    if (sw > vw + 2) { overflow++; console.error(`  OVERFLOW ${current}: ${sw} > ${vw}`); }
    const shown = await page.evaluate(() => {
      const b = document.getElementById('lv-body');
      return { empty: !b || !b.children.length, locked: !!(b && b.querySelector('.pro-lockstrip')) };
    });
    const paid = await page.evaluate((v) => !!LV_VIEWS.find((x) => x.id === v && x.tier === 'paid'), view);
    if (shown.empty) { overflow++; console.error(`  ! ${current} rendered nothing`); }
    if (tier === 'free' && paid && !shown.locked) {
      overflow++; console.error(`  ! ${current} is a paid view that did not lock`);
    }
    if (tier === 'pro' && shown.locked) {
      overflow++; console.error(`  ! ${current} locked for a Pro reader`);
    }
  }
}
await page.evaluate(() => setTier('pro'));

/* Every view of the Matchday hub — three readings of one fixture list. */
let mcChecks = 0;
for (const view of await page.evaluate(() => MC_VIEWS.map((v) => v.id))) {
  current = `matchday:${view}`; mcChecks++;
  await page.evaluate((v) => { mcSetView(v); renderPage('results'); }, view);
  await page.waitForTimeout(1100);
  const [sw, vw] = await page.evaluate(() => [document.body.scrollWidth, window.innerWidth]);
  if (sw > vw + 2) { overflow++; console.error(`  OVERFLOW ${current}: ${sw} > ${vw}`); }
  const state = await page.evaluate(() => viewState('mc-body'));
  if (state !== 'ok') { overflow++; console.error(`  ! ${current} rendered ${state}, not content`); }
}
/* The results board pages between gameweeks by re-rendering itself. It has to
   land in the hub's body — into #ge-data it would wipe the view chips and
   leave the panel with no way back to Forecasts or Line-ups. */
await page.evaluate(() => { mcSetView('results'); renderPage('results'); });
await page.waitForTimeout(1100);
await page.evaluate(() => resNav(-1));
await page.waitForTimeout(1100);
const navKept = await page.evaluate(() => {
  const chips = document.querySelectorAll('#mc-views .lensbtn').length;
  const body = document.getElementById('mc-body');
  return chips === 3 && !!body && !!body.children.length;
});
if (!navKept) { overflow++; console.error('  ! resNav destroyed the Matchday view chips'); }

/* Every view of the fixtures hub. Three renderers share one body, and only
   one of them is on screen at a time — a throw in the Points or Clean Sheet
   view would never appear on the default Grid. */
let fxChecks = 0;
for (const view of await page.evaluate(() => FX_VIEWS.map((v) => v.id))) {
  current = `fixtures:${view}`; fxChecks++;
  await page.evaluate((v) => { fxSetView(v); renderPage('fixtures'); }, view);
  await page.waitForTimeout(1200);
  const [sw, vw] = await page.evaluate(() => [document.body.scrollWidth, window.innerWidth]);
  if (sw > vw + 2) { overflow++; console.error(`  OVERFLOW ${current}: ${sw} > ${vw}`); }
  /* The skeleton must have been replaced by real content — a hydrator that
     silently resolves without painting leaves the loading bones on screen. */
  const state = await page.evaluate(() => viewState('fx-body'));
  if (state !== 'ok') { overflow++; console.error(`  ! ${current} rendered ${state}, not content`); }
}

// Ignore network noise from the offline CDN (photos/crests aren't reachable in tests).
const appErrors = errors.filter((e) => !/Failed to load resource|ERR_|404|501|net::/.test(e));

console.log(`panels: ${PANELS.length} | lens renders: ${lensChecks} | fixture views: ${fxChecks} | live views: ${lvChecks} | matchday views: ${mcChecks} | overflow: ${overflow || 'none'} | app errors: ${appErrors.length}`);
appErrors.forEach((e) => console.error('  ! ' + e));

await browser.close();
process.exit(overflow || appErrors.length ? 1 : 0);
