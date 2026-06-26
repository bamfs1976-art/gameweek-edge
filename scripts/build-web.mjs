/* Assembles the Capacitor web directory (www/).
   - copies the single-file app (index.html) — the one source of truth
   - bundles the native bridge (src/native/index.js) → www/native.js
   Run via: npm run build:web   (cap sync calls this through npm run sync) */

import { build } from 'esbuild';
import { mkdir, copyFile, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'www');

/* Static web assets to copy verbatim into www/. Add to this list as
   the app grows. */
const STATIC_FILES = ['index.html', 'landing.html', 'manifest.webmanifest', 'sw.js'];
const STATIC_DIRS = ['icons'];

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

await clean();
await copyStatic();
await bundleNative();
await bundleAuth();
console.log('✓ Built www/ (index.html + native.js + auth.js)');
