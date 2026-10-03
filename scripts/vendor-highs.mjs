#!/usr/bin/env node
/* Vendor HiGHS (highs-js) for the exact transfer plan, and prove the bytes.
 *
 *   node scripts/vendor-highs.mjs           # fetch the pinned npm tarball, re-vendor
 *   node scripts/vendor-highs.mjs --check   # verify what is committed (offline)
 *
 * WHAT AND WHY. highs-js (MIT, github.com/lovasoa/highs-js) is the HiGHS
 * mixed-integer solver from the University of Edinburgh compiled to
 * WebAssembly. The exact plan in the Transfer Planner hands it the same
 * problem the beam search approximates (index.html, milpPlanLP).
 *
 *   vendor/highs.js    the loader, wrapped so it defines window.HiGHSLoader
 *                      rather than a page-wide `Module` another script could
 *                      collide with; otherwise verbatim.
 *   vendor/highs.wasm  the solver, verbatim. 3.5 MB, which is why the app
 *                      loads it on demand (loadHighs) and never at start-up.
 *
 * The npm tarball is pinned by version AND by its published sha512
 * integrity, so a re-publish under the same version cannot slip through.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(root, 'scripts', 'vendor-highs.sha256.json');
const PIN = {
  name: 'highs', version: '1.15.3', license: 'MIT',
  tarball: 'https://registry.npmjs.org/highs/-/highs-1.15.3.tgz',
  integrity: 'sha512-5rzjBlAkqRxr7FOv+iZjxF8nNfKsEt8uOaP3S6gls6yRf4+Jv4BqBIE3iPFsgfOHutQBMNxRE9jWhxRAM7Oycw==',
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const HEAD = (hash) => `/* VENDORED — do not edit. highs-js ${PIN.version} (${PIN.license}), build/highs.js,
 * wrapped to define window.HiGHSLoader. Upstream sha256 ${hash}.
 * Re-vendor: node scripts/vendor-highs.mjs   Verify: node scripts/vendor-highs.mjs --check */
(function(){
`;
const TAIL = `
;window.HiGHSLoader=Module;})();
`;

if (process.argv.includes('--check')) {
  if (!existsSync(MANIFEST)) { console.error('vendor-highs: no manifest; run node scripts/vendor-highs.mjs'); process.exit(1); }
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  let bad = 0;
  for (const [f, h] of Object.entries(m.files)) {
    const p = join(root, 'vendor', f);
    if (!existsSync(p)) { console.error('  ✗ vendor/' + f + ' is missing'); bad++; continue; }
    if (sha(readFileSync(p)) !== h) { console.error('  ✗ vendor/' + f + ' differs from the vendored bytes'); bad++; }
  }
  console.log(bad ? `vendor-highs: ${bad} problem(s)` : `vendor-highs: ${Object.keys(m.files).length} files match highs ${m.version}`);
  process.exit(bad ? 1 : 0);
}

const dir = mkdtempSync(join(tmpdir(), 'highs-'));
try {
  const tgz = join(dir, 'highs.tgz');
  const res = await fetch(PIN.tarball);
  if (!res.ok) throw new Error('npm registry answered ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const integrity = 'sha512-' + createHash('sha512').update(buf).digest('base64');
  if (PIN.integrity !== 'PIN_INTEGRITY' && integrity !== PIN.integrity) throw new Error('tarball integrity mismatch: ' + integrity);
  writeFileSync(tgz, buf);
  execFileSync('tar', ['xzf', tgz, '-C', dir]);
  const js = readFileSync(join(dir, 'package', 'build', 'highs.js'));
  const wasm = readFileSync(join(dir, 'package', 'build', 'highs.wasm'));
  const out = HEAD(sha(js)) + js.toString('utf8') + TAIL;
  writeFileSync(join(root, 'vendor', 'highs.js'), out);
  writeFileSync(join(root, 'vendor', 'highs.wasm'), wasm);
  writeFileSync(MANIFEST, JSON.stringify({ version: PIN.version, integrity,
    files: { 'highs.js': sha(Buffer.from(out)), 'highs.wasm': sha(wasm) } }, null, 2) + '\n');
  console.log(`vendored highs ${PIN.version}: highs.js ${out.length} bytes, highs.wasm ${wasm.length} bytes (${integrity})`);
} finally { rmSync(dir, { recursive: true, force: true }); }
