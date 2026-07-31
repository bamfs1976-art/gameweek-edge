/*
 * Every package a script imports must be declared in package.json.
 *
 * This exists because the Daily Content workflow failed silently for four
 * consecutive days on exactly this. `scripts/content/render.mjs` imports
 * playwright; playwright was present in the local node_modules — installed
 * by hand at some point and never saved — so it worked on the machine it
 * was written on and every test passed. In CI, `npm ci` installs strictly
 * from the lockfile, playwright was not in it, and the render step died
 * with ERR_MODULE_NOT_FOUND.
 *
 * Nothing in the test suite could have caught that: the code was correct.
 * The defect was in what the repo *declared*, and only a check that reads
 * package.json rather than node_modules can see it.
 *
 * Run: node scripts/check-deps.mjs   (wired into npm test and CI)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { builtinModules } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['scripts', 'dev', 'netlify'];
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
  ...Object.keys(pkg.peerDependencies || {})
]);
const builtin = new Set(builtinModules);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    /* This file's self-test fixtures are literal import statements, so
       scanning it would report its own deliberately-fake packages. It
       imports nothing but builtins, so there is nothing to miss. */
    else if (/\.(mjs|js|cjs)$/.test(name) && name !== 'check-deps.mjs') out.push(p);
  }
  return out;
}

/* Comments are stripped; string CONTENTS are not. The specifier is itself a
   string literal, so blanking strings would delete the only thing this
   check needs to read — which is precisely what the first version of this
   file did, and it duly reported "0 imports, all declared" across the whole
   repo. A guard that passes vacuously is worse than no guard, so the
   self-test at the bottom makes the scanner prove it can still see.

   Strings are still walked rather than skipped, so that an apostrophe or a
   quote inside a comment cannot open a phantom string and swallow the rest
   of the file. */
function stripComments(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += q; i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') { out += src[i]; i++; }
        out += src[i]; i++;
      }
      out += q; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

const IMPORT = /(?:^|[\s;{(])(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|(?:^|[^\w.])require\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;{(=])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const missing = [];
let scanned = 0, imports = 0;
for (const dir of DIRS) {
  let files = [];
  try { files = walk(join(ROOT, dir)); } catch (_) { continue; }
  for (const file of files) {
    scanned++;
    const src = stripComments(readFileSync(file, 'utf8'));
    let m;
    IMPORT.lastIndex = 0;
    while ((m = IMPORT.exec(src))) {
      const spec = m[1] || m[2] || m[3];
      if (!spec) continue;
      imports++;
      if (spec.startsWith('.') || spec.startsWith('/')) continue;          /* relative */
      if (spec.startsWith('node:')) continue;                              /* explicit builtin */
      /* Scoped packages keep two segments, plain ones keep one: the rest
         is a subpath export and is not a package name. */
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (builtin.has(name)) continue;
      if (declared.has(name)) continue;
      missing.push({ file: relative(ROOT, file), name });
    }
  }
}

/* The scanner must prove it can see. A silent zero is the failure mode this
   file is for: an import scanner that matches nothing reports every repo as
   clean, including the one that is broken. */
const SELF = [
  ["import { chromium } from 'playwright';", 'playwright'],
  ['const x = require("ffmpeg-static");', 'ffmpeg-static'],
  ["const m = await import('sharp');", 'sharp'],
  ["import { readFileSync } from 'node:fs';", null],
  ["import { x } from './local.mjs';", null],
  ["import sub from '@scope/pkg/deep/path.js';", '@scope/pkg'],
  ["/* a comment that says import x from 'ghost' */", null],
  ["// import y from 'ghost'", null]
];
for (const [src, want] of SELF) {
  IMPORT.lastIndex = 0;
  const m = IMPORT.exec(stripComments(src));
  const spec = m ? (m[1] || m[2] || m[3]) : null;
  const got = spec && !spec.startsWith('.') && !spec.startsWith('node:')
    ? (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
    : null;
  if (got !== want) {
    console.error('✗ check-deps is broken: ' + JSON.stringify(src) +
      ' → ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want));
    process.exit(1);
  }
}
if (!imports) {
  console.error('✗ check-deps found no imports at all across ' + scanned +
    ' files — the scanner is broken, not the repo.');
  process.exit(1);
}

if (missing.length) {
  console.error('✗ imported but not declared in package.json:\n');
  for (const { file, name } of missing) console.error('  ' + name + '  ← ' + file);
  console.error('\nThese resolve on a machine where they happen to be installed and fail\n' +
    'under `npm ci`, which installs only what the lockfile declares.');
  process.exit(1);
}

console.log('check-deps: ' + imports + ' imports across ' + scanned + ' files, all declared');
