// CI guard: static integrity checks for the app shell — the pattern shared
// with pl-bookings' scripts/check-data.mjs. Catches the failure modes a
// syntax check can't: a renamed element id that JS still targets, a service
// worker precaching a file that no longer exists, or a client-side secret
// pattern sneaking back in.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

/* Elements the inline script (and native bridge) target by id. */
const REQUIRED_IDS = [
  'sb-nav', 'bottom-nav', 'pages', 'hamburger', 'overlay',
  'refresh-btn', 'export-btn', 'tb-updated', 'signin-btn', 'acct-btn',
  'theme-toggle', 'gw-num', 'gw-deadline', 'net-banner', 'ptr-spinner'
];
for (const id of REQUIRED_IDS) {
  assert.ok(new RegExp(`id=["']${id}["']`).test(html), `index.html is missing #${id}`);
}

/* Every file the service worker precaches must exist (native.js and auth.js
   are emitted by the build on deploy — allow either on-disk or a known
   build artefact). */
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const shellBlock = sw.match(/const SHELL = \[([\s\S]*?)\]/);
assert.ok(shellBlock, 'sw.js has no SHELL precache list');
const shell = [...shellBlock[1].matchAll(/'(\/[^']+)'/g)].map((m) => m[1]).filter((p) => p !== '/');
const BUILT = new Set(['/native.js', '/auth.js']); // produced by scripts/build-web.mjs / netlify build
for (const p of shell) {
  if (BUILT.has(p)) continue;
  assert.ok(existsSync(join(root, p)), `sw.js precaches ${p} but the file does not exist`);
}

/* Client-side secret patterns must never reappear. */
assert.ok(!/anthropic-dangerous-direct-browser-access/.test(html),
  'index.html contains a direct-browser Anthropic call');
assert.ok(!/x-api-key/.test(html), 'index.html contains an x-api-key header (secrets are server-side only)');
assert.ok(!/sk-ant-/.test(html), 'index.html contains what looks like an Anthropic key');

/* The FPL data must flow through the proxy, never straight to the origin
   (plain-text mentions in help copy are fine; API URLs are not). */
assert.ok(!/https?:\/\/fantasy\.premierleague\.com\/api/.test(html),
  'index.html calls the FPL API origin directly — use the /api/fpl proxy');

console.log(`shell guard OK: ${REQUIRED_IDS.length} ids present, ${shell.length} precache entries checked, no client-side secrets`);
