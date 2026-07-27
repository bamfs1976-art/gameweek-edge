/* Matchday Edge — build.
 *
 * Assembles ucl/dist/ from:
 *   app/           this site's own shell, styles and panels
 *   ../index.html  the shared model engine, lifted out at build time
 *
 * The engine is NOT copied into this directory and never should be. Gameweek
 * Edge's index.html is the single source of truth for the model, because that
 * is the file the test suite grades; a copy here would drift the moment
 * anyone improved the minutes model on the other side.
 *
 * Deliberately dependency-free so the second Netlify site needs no install
 * step of its own.
 *
 * Run: node build.mjs   (from ucl/, which is what netlify.toml does)
 */
import { mkdir, rm, copyFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractEngine } from '../scripts/extract-engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, 'app');
const OUT = join(HERE, 'dist');
const PARENT_INDEX = join(HERE, '..', 'index.html');

async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src)) {
    const s = join(src, entry), d = join(dest, entry);
    if ((await stat(s)).isDirectory()) await copyDir(s, d);
    else await copyFile(s, d);
  }
}

if (!existsSync(PARENT_INDEX)) {
  throw new Error(
    'Cannot find ../index.html. Matchday Edge builds the shared model engine ' +
    'out of Gameweek Edge, so it must be built from inside the full repo — ' +
    'set the Netlify site\'s base directory to `ucl`, not its repository to a subtree.'
  );
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await copyDir(APP, OUT);

const engine = extractEngine(PARENT_INDEX);
await writeFile(join(OUT, 'engine.js'), engine, 'utf8');

console.log('✓ Built ucl/dist/ (app shell + ' + (engine.length / 1024).toFixed(0) + 'kB shared engine)');
