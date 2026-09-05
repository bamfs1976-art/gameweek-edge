/* Assembles the Capacitor web directory (www/).
   - copies the single-file app (index.html) — the one source of truth
   - bundles the native bridge (src/native/index.js) → www/native.js
   Run via: npm run build:web   (cap sync calls this through npm run sync) */

import { build } from 'esbuild';
import { mkdir, copyFile, rm, readdir, stat, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { publishRecord } from './efl/publish-record.mjs';
import { publishRecord as publishFplRecord } from './record/publish-record.mjs';

const ROOT = process.cwd();
const OUT = join(ROOT, 'www');
const EFL_OUT = join(OUT, 'fantasy-efl');

/* Static web assets to copy verbatim into www/. Add to this list as
   the app grows. */
const STATIC_FILES = ['index.html', 'landing.html', 'privacy.html', 'manifest.webmanifest', 'sw.js'];
/* `vendor/` is the rotation signal copied verbatim from the Bookings Desk —
   distinct from www/vendor.js, which is the esbuild bundle below. It is a
   directory of committed source with recorded hashes, so it is copied rather
   than built; scripts/vendor-rotation.mjs owns proving it has not drifted. */
/* `record/` is the public FPL record page; its record.json is written beside
   it by publishFplRecord below, from data/record. */
const STATIC_DIRS = ['icons', 'data', 'vendor', 'record'];

async function clean() {
  if (existsSync(OUT)) await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
}

async function copyStatic() {
  for (const f of STATIC_FILES) {
    if (existsSync(join(ROOT, f))) await copyFile(join(ROOT, f), join(OUT, f));
  }
  /* Copy static asset folders (icons, etc.) into www/. */
  for (const d of STATIC_DIRS) {
    const src = join(ROOT, d);
    if (existsSync(src)) await copyDir(src, join(OUT, d));
  }
}

async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src)) {
    const s = join(src, entry), d = join(dest, entry);
    if ((await stat(s)).isDirectory()) await copyDir(s, d);
    else await copyFile(s, d);
  }
}

async function bundleNative() {
  await build({
    entryPoints: [join(ROOT, 'src/native/index.js')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2019'],
    outfile: join(OUT, 'native.js')
  });
}

/* Third-party runtime libraries — uPlot, Fuse.js and tinykeys.

   index.html is copied verbatim rather than bundled, so the inline script
   cannot import anything. This is the seam: one esbuild pass turns
   src/vendor/index.js into www/vendor.js (globals on `window`) and, because
   the entry imports uPlot's stylesheet, www/vendor.css alongside it.

   Bundled rather than pulled from a CDN so the shell keeps working offline,
   the service worker can precache it, and the exact versions are pinned by
   package-lock.json instead of by somebody else's edge cache. */
async function bundleVendor() {
  await build({
    entryPoints: [join(ROOT, 'src/vendor/index.js')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2019'],
    loader: { '.css': 'css' },
    outfile: join(OUT, 'vendor.js')
  });
}

async function bundleAuth() {
  await build({
    entryPoints: [join(ROOT, 'src/auth/index.js')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2019'],
    outfile: join(OUT, 'auth.js')
  });
}

/* Fantasy EFL: a second app on the same origin — one session, one
   subscription, one domain.

   It borrows no code from index.html. Fantasy EFL has no prices, no budget
   and no transfers, so the FPL optimiser and the expected-points model have
   nothing to say about it; it carries its own small, separate scoring
   models in efl/app/assets/model.js.

   It is also a MULTI-PAGE app rather than a single shell: six routes, six
   real HTML files, each with its own title, description and canonical URL.
   That is a copy of a directory tree, not a bundle — which is why this is
   `copyDir` and not an esbuild call. `efl/package.json` marks the source as
   ESM for Node (so dev/test-efl.mjs can import the models directly) and
   lives OUTSIDE efl/app, so it is never copied into the deploy. */
async function buildEfl() {
  await copyDir(join(ROOT, 'efl/app'), EFL_OUT);
  /* The season ledger lives in efl/data as one file per round, carrying
     everything needed to re-grade a round years later. The site gets a
     projection of it — picks, points, baselines — built here so the page
     and the ledger can never disagree: the page has no second source. */
  const record = await publishRecord(join(EFL_OUT, 'data'));
  return { files: await countFiles(join(ROOT, 'efl/app')) + 1, record };
}

/* www/version.json — the build stamp the running app checks itself against.

   The web app is a single HTML file held open for days at a time: an
   installed PWA resumed from the home screen is not a fresh navigation, so
   the service worker (network-first on the shell) is never asked, and a
   deploy can sit on the server for a week while the phone keeps running
   last Tuesday's code. That looks exactly like a feature that has gone
   missing, because from the user's side it is one.

   The stamp is a HASH OF WHAT SHIPS, not a timestamp. A rebuild that
   changes nothing must not nag anybody to reload, and two builds of the
   same commit must agree. Only the files that ARE the app are hashed —
   icons and data change on their own schedule and reloading for them
   would be noise. */
const APP_FILES = ['index.html', 'native.js', 'auth.js', 'vendor.js', 'vendor.css'];

async function writeVersion() {
  const h = createHash('sha256');
  for (const f of APP_FILES) {
    const p = join(OUT, f);
    if (existsSync(p)) h.update(await readFile(p));
  }
  const stamp = h.digest('hex').slice(0, 12);
  await writeFile(join(OUT, 'version.json'), JSON.stringify({ build: stamp }) + '\n');
  return stamp;
}

async function countFiles(dir) {
  let n = 0;
  for (const entry of await readdir(dir)) {
    const p = join(dir, entry);
    n += (await stat(p)).isDirectory() ? await countFiles(p) : 1;
  }
  return n;
}

await clean();
await copyStatic();
await bundleNative();
await bundleAuth();
await bundleVendor();
const efl = await buildEfl();
/* The FPL ledger's public projection, next to the page that reads it. */
const fplRecord = await publishFplRecord(join(OUT, 'record'));
console.log(`✓ FPL record → www/record/record.json (${fplRecord.gameweeks} gameweek(s), ${fplRecord.graded} graded)`);
const stamp = await writeVersion();
console.log('✓ Built www/ (index.html + native.js + auth.js + vendor.js/.css)');
console.log(`✓ Build stamp ${stamp} → www/version.json`);
console.log(`✓ Built www/fantasy-efl/ (Fantasy EFL — ${efl.files} files, 6 routes, `
  + `${efl.record.rounds} recorded round(s), ${efl.record.graded} graded)`);
