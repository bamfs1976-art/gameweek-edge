/*
 * Simple-view contract — does the density toggle actually narrow the app, and
 * does Everything give it all back?
 *
 * Drives the real app against dev/mock_fpl.py, because the thing under test is
 * what a first-time visitor SEES: the sidebar, the tab strip, the dashboard
 * and the top bar, all of which are assembled at run time from live data.
 *
 * The load-bearing case is "a hidden panel is still reachable". Simple mode is
 * a NAVIGATION filter — if it ever leaks into openPanel, every bookmark, push
 * notification and shared link into a Pro or advanced panel breaks, and the
 * decluttered nav becomes a broken app. That test is the one to keep.
 *
 * Skips (exit 0) when Playwright's browser or python3 is unavailable, so a
 * checkout without either still passes npm test.
 *
 * Run: node dev/test-simplenav.mjs   (wired into npm test)
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

let chromium;
try{ ({ chromium } = await import('playwright')); }
catch(_){ console.log('· simple nav: playwright not installed, skipped'); process.exit(0); }

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8731;
const BASE = 'http://127.0.0.1:' + PORT;

if(spawnSync('python3', ['-c', 'import sys'], { stdio: 'ignore' }).status !== 0){
  console.log('· simple nav: python3 unavailable, skipped'); process.exit(0);
}
if(!existsSync(join(REPO, 'dev', 'mock_fpl.py'))){
  console.log('· simple nav: mock server missing, skipped'); process.exit(0);
}

const mock = spawn('python3', [join(REPO, 'dev', 'mock_fpl.py')], {
  cwd: REPO, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
});
const stop = () => { try{ mock.kill(); }catch(_){} };
process.on('exit', stop);

/* Wait for the mock rather than sleeping a fixed amount. */
let up = false;
for(let i = 0; i < 40 && !up; i++){
  try{ up = (await fetch(BASE + '/api/fpl/bootstrap-static/')).ok; }
  catch(_){ await new Promise(r => setTimeout(r, 250)); }
}
if(!up){ stop(); console.log('· simple nav: mock server did not start, skipped'); process.exit(0); }

let b;
try{
  b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}catch(err){
  stop();
  console.log('· simple nav: no chromium available, skipped (' + String(err.message).split('\n')[0] + ')');
  process.exit(0);
}

const results = [];
const check = (name, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want;
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `\n    got ${JSON.stringify(got)}`));
};

/* One page per case: density is read from localStorage at first paint, so a
   shared page would carry the previous case's shell. */
const open = async (density, hash) => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 } });
  await ctx.addInitScript(([d]) => {
    try{
      localStorage.setItem('ge-api-base', 'http://127.0.0.1:8731');
      localStorage.setItem('ge-visited', '1');      /* never bounce to /welcome */
      localStorage.setItem('ge-tour-seen', '1');    /* the tour would cover the page */
      if(d) localStorage.setItem('ge-density', d);
    }catch(_){}
  }, [density]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await page.goto(BASE + '/' + (hash || ''), { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  return { ctx, page, errors };
};
const shell = (page) => page.evaluate(() => ({
  areas: [...document.querySelectorAll('#sb-nav .nav-area button, #sb-nav button')]
    .map(e => e.textContent.trim()).filter(Boolean),
  tabs: [...document.querySelectorAll('#area-tabs .area-tab')].map(e => e.textContent.trim()),
  lockedTabs: [...document.querySelectorAll('#area-tabs .area-tab.lk')].length,
  dashVisible: [...document.querySelectorAll('#ge-data [data-dash]')]
    .filter(e => !e.hidden).map(e => e.getAttribute('data-dash')),
  exportShown: !!document.getElementById('export-btn')?.offsetParent,
  refreshShown: !!document.getElementById('refresh-btn')?.offsetParent,
  densityLabel: document.getElementById('density-btn')?.textContent.trim(),
  title: document.getElementById('tb-title')?.textContent.trim(),
}));

/* ── simple ── */
{
  const { ctx, page, errors } = await open('beginner');
  const s = await shell(page);
  check('simple: sidebar is narrowed', s.areas.length, n => n > 0 && n <= 5);
  check('simple: no Rivals or Match Centre in the sidebar',
    s.areas.some(a => /Rivals|Match Centre/.test(a)), false);
  check('simple: Home offers three tabs', s.tabs.length, 3);
  check('simple: no locked Pro tab on show', s.lockedTabs, 0);
  check('simple: dashboard shows only the three calls', s.dashVisible, v =>
    v.length === 1 && v[0] === 'action');
  check('simple: CSV export hidden', s.exportShown, false);
  check('simple: refresh hidden', s.refreshShown, false);
  check('simple: toggle reads Simple', s.densityLabel, 'Simple');
  check('simple: no page errors', errors.length, 0);
  await ctx.close();
}

/* ── everything ── */
{
  const { ctx, page, errors } = await open('expert');
  const s = await shell(page);
  check('everything: all seven areas', s.areas.length, 7);
  check('everything: Home offers all seven tabs', s.tabs.length, 7);
  check('everything: CSV export back', s.exportShown, true);
  check('everything: toggle reads Everything', s.densityLabel, 'Everything');
  check('everything: dashboard shows every block', s.dashVisible, v => v.length >= 4);
  check('everything: no page errors', errors.length, 0);
  await ctx.close();
}

/* ── the one that must never break ── */
{
  const { ctx, page } = await open('beginner', '#eo');
  const s = await shell(page);
  check('a panel hidden from simple nav is still reachable by deep link',
    s.title, 'EO Tracker');
  check('and it still gets a tab strip to move sideways', s.tabs.length, t => t >= 2);
  await ctx.close();
}

/* ── the primer renders without live data ── */
{
  const { ctx, page, errors } = await open('beginner', '#fplbasics');
  const txt = await page.evaluate(() => document.getElementById('ge-data')?.textContent || '');
  check('the New to FPL primer renders', /Fantasy Premier League, in two minutes/.test(txt), true);
  check('primer covers the captain rule', /captain scores double/i.test(txt), true);
  check('primer: no page errors', errors.length, 0);
  await ctx.close();
}

/* ── the one-tap way out of the simple dashboard ── */
{
  const { ctx, page } = await open('beginner');
  const before = (await shell(page)).dashVisible.length;
  await page.click('#ge-data .dash-chips button:last-child');   /* Show everything + */
  await page.waitForTimeout(600);
  const after = await shell(page);
  check('"Show everything" reveals the rest of the dashboard',
    before === 1 && after.dashVisible.length >= 4, true);
  check('and the chip row loses its own button once nothing is hidden',
    await page.evaluate(() => !/Show everything/.test(
      document.querySelector('#ge-data .dash-chips')?.textContent || '')), true);
  await ctx.close();
}

/* ── switching view rebuilds the shell in place ── */
{
  const { ctx, page } = await open('beginner');
  await page.click('#density-btn');
  await page.waitForTimeout(2500);
  const s = await shell(page);
  check('switching to Everything rebuilds the sidebar', s.areas.length, 7);
  check('switching to Everything restores the tabs', s.tabs.length, 7);
  await ctx.close();
}

await b.close(); stop();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
