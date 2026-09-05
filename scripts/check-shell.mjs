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
for (const name of ['SHELL', 'EFL_SHELL', 'ROTATION']) {
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

/* The fixtures cache is keyed per game through ck(); a bare MEM.fixtures
   read finds nothing and the ticker then calls a live gameweek "result
   settling". Read it through cachedPeek. */
assert.ok(!/MEM\.fixtures\b/.test(html.replace(/\/\*[\s\S]*?\*\//g, '')),
  'index.html reads MEM.fixtures directly — use cachedPeek(\'fixtures\', FIXTURES_TTL)');

/* Client-side secret patterns must never reappear. */
assert.ok(!/anthropic-dangerous-direct-browser-access/.test(html),
  'index.html contains a direct-browser Anthropic call');
assert.ok(!/x-api-key/.test(html), 'index.html contains an x-api-key header (secrets are server-side only)');
assert.ok(!/sk-ant-/.test(html), 'index.html contains what looks like an Anthropic key');

/* The FPL data must flow through the proxy, never straight to the origin
   (plain-text mentions in help copy are fine; API URLs are not). */
assert.ok(!/https?:\/\/fantasy\.premierleague\.com\/api/.test(html),
  'index.html calls the FPL API origin directly — use the /api/fpl proxy');

/* ── No two top-level consts may share a name ──────────────────────
   The whole app is one <script> block. Two top-level `const X` in it is a
   SyntaxError, and a SyntaxError there is not a degraded feature — nothing
   runs at all, on every page.

   Nothing caught this. The unit suites extract individual functions into a
   vm, so they never parse the file as a whole and stayed green while the
   shipped page was dead. It happened for real: a helper was hoisted to a
   global called CHIP_LABEL without noticing the chip planner already had a
   top-level CHIP_LABEL of its own, keyed by different strings. The browser
   suite would have found it, but the browser suite is not what runs on every
   commit — this is.

   Only same-line `const NAME=` at column zero is considered, which is how
   every top-level binding in this file is written. Indented declarations are
   inside functions and may legitimately shadow. */
{
  const seen = new Map();
  const dupes = [];
  const re = /^const ([A-Za-z_$][\w$]*)\s*=/gm;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1];
    const line = html.slice(0, m.index).split('\n').length;
    if (seen.has(name)) dupes.push(`${name} (lines ${seen.get(name)} and ${line})`);
    else seen.set(name, line);
  }
  assert.ok(dupes.length === 0,
    'duplicate top-level const in index.html — this is a SyntaxError and the app will not run: ' + dupes.join(', '));
  console.log(`  ${seen.size} top-level consts, no duplicate names`);
}

/* ── The card-ban ladder lives in vendor/, never here ──────────────
   The 5 / 10 / 15 cautions rule, gated at matches 19 and 32, is vendored
   from pl-bookings (scripts/vendor-suspension.mjs) and read through
   PLDCore.nextSuspension. index.html once carried its own copy, and the
   push sender a third; a threshold typed here again is a second rule
   waiting to disagree with the first. Comments are stripped first so prose
   about the rule cannot trip it, and the rule's own explanation above
   stays readable. */
{
  const code = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
  const banned = [
    [/\bgw\s*<=\s*19\s*\?/, 'gw<=19 ? … — the GW19 gate typed by hand'],
    [/\bgw\s*<=\s*32\s*\?/, 'gw<=32 ? … — the GW32 gate typed by hand'],
    [/\{\s*limit\s*:\s*(5|10|15)\b/, '{limit:5|10|15 — a caution threshold typed by hand'],
    [/\blimit\s*:\s*(5|10|15)\s*,\s*by\s*:/, 'limit:N, by:M — the ladder typed by hand'],
    [/yellow_cards\s*(\|\|\s*0\s*)?\)?\s*===?\s*(4|9|14)\b/, 'yellow_cards === 4|9|14 — "one from a ban" typed by hand'],
  ];
  for (const [re, why] of banned) {
    const m = code.match(re);
    assert.ok(!m, 'index.html carries a hard-coded suspension threshold (' + why + '): ' +
      JSON.stringify(m && m[0]) + '. Read it through PLDCore.nextSuspension and GE_SUSPENSION instead.');
  }
  for (const need of ['vendor/suspension_core.js', 'vendor/suspension_scheme.js', 'vendor/suspension.js']) {
    assert.ok(new RegExp('<script src="' + need.replace('.', '\\.') + '"').test(html),
      'index.html no longer loads ' + need + ' — the suspension rule would be undefined at runtime');
  }
  assert.ok(/\.nextSuspension\(/.test(code), 'index.html no longer calls PLDCore.nextSuspension — the ladder is not the vendored one');
  assert.ok(/GE_SUSPENSION/.test(code), 'index.html no longer reads GE_SUSPENSION — the ladder is not the vendored scheme');
  console.log('  suspension ladder: no hard-coded threshold, vendored rule loaded and called');
}

console.log(`shell guard OK: ${REQUIRED_IDS.length} ids present, ${shellPaths.length} precache entries checked, no client-side secrets`);
