/*
 * Navigation + depth contract, post-overhaul.
 *
 * What must hold:
 *  1. The sidebar and the bottom tab bar render the SAME six destinations,
 *     with identical labels and order:
 *     Home · Squad · Players · Live · Leagues · More.
 *  2. Depth (Essentials/Everything) decides how much the Home page shows:
 *     Essentials is the decision cards alone; Everything adds the named
 *     sections (Model XI, Differentials, Live state) and their jump nav.
 *  3. A panel that is not a nav destination is still reachable by URL —
 *     the load-bearing case. If depth or the tab nav ever leaks into
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

const open = async (density, path, viewport, mode) => {
  const ctx = await b.newContext({ viewport: viewport || { width: 1280, height: 1100 } });
  await ctx.addInitScript(([d, m]) => {
    try{
      localStorage.setItem('ge-api-base', 'http://127.0.0.1:8731');
      localStorage.setItem('ge-visited', '1');      /* never bounce to /welcome */
      if(d) localStorage.setItem('ge-density', d);
      /* Terminal is the pre-existing experience every check below was
         written against; simple is the new default and gets its own block. */
      localStorage.setItem('ge-mode', m || 'terminal');
      /* Likewise the first-run flow: finished, so Home is the board these
         checks were written against. The flow has its own block. */
      localStorage.setItem('ge-onboard', 'done');
    }catch(_){}
  }, [density, mode]);
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

const NAV_LABELS = ['Home', 'Squad', 'Players', 'Live', 'Leagues', 'More'];

/* ── essentials ── */
{
  const { ctx, page, errors } = await open('beginner');
  const s = await shell(page);
  check('one nav map: sidebar is Home·Squad·Players·Live·Leagues·More', s.sidebar.join('|'), NAV_LABELS.join('|'));
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

/* ── simple mode: the five-panel rail ── */
{
  const { ctx, page, errors } = await open('beginner', '/', null, 'simple');
  const s = await shell(page);
  const SIMPLE = ['This Gameweek', 'My Squad', 'Transfer Planner', 'Captaincy Lab', 'Price Predictor', 'More'];
  check('simple: the rail is the five panels plus More', s.sidebar.join('|'), SIMPLE.join('|'));
  check('simple: bottom tabs carry the same six', s.bottom.join('|'), s.sidebar.join('|'));
  check('simple: no page errors', errors.length, 0);
  /* Every panel stays reachable: a deep link to a panel outside the five. */
  await page.evaluate(() => openPanel('fixtures'));
  await page.waitForTimeout(800);
  check('simple: a panel outside the rail still opens by name', await page.evaluate(() => document.getElementById('tb-title')?.textContent.trim()), 'Fixtures');
  await ctx.close();
}
{
  /* No stored mode at all: a signed-out visitor is simple by default, and a
     device that already carried a linked team keeps the full rail. */
  const fresh = async (mid) => {
    const c = await b.newContext({ viewport: { width: 1280, height: 1100 } });
    await c.addInitScript(([m]) => { try{
      localStorage.setItem('ge-api-base', 'http://127.0.0.1:8731');
      localStorage.setItem('ge-visited', '1');
      localStorage.setItem('ge-onboard', 'done');
      if(m) localStorage.setItem('ge-mid', m);
    }catch(_){} }, [mid]);
    const p = await c.newPage();
    await p.goto(BASE + '/', { waitUntil: 'load' });
    await p.waitForTimeout(3000);
    const labels = await p.evaluate(() => [...document.querySelectorAll('#sb-nav .nav-area-label')].map(e => e.textContent.trim()));
    const stored = await p.evaluate(() => localStorage.getItem('ge-mode'));
    await c.close();
    return { labels, stored };
  };
  const a = await fresh(null);
  check('no stored mode, no team: the rail is simple', a.labels[0], 'This Gameweek');
  const b2 = await fresh('101');
  check('no stored mode, team already linked: the device keeps the full rail', b2.labels.join('|'), NAV_LABELS.join('|'));
  check('and records that as terminal so it never flips later', b2.stored, 'terminal');
}

/* ── first run: three steps, under a minute ── */
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 } });
  await ctx.addInitScript(() => { try{
    localStorage.setItem('ge-api-base', 'http://127.0.0.1:8731');
    localStorage.setItem('ge-visited', '1');
    localStorage.removeItem('ge-mid'); localStorage.removeItem('ge-onboard');
  }catch(_){} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  const t0 = Date.now();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#ltf-input', { timeout: 8000 }).catch(() => {});
  const s1 = await page.evaluate(() => ({
    step: document.querySelector('.ob-step.on .ob-step-t')?.textContent.trim(),
    input: !!document.getElementById('ltf-input'),
    signin: !!document.getElementById('ob-signin'),
  }));
  check('onboarding: a signed-out newcomer lands on step 1, the Manager ID', s1.step, 'Your Manager ID');
  check('onboarding: no sign-in prompt before the rating', s1.signin, false);
  await page.fill('#ltf-input', '101');
  await page.click('#ltf-save');
  await page.waitForSelector('#ob-next', { timeout: 10000 }).catch(() => {});
  const s2 = await page.evaluate(() => ({
    step: document.querySelector('.ob-step.on .ob-step-t')?.textContent.trim(),
    stats: document.querySelectorAll('.ob-rating .stat').length,
    signin: !!document.getElementById('ob-signin'),
    text: document.querySelector('.ob-rating')?.textContent || '',
  }));
  check('onboarding: linking moves to step 2, the rating', s2.step, 'Your squad, rated');
  check('onboarding: the rating carries xP, the model XI and a weakest position', s2.stats, 4);
  check('onboarding: still no sign-in prompt on the rating', s2.signin, false);
  await page.click('#ob-next');
  await page.waitForSelector('#ob-go', { timeout: 10000 }).catch(() => {});
  const s3 = await page.evaluate(() => ({
    step: document.querySelector('.ob-step.on .ob-step-t')?.textContent.trim(),
    go: document.getElementById('ob-go')?.textContent.trim() || '',
    signin: !!document.getElementById('ob-signin'),
  }));
  check('onboarding: step 3 is one recommended action', s3.step, 'One thing to do');
  check('onboarding: the action opens a named panel', s3.go, g => /^Open /.test(g));
  check('onboarding: the sign-in prompt appears only now', s3.signin, true);
  check('onboarding: the whole flow ran well inside a minute', Date.now() - t0, ms => ms < 60000);
  await page.click('#ob-go');
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({ done: localStorage.getItem('ge-onboard'), title: document.getElementById('tb-title')?.textContent.trim() }));
  check('onboarding: taking the action finishes the flow', after.done, 'done');
  check('onboarding: and lands on the panel it named', after.title, t => /Transfer Planner|Captaincy Lab|Price Predictor/.test(t));
  check('onboarding: no page errors', errors.length, 0);
  await ctx.close();
}

/* ── everything ── */
{
  const { ctx, page, errors } = await open('expert');
  const s = await shell(page);
  check('everything: same destinations', s.sidebar.join('|'), NAV_LABELS.join('|'));
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
  check('a panel outside the nav tabs is still reachable by URL',
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
  check('and the nav still shows the same destinations', s.sidebar.join('|'), NAV_LABELS.join('|'));
  await ctx.close();
}

/* ── the status board opens Home, for both audiences ──
   Home is not one panel: homePanel() sends a linked manager to My Week and
   an unlinked visitor to the dashboard. The board shipped on one of them
   first and the other rendered nothing, so both are checked here. */
/* WIDTH MATTERS, and one width was not enough. The board was only ever
   driven at 1280. The right rail appears at 1024px and takes 296px out of
   the main column, while the board's cards stay in their 4/8 split until
   900px — so between those two the deadline card gets as little as 165px
   for a four-cell countdown, and the seconds ran off the edge of the card.
   Reported from an iPad. 1024 is the tightest point of that band; 1280 is
   where it was already being checked and must not regress. */
for(const [who, mid] of [['linked', '123456'], ['unlinked', null]]){
 for(const vw of [1024, 1280]){
  const ctx = await b.newContext({ viewport: { width: vw, height: 1500 } });
  await ctx.addInitScript(([m]) => {
    try{
      localStorage.setItem('ge-api-base', 'http://127.0.0.1:8731');
      localStorage.setItem('ge-visited', '1');
      localStorage.setItem('ge-onboard', 'done');
      if(m) localStorage.setItem('ge-mid', m); else localStorage.removeItem('ge-mid');
    }catch(_){}
  }, [mid]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(4500);
  const got = await page.evaluate(() => ({
    board: !!document.querySelector('.sb'),
    cards: document.querySelectorAll('.sb > .card').length,
    team: document.querySelector('.sb-team .sb-t-name')?.textContent.trim() || '',
    cta: document.querySelector('.sb-team .btn')?.textContent.trim() || '',
    days: document.querySelectorAll('.sb-day').length,
    chips: [...document.querySelectorAll('.sb-day .sb-chip')].map(e => e.textContent.trim()),
    clock: document.querySelectorAll('#sb-clock div').length,
    nums: document.querySelectorAll('.sb-n').length,
    /* Nothing on the board may render an ellipsis-truncated number: the
       cells are narrow and a cut-off figure tells the reader nothing. */
    clipped: [...document.querySelectorAll('.sb-n b')]
      .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim()),
    /* The countdown has to fit the card it is drawn in. Measured two ways
       because they fail differently: scrollWidth catches a row that is
       wider than its box, and the last cell's right edge catches one that
       has escaped the card altogether — which is what a reader sees as a
       clipped "SEC". */
    clockOverflow: (() => {
      const c = document.querySelector('.sb-clock');
      return c ? c.scrollWidth - c.clientWidth : 0;
    })(),
    clockEscapes: (() => {
      const card = document.querySelector('.sb-cd');
      const last = [...document.querySelectorAll('.sb-clock div')].pop();
      if(!card || !last) return 0;
      return Math.round(last.getBoundingClientRect().right
        - card.getBoundingClientRect().right);
    })(),
    /* Mono is the numeral face. A player name set in it is both wrong by
       the type rules and wider than it needs to be, which is how "De
       Cuyper" came to be ellipsised in a cell that fits it. */
    nameInMono: [...document.querySelectorAll('.sb-n.is-name b')]
      .filter(e => /Mono|monospace/i.test(getComputedStyle(e).fontFamily))
      .map(e => e.textContent.trim()),
    namedCells: document.querySelectorAll('.sb-n.is-name').length,
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  check(`${who} @${vw}: the status board opens Home`, got.board, true);
  check(`${who} @${vw}: it carries the full set of cards`, got.cards, n => n >= 6);
  check(`${who} @${vw}: the gameweek is broken down by day`, got.days, n => n >= 1);
  check(`${who} @${vw}: every day states where it is`, got.chips.length, got.days);
  check(`${who} @${vw}: the deadline clock has four cells`, got.clock, 4);
  check(`${who} @${vw}: the league-wide numbers render`, got.nums, n => n >= 4);
  check(`${who} @${vw}: no number is cut off`, got.clipped.join('|'), '');
  check(`${who} @${vw}: the countdown fits its card`, got.clockOverflow, 0);
  check(`${who} @${vw}: and no cell escapes the card edge`,
    got.clockEscapes, n => n <= 0);
  check(`${who} @${vw}: the named cells are set in the UI face, not mono`,
    got.nameInMono.join('|'), '');
  check(`${who} @${vw}: and there are named cells to check`,
    got.namedCells, n => n >= 2);
  check(`${who} @${vw}: the board does not scroll the page sideways`, got.hScroll, false);
  check(`${who} @${vw}: Home raises no page error`, errors.join(' | '), '');
  await ctx.close();
 }
}

/* The identity card is the one thing that differs, and it must invite
   rather than sit empty when there is no team to greet. */
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1200 } });
  await ctx.addInitScript(() => {
    try{
      localStorage.setItem('ge-api-base', 'http://127.0.0.1:8731');
      localStorage.setItem('ge-visited', '1');
      localStorage.setItem('ge-onboard', 'done');
      localStorage.removeItem('ge-mid');
    }catch(_){}
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  const got = await page.evaluate(() => ({
    name: document.querySelector('.sb-team .sb-t-name')?.textContent.trim() || '',
    cta: document.querySelector('.sb-team .btn')?.textContent.trim() || '',
  }));
  check('unlinked: the identity card welcomes rather than sitting empty',
    got.name, s => /welcome/i.test(s));
  check('unlinked: and its call to action is to link a team',
    got.cta, s => /link my team/i.test(s));
  await ctx.close();
}

await b.close(); stop();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
