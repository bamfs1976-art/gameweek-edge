/*
 * Navigation + depth contract, post-overhaul.
 *
 * What must hold:
 *  1. The sidebar and the bottom tab bar render the SAME five destinations,
 *     with identical labels and order: Home · Squad · Players · Live · More.
 *  2. Depth (Essentials/Everything) decides how much the Home page shows:
 *     Essentials is the decision cards alone; Everything adds the named
 *     sections (Model XI, Differentials, Live state) and their jump nav.
 *  3. A panel that is not a nav destination is still reachable by URL —
 *     the load-bearing case. If depth or the five-tab nav ever leaks into
 *     openPanel, every bookmark and shared link breaks.
 *  4. Path routing: a deep path renders the right panel; in-app navigation
 *     pushes history and back returns.
 *
 * Drives the real app against dev/mock_fpl.py. Skips (exit 0) when
 * Playwright's browser or python3 is unavailable.
 *
 * Run: node dev/test-simplenav.mjs   (wired into npm test)
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

let chromium;
try{ ({ chromium } = await import('playwright')); }
catch(_){ console.log('· nav contract: playwright not installed, skipped'); process.exit(0); }

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8731;
const BASE = 'http://127.0.0.1:' + PORT;

if(spawnSync('python3', ['-c', 'import sys'], { stdio: 'ignore' }).status !== 0){
  console.log('· nav contract: python3 unavailable, skipped'); process.exit(0);
}
if(!existsSync(join(REPO, 'dev', 'mock_fpl.py'))){
  console.log('· nav contract: mock server missing, skipped'); process.exit(0);
}

/* Reuse a mock server that is already up (a dev loop), else start one. */
let mock = null;
let up = false;
try{ up = (await fetch(BASE + '/api/fpl/bootstrap-static/')).ok; }catch(_){}
if(!up){
  mock = spawn('python3', [join(REPO, 'dev', 'mock_fpl.py')], {
    cwd: REPO, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
  });
  for(let i = 0; i < 40 && !up; i++){
    try{ up = (await fetch(BASE + '/api/fpl/bootstrap-static/')).ok; }
    catch(_){ await new Promise(r => setTimeout(r, 250)); }
  }
}
const stop = () => { if(mock){ try{ mock.kill(); }catch(_){} } };
process.on('exit', stop);
if(!up){ stop(); console.log('· nav contract: mock server did not start, skipped'); process.exit(0); }

let b;
try{
  b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}catch(err){
  stop();
  console.log('· nav contract: no chromium available, skipped (' + String(err.message).split('\n')[0] + ')');
  process.exit(0);
}

const results = [];
const check = (name, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want;
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `\n    got ${JSON.stringify(got)}`));
};

const open = async (density, path, viewport) => {
  const ctx = await b.newContext({ viewport: viewport || { width: 1280, height: 1100 } });
  await ctx.addInitScript(([d]) => {
    try{
      localStorage.setItem('ge-api-base', 'http://127.0.0.1:8731');
      localStorage.setItem('ge-visited', '1');      /* never bounce to /welcome */
      if(d) localStorage.setItem('ge-density', d);
    }catch(_){}
  }, [density]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await page.goto(BASE + (path || '/'), { waitUntil: 'load' });
  await page.waitForTimeout(3500);
  return { ctx, page, errors };
};
const shell = (page) => page.evaluate(() => ({
  sidebar: [...document.querySelectorAll('#sb-nav .nav-area-btn .nav-area-label')]
    .map(e => e.textContent.trim()),
  bottom: [...document.querySelectorAll('#bottom-nav .bn-item .bn-label')]
    .map(e => e.textContent.trim()),
  tabs: [...document.querySelectorAll('#area-tabs .area-tab')].map(e => e.textContent.trim()),
  hero: !!document.querySelector('.dc-hero'),
  pair: !!document.querySelector('.dc-pair'),
  jumpShown: (() => { const j = document.querySelector('.dash-jump'); return !!(j && j.offsetParent); })(),
  sectionsShown: (() => { const g = document.querySelector('.quad-grid'); return !!(g && g.offsetParent); })(),
  chipRow: !!document.querySelector('.dash-chips'),
  coachMark: !!document.querySelector('.tour'),
  densityLabel: document.getElementById('density-btn')?.textContent.trim(),
  title: document.getElementById('tb-title')?.textContent.trim(),
  area: document.getElementById('tb-area')?.textContent.trim(),
  path: location.pathname,
}));

const FIVE = ['Home', 'Squad', 'Players', 'Live', 'More'];

/* ── essentials ── */
{
  const { ctx, page, errors } = await open('beginner');
  const s = await shell(page);
  check('one nav map: sidebar is Home·Squad·Players·Live·More', s.sidebar.join('|'), FIVE.join('|'));
  check('one nav map: bottom tabs carry identical labels and order', s.bottom.join('|'), s.sidebar.join('|'));
  check('essentials: the DecisionCard hero renders', s.hero, true);
  check('essentials: transfer + chip sibling cards render', s.pair, true);
  check('essentials: the deeper sections stay out of the flow', s.sectionsShown, false);
  check('essentials: no section jumper', s.jumpShown, false);
  check('the old chip row is gone', s.chipRow, false);
  check('no coach marks over the page', s.coachMark, false);
  check('depth control reads Essentials', s.densityLabel, 'Depth: Essentials');
  check('essentials: no page errors', errors.length, 0);
  await ctx.close();
}

/* ── everything ── */
{
  const { ctx, page, errors } = await open('expert');
  const s = await shell(page);
  check('everything: same five destinations', s.sidebar.join('|'), FIVE.join('|'));
  check('everything: named sections join the page flow', s.sectionsShown, true);
  check('everything: the section jumper appears', s.jumpShown, true);
  check('depth control reads Everything', s.densityLabel, 'Depth: Everything');
  check('everything: no page errors', errors.length, 0);
  await ctx.close();
}

/* ── the one that must never break ── */
{
  const { ctx, page } = await open('beginner', '/eo');
  const s = await shell(page);
  /* Ownership is a Pro panel with no nav tab of its own; the URL must
     still land on it (shown locked), never bounce to the dashboard. */
  check('a panel outside the five tabs is still reachable by URL',
    s.area === 'Rivals' && s.title !== 'Overview', true);
  check('and it still gets a tab strip to move sideways', s.tabs.length, t => t >= 2);
  await ctx.close();
}

/* ── path routing ── */
{
  const { ctx, page } = await open('expert', '/players');
  const s = await shell(page);
  check('a deep path renders its panel', s.title, 'Players');
  await page.evaluate(() => openPanel('fixtures'));
  await page.waitForTimeout(800);
  check('in-app navigation rewrites the path', await page.evaluate(() => location.pathname), '/fixtures');
  await page.goBack();
  await page.waitForTimeout(1200);
  check('back returns to the previous screen', await page.evaluate(() => location.pathname), '/players');
  await ctx.close();
}

/* ── the More index ── */
{
  const { ctx, page, errors } = await open('beginner', '/more');
  const got = await page.evaluate(() => ({
    groups: [...document.querySelectorAll('.more-group-h')].map(e => e.textContent.trim()),
    items: document.querySelectorAll('.more-it').length,
  }));
  check('More is a grouped index screen', got.groups.join('|'), g => /Plan/.test(g) && /Research/.test(g) && /Account/.test(g));
  check('More lists the deeper destinations', got.items, n => n >= 12);
  check('More: no page errors', errors.length, 0);
  await ctx.close();
}

/* ── the primer renders without live data ── */
{
  const { ctx, page, errors } = await open('beginner', '/fplbasics');
  const txt = await page.evaluate(() => document.getElementById('ge-data')?.textContent || '');
  check('the New to FPL primer renders', /Fantasy Premier League, in two minutes/.test(txt), true);
  check('primer covers the captain rule', /captain scores double/i.test(txt), true);
  check('primer: no page errors', errors.length, 0);
  await ctx.close();
}

/* ── first run: LinkTeamFlow, not a coach mark ── */
{
  const { ctx, page } = await open('beginner', '/week');
  const got = await page.evaluate(() => ({
    input: !!document.getElementById('ltf-input'),
    browse: !!document.querySelector('.ltf-browse'),
    tour: !!document.querySelector('.tour'),
  }));
  check('unlinked My Week is the link-team screen', got.input && got.browse, true);
  check('and no coach mark renders over it', got.tour, false);
  await ctx.close();
}

/* ── switching depth rebuilds the page in place ── */
{
  const { ctx, page } = await open('beginner');
  await page.evaluate(() => setDensity('expert'));
  await page.waitForTimeout(2500);
  const s = await shell(page);
  check('switching to Everything reveals the sections', s.sectionsShown, true);
  check('and the nav still shows the same five destinations', s.sidebar.join('|'), FIVE.join('|'));
  await ctx.close();
}

await b.close(); stop();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
