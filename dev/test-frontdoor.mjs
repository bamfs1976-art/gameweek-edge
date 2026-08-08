/*
 * Front-door journey tests — does a first-time visitor get the pitch, and does
 * everybody else get the app?
 *
 * The gate lives in the head of index.html and cannot be unit-tested: it reads
 * localStorage, matchMedia and location, then redirects. So this drives a real
 * browser against a static server that mimics the one netlify.toml rule that
 * matters (/welcome -> landing.html, status 200).
 *
 * Two cases are the ones worth having. "Blocked storage fails open" guards a
 * redirect loop with no escape — private mode cannot record the visit, so a
 * gate that failed closed would bounce forever. "Stripe return never hits the
 * pitch" guards answering a completed payment with a marketing page.
 *
 * Skips (exit 0) when Playwright's browser is not installed, so a checkout
 * without browsers still passes npm test. Set CHROMIUM_PATH to point at a
 * chromium outside node_modules.
 *
 * Run: node dev/test-frontdoor.mjs   (wired into npm test)
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

let chromium;
try{ ({ chromium } = await import('playwright')); }
catch(_){ console.log('· front door: playwright not installed, skipped'); process.exit(0); }

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(REPO, 'www');
/* The gate ships inside index.html, so the test needs the built copy. */
if(!existsSync(join(ROOT, 'index.html'))){
  const r = spawnSync('node', [join(REPO, 'scripts', 'build-web.mjs')], { cwd: REPO, stdio: 'inherit' });
  if(r.status !== 0){ console.error('front door: could not build www/'); process.exit(1); }
}
const TYPES = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv = createServer((req,res)=>{
  let p = req.url.split('?')[0];
  if(p === '/welcome') p = '/landing.html';        // netlify.toml: 200 rewrite
  if(p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p);
  if(!existsSync(f) || !extname(f)){ res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, {'content-type': TYPES[extname(f)] || 'application/octet-stream'});
  res.end(readFileSync(f));
});
await new Promise(r => srv.listen(0, r));
const BASE = 'http://127.0.0.1:' + srv.address().port;

let b;
try{
  b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}catch(err){
  srv.close();
  console.log('· front door: no chromium available, skipped (' + String(err.message).split('\n')[0] + ')');
  process.exit(0);
}
const results = [];
const check = (name, got, want) => {
  const ok = got === want;
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}\n    got ${got}${ok ? '' : `   want ${want}`}`);
};

/* Assert on which document loaded, not on the URL: the app strips ?panel= and
   ?upgrade= from the bar once it has acted on them, so a URL check would mark
   correct behaviour as a failure. */
const where = async (page) => {
  const isApp = await page.evaluate(() => !!document.getElementById('pages'));
  const isLanding = await page.evaluate(() => !!document.querySelector('#features, #pricing'));
  return (isApp ? 'app' : isLanding ? 'landing' : 'unknown') + ' @ ' + new URL(page.url()).pathname;
};

/* Each case gets a fresh context — a fresh device with empty storage. */
const run = async (steps) => {
  const ctx = await b.newContext();
  const page = await ctx.newPage();
  const out = await steps(page, ctx);
  await ctx.close();
  return out;
};
const go = async (page, url) => { await page.goto(BASE + url); await page.waitForTimeout(300); };

check('cold visitor lands on the pitch', await run(async (page) => {
  await go(page, '/'); return where(page);
}), 'landing @ /welcome');

check('second visit goes straight to the app', await run(async (page) => {
  await go(page, '/');                     // bounced to /welcome
  await go(page, '/');                     // back to the root
  return where(page);
}), 'app @ /');

check('returning from /welcome into the app does not bounce back', await run(async (page) => {
  await go(page, '/welcome');
  await go(page, '/');
  return where(page);
}), 'app @ /');

check('Stripe return never hits the pitch', await run(async (page) => {
  await go(page, '/?upgrade=success'); return where(page);
}), 'app @ /');

check('push deep link never hits the pitch', await run(async (page) => {
  await go(page, '/?panel=price'); return where(page);
}), 'app @ /');

check('a linked team skips the pitch', await run(async (page, ctx) => {
  await ctx.addInitScript(() => { try{ localStorage.setItem('ge-mid','12345'); }catch(_){} });
  await go(page, '/'); return where(page);
}), 'app @ /');

check('bookmarked #players reaches the app', await run(async (page) => {
  await go(page, '/#players'); return where(page);
}), 'app @ /');

check('blocked storage fails open into the app', await run(async (page, ctx) => {
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get(){ throw new Error('blocked'); } });
  });
  await go(page, '/'); return where(page);
}), 'app @ /');

check('utm tags are not intent — tagged link still gets the pitch', await run(async (page) => {
  await go(page, '/?utm_source=bluesky'); return where(page);
}), 'landing @ /welcome');

check('the pitch is shown once even if never clicked through', await run(async (page) => {
  await go(page, '/');                     // sees /welcome, closes the tab
  await go(page, '/?utm_source=x');        // comes back from another post
  return where(page);
}), 'app @ /');

await b.close(); srv.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
