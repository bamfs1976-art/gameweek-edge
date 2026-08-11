/* Assembles the Capacitor web directory (www/).
   - copies the single-file app (index.html) — the one source of truth
   - bundles the native bridge (src/native/index.js) → www/native.js
   Run via: npm run build:web   (cap sync calls this through npm run sync) */

import { build } from 'esbuild';
import { mkdir, copyFile, rm, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractEngine, unresolvedReferences } from './extract-engine.mjs';
import { publishRecord } from './efl/publish-record.mjs';

const ROOT = process.cwd();
const OUT = join(ROOT, 'www');
/* Euro Matchday Edge is a second app, but NOT a second site. It ships at
   /euro/ on this same origin, and that is load-bearing rather than tidy:
   the Supabase session lives in localStorage, which is scoped per origin, so
   two domains would mean signing in twice and a Pro subscription that looks
   absent on the app you did not buy it from. One origin makes "one account,
   one subscription, both games" true in the browser and not just in the
   database. */
const EURO_OUT = join(OUT, 'euro');
/* Fantasy EFL is a third app on this same origin, for the same
   session-and-subscription reason as Euro Matchday Edge above. It ships at
   /fantasy-efl/ rather than /efl/ because the path is also the page's URL
   in a search result, and "fantasy-efl" says what it is. */
const EFL_OUT = join(OUT, 'fantasy-efl');

/* Static web assets to copy verbatim into www/. Add to this list as
   the app grows. */
const STATIC_FILES = ['index.html', 'landing.html', 'privacy.html', 'manifest.webmanifest', 'sw.js'];
const STATIC_DIRS = ['icons', 'data'];

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

/* Euro Matchday Edge: its own shell, plus the shared model engine lifted out
   of index.html at build time. The engine is never copied into the euro/
   source — index.html stays the single source of truth for the model,
   because that is the file the test suite grades. */
async function buildEuro() {
  await copyDir(join(ROOT, 'euro/app'), EURO_OUT);
  const engine = extractEngine(join(ROOT, 'index.html'));
  /* A model change in index.html can add a callee the extraction list does
     not know about. The bundle still parses and still loads; it throws the
     first time a projection is asked for. Fail the build instead — a broken
     deploy of the second app must not be the way anyone finds out. */
  const missing = unresolvedReferences(engine);
  if (missing.length) {
    throw new Error(
      'Shared engine references ' + missing.length + ' name(s) it does not define: ' +
      missing.join(', ') + '.\nAdd them to ENGINE_FNS/ENGINE_CONSTS in ' +
      'scripts/extract-engine.mjs — they are almost certainly helpers a model ' +
      'function in index.html started calling.');
  }
  await writeFile(join(EURO_OUT, 'engine.js'), engine, 'utf8');
  return engine.length;
}

/* Fantasy EFL: a third app on the same origin, for the same reason the
   second one is here — one session, one subscription, one domain.

   Unlike Euro Matchday Edge it borrows no code from index.html. Fantasy EFL
   has no prices, no budget and no transfers, so the FPL optimiser and the
   expected-points model have nothing to say about it; it carries its own
   small, separate scoring models in efl/app/assets/model.js.

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
const engineBytes = await buildEuro();
const efl = await buildEfl();
console.log('✓ Built www/ (index.html + native.js + auth.js)');
console.log(`✓ Built www/euro/ (Euro Matchday Edge + ${(engineBytes / 1024).toFixed(0)}kB shared engine)`);
console.log(`✓ Built www/fantasy-efl/ (Fantasy EFL — ${efl.files} files, 6 routes, `
  + `${efl.record.rounds} recorded round(s), ${efl.record.graded} graded)`);
