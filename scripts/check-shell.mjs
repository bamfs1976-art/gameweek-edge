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
  'theme-toggle', 'gw-num', 'gw-deadline', 'net-banner', 'ptr-spinner',
  /* Feedback: the button, the dialog, and the three elements the submit path
     writes into. #fb-err is the one that carries a failure the user must see,
     so losing it would turn a failed send into a silent one. */
  'feedback-btn', 'fb-modal', 'fb-text', 'fb-err', 'fb-send'
];
for (const id of REQUIRED_IDS) {
  assert.ok(new RegExp(`id=["']${id}["']`).test(html), `index.html is missing #${id}`);
}

/* Every file the service worker precaches must exist (native.js and auth.js
   are emitted by the build on deploy — allow either on-disk or a known
   build artefact). */
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
/* SHELL spreads EFL_SHELL rather than inlining fifteen more strings, so both
   arrays are read. A list this check cannot see is a list it cannot guard,
   which is worse than a slightly longer regex. */
const shell = [];
for (const name of ['SHELL', 'EFL_SHELL']) {
  const block = sw.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`));
  assert.ok(block, `sw.js has no ${name} precache list`);
  shell.push(...[...block[1].matchAll(/'(\/[^']*)'/g)].map((m) => m[1]));
}
const shellPaths = [...new Set(shell)].filter((p) => p !== '/');
// Produced by scripts/build-web.mjs, so they exist in www/ but not in the repo.
const BUILT = new Set(['/native.js', '/auth.js', '/vendor.js', '/vendor.css']);
/* Fantasy EFL is copied verbatim from efl/app/ into www/fantasy-efl/, so
   every precached path DOES have a source file — it just lives at a
   different prefix. Check it there rather than exempting it: a renamed
   module is exactly the failure this file exists to catch, and adding the
   prefix to BUILT would have hidden it. Directory routes map to the
   index.html inside them, which is how Netlify serves them. */
const EFL_PREFIX = '/fantasy-efl/';
for (const p of shellPaths) {
  if (BUILT.has(p)) continue;
  if (p.startsWith(EFL_PREFIX)) {
    const rel = p.slice(EFL_PREFIX.length);
    const src = join(root, 'efl', 'app', rel.endsWith('/') || rel === '' ? rel + 'index.html' : rel);
    assert.ok(existsSync(src), `sw.js precaches ${p} but efl/app has no ${rel || 'index.html'}`);
    continue;
  }
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

console.log(`shell guard OK: ${REQUIRED_IDS.length} ids present, ${shellPaths.length} precache entries checked, no client-side secrets`);
