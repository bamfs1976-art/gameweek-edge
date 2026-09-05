#!/usr/bin/env node
/* Vendor the suspension rule from the Bookings Desk — and prove the bytes.
 *
 *   node scripts/vendor-suspension.mjs                 # fetch from source, re-vendor
 *   node scripts/vendor-suspension.mjs --check         # verify what is committed (offline)
 *   node scripts/vendor-suspension.mjs --check --remote # re-fetch and fail if drifted
 *
 * WHAT IS VENDORED AND WHY. The card-ban ladder — five cautions by the club's
 * 19th league match is one game, ten by the 32nd is two, fifteen at any point
 * is three — used to live in this repo THREE times: once in index.html, once
 * in push-cron.js, and once, differently, in the sibling repo whose whole
 * subject is bookings. Three copies of a rule are three chances for one of
 * them to be wrong, and the wrong one shows a plausible list of the wrong
 * players rather than an error.
 *
 * So the rule is not written here any more. It is copied, byte for byte,
 * from bamfs1976-art/pl-bookings at a pinned commit:
 *
 *   vendor/suspension.js        assets/suspension.js, verbatim — PLDSuspension,
 *                               the watch strip built on the rule.
 *   vendor/suspension_core.js   THREE FUNCTIONS sliced verbatim out of
 *                               assets/core.js — pCardsAtLeast, suspensionCycle,
 *                               nextSuspension — and nothing else. core.js is
 *                               108kB of desk logic this app has no use for;
 *                               the slices are the rule, and each is the exact
 *                               bytes of the upstream function.
 *   vendor/suspension_scheme.js the Premier League ladder itself, the SUSPENSION
 *                               literal from data/pl_data.js, verbatim, exported
 *                               as GE_SUSPENSION so index.html never spells a
 *                               threshold. scripts/check-shell.mjs fails the
 *                               build if it starts to.
 *
 * WHY A SLICE IS STILL VENDORING. The hash recorded for suspension_core.js is
 * of the generated payload, and --check --remote re-fetches core.js, re-slices
 * it with the same brace matcher the engine extractor uses, and fails if the
 * result differs. A hand edit here or an upstream change to the rule both
 * show up; a change elsewhere in core.js does not, which is the point.
 *
 * The provenance header, the payload() split and the manifest layout are the
 * same as scripts/vendor-rotation.mjs, so anyone who has read one has read
 * both.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sliceBalanced } from './extract-engine.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(root, 'vendor');
const MANIFEST = join(root, 'scripts', 'vendor-suspension.sha256.json');

const check = process.argv.includes('--check');
const remote = process.argv.includes('--remote');

/* Pinned to a commit on main. */
const SOURCE = {
  owner: 'bamfs1976-art',
  repo: 'pl-bookings',
  commit: '34bba4cd8978e0dc9df1327baad8dccee4e71ffd',
  branch: 'main',
};
const RAW = 'https://raw.githubusercontent.com/' + SOURCE.owner + '/' + SOURCE.repo + '/';

/* The three upstream functions, in the order they must be defined. */
const CORE_FUNCTIONS = ['pCardsAtLeast', 'suspensionCycle', 'nextSuspension'];

const FILES = [
  {
    id: 'suspension',
    from: 'assets/suspension.js',
    to: 'suspension.js',
    what: 'the watch — PLDSuspension.rows / render / header, verbatim',
    build: (src) => src,
  },
  {
    id: 'suspension-core',
    from: 'assets/core.js',
    to: 'suspension_core.js',
    what: 'the rule — PLDCore.pCardsAtLeast, suspensionCycle and nextSuspension, sliced verbatim from core.js',
    build: buildCore,
  },
  {
    id: 'suspension-scheme',
    from: 'data/pl_data.js',
    to: 'suspension_scheme.js',
    what: 'the Premier League ladder — the SUSPENSION literal from pl_data.js, verbatim, as GE_SUSPENSION',
    build: buildScheme,
  },
];

function sha256(s) { return createHash('sha256').update(s, 'utf8').digest('hex'); }

/* ── the slices ──────────────────────────────────────────────────────── */

/* A named `function name(` inside core.js, brace-matched, with the JSDoc-style
   block comment immediately above it carried along: the comment is the
   upstream author's statement of what the rule is, and it belongs with the
   bytes it describes. */
function sliceFn(src, name) {
  const idx = src.indexOf('  function ' + name + '(');
  if (idx < 0) throw new Error('core.js no longer defines ' + name + '()');
  /* Walk back over the comment block that ends directly above it, if any:
     the source up to the function, trailing whitespace dropped, ends in a
     comment closer, and no blank line separates the two. */
  let start = idx;
  const before = src.slice(0, idx).replace(/\s+$/, '');
  if (before.endsWith('*/') && !/\n\s*\n\s*$/.test(src.slice(before.length, idx))) {
    const open = before.lastIndexOf('/*');
    if (open >= 0) start = src.lastIndexOf('\n', open) + 1;
  }
  const fn = sliceBalanced(src, idx);
  return src.slice(start, idx) + fn;
}

function buildCore(src) {
  const parts = CORE_FUNCTIONS.map((n) => sliceFn(src, n));
  return [
    '(function (root) {',
    "  'use strict';",
    '',
    ...parts.map((p) => p.replace(/\s+$/, '')).join('\n\n').split('\n'),
    '',
    '  /* Merged onto an existing PLDCore rather than replacing it, so a page',
    '     that carries the full desk core still gets one object. */',
    '  var C = root.PLDCore || (root.PLDCore = {});',
    ...CORE_FUNCTIONS.map((n) => '  C.' + n + ' = ' + n + ';'),
    "})(typeof window !== 'undefined' ? window : globalThis);",
    '',
  ].join('\n');
}

function buildScheme(src) {
  const m = src.match(/^const SUSPENSION = (\{[^\n]*\});?$/m);
  if (!m) throw new Error('pl_data.js no longer carries a one-line SUSPENSION literal');
  return [
    '/* The rule, as data. Consumed by PLDCore.nextSuspension(cards, played, GE_SUSPENSION). */',
    'var GE_SUSPENSION = ' + m[1] + ';',
    "if (typeof window !== 'undefined') window.GE_SUSPENSION = GE_SUSPENSION;",
    '',
  ].join('\n');
}

/* ── the provenance header ───────────────────────────────────────────── */
const HEAD_END = ' * ── end vendored header ──';

function header(f, hash, fetched) {
  return [
    '/* VENDORED — do not edit this file.',
    ' *',
    ' * ' + f.what,
    ' *',
    ' * source   ' + SOURCE.owner + '/' + SOURCE.repo + '  ' + f.from,
    ' * commit   ' + SOURCE.commit,
    ' * branch   ' + SOURCE.branch,
    ' * sha256   ' + hash,
    ' * fetched  ' + fetched,
    ' *',
    ' * Re-vendor with: node scripts/vendor-suspension.mjs',
    ' * Verify with:    node scripts/vendor-suspension.mjs --check',
    HEAD_END,
    ' */',
    '',
  ].join('\n');
}

function payload(text) {
  const i = text.indexOf(HEAD_END);
  if (i === -1) return text;
  const j = text.indexOf('\n', i);
  const k = text.indexOf('\n', j + 1);
  return text.slice(k + 1);
}

function localPath(f) { return join(VENDOR, f.to); }
function readLocal(f) {
  const p = localPath(f);
  if (!existsSync(p)) throw new Error('vendor/' + f.to + ' is missing. Run: node scripts/vendor-suspension.mjs');
  return readFileSync(p, 'utf8');
}

/* The source: a local checkout when PL_BOOKINGS_DIR points at one (it must be
   at the pinned commit), otherwise the raw file at the pinned commit. */
async function fetchSource(f) {
  const dir = process.env.PL_BOOKINGS_DIR;
  if (dir) {
    const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (head !== SOURCE.commit) {
      throw new Error('PL_BOOKINGS_DIR is at ' + head.slice(0, 12) + ' but this script pins ' +
        SOURCE.commit.slice(0, 12) + ' — check out the pinned commit or move the pin deliberately');
    }
    return readFileSync(join(dir, f.from), 'utf8');
  }
  const url = RAW + SOURCE.commit + '/' + f.from;
  const r = await fetch(url, { headers: { 'user-agent': 'gameweek-edge/vendor-suspension' } });
  if (!r.ok) throw new Error('fetching ' + f.from + ' at ' + SOURCE.commit.slice(0, 12) + ' returned HTTP ' + r.status + '\n  ' + url);
  return await r.text();
}

function readManifest() {
  if (!existsSync(MANIFEST)) {
    throw new Error('scripts/vendor-suspension.sha256.json is missing. Run: node scripts/vendor-suspension.mjs');
  }
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

async function doVendor() {
  mkdirSync(VENDOR, { recursive: true });
  const fetched = new Date().toISOString().slice(0, 10);
  const man = { commit: SOURCE.commit, branch: SOURCE.branch, files: {} };
  for (const f of FILES) {
    const src = await fetchSource(f);
    const body = f.build(src);
    const hash = sha256(body);
    writeFileSync(localPath(f), header(f, hash, fetched) + body);
    man.files[f.id] = { from: f.from, to: 'vendor/' + f.to, sha256: hash, sourceSha256: sha256(src), fetched };
    console.log('vendored ' + f.from + ' → vendor/' + f.to + '  ' + hash.slice(0, 12));
  }
  writeFileSync(MANIFEST, JSON.stringify(man, null, 2) + '\n');
}

async function doCheck() {
  const man = readManifest();
  let bad = 0;
  if (man.commit !== SOURCE.commit) {
    console.error('the manifest was written against ' + man.commit + ' but this script pins ' + SOURCE.commit);
    bad++;
  }
  for (const f of FILES) {
    const text = readLocal(f);
    const got = sha256(payload(text));
    const rec = man.files && man.files[f.id];
    if (!rec) { console.error('no recorded hash for ' + f.id); bad++; continue; }
    if (got !== rec.sha256) {
      console.error(f.id + ' (vendor/' + f.to + ') does not match the recorded sha256.\n' +
        '  recorded ' + rec.sha256 + '\n  on disk   ' + got + '\n' +
        '  Vendored code is a copy of somebody else\'s rule, byte for byte. Fix it upstream ' +
        'and re-run: node scripts/vendor-suspension.mjs');
      bad++;
      continue;
    }
    for (const need of [SOURCE.commit, rec.sha256, f.from]) {
      if (!text.includes(need)) { console.error(f.id + ' provenance header does not carry "' + need + '"'); bad++; }
    }
  }
  /* The slices must still BE the rule: load them and hold the ladder to the
     figures the brief names — 5, 10, 15; gated at 19 and 32; two matches at
     ten. This is the one place those numbers may appear in this repository. */
  try {
    const ctx = {};
    const run = (code) => new Function('window', code)(ctx);
    run(payload(readLocal(FILES[1])));
    run(payload(readLocal(FILES[2])));
    const C = ctx.PLDCore, S = ctx.GE_SUSPENSION;
    const at = (cards, played) => C.nextSuspension(cards, played, S);
    const expect = (cond, msg) => { if (!cond) { console.error('rule check failed: ' + msg); bad++; } };
    expect(S && S.kind === 'ladder', 'the Premier League scheme is a ladder');
    expect(at(0, 0).at === 5 && at(0, 0).by === 19 && at(0, 0).ban === 1, 'first rung: 5 by match 19, one match');
    expect(at(4, 10).need === 1, 'four cautions at match 10 is one from a ban');
    expect(at(4, 19).at === 10 && at(4, 19).by === 32 && at(4, 19).ban === 2, 'the gate at 19 kills the 5-rung; next is 10 by 32, two matches');
    expect(at(9, 31).need === 1 && at(9, 31).ban === 2, 'nine at match 31 is one from a two-match ban');
    expect(at(9, 32).at === 15 && at(9, 32).by == null && at(9, 32).ban === 3, 'the gate at 32 kills the 10-rung; fifteen is ungated, three matches');
    expect(at(15, 38).dead === true, 'fifteen cautions: no rung left');
    expect(at(null, 5) === null, 'no count is not a count of zero');
  } catch (e) { console.error('the vendored rule did not load: ' + e.message); bad++; }

  if (remote) {
    for (const f of FILES) {
      const want = payload(readLocal(f));
      const there = f.build(await fetchSource(f));
      if (there !== want) {
        console.error(f.id + ' has drifted from ' + SOURCE.owner + '/' + SOURCE.repo + ' ' + f.from +
          ' at ' + SOURCE.commit.slice(0, 12) + '. Re-run: node scripts/vendor-suspension.mjs');
        bad++;
      }
    }
  }
  if (bad) process.exit(1);
  console.log('vendor-suspension --check OK: ' + FILES.length + ' files at ' + SOURCE.commit.slice(0, 7) +
    ', every sha256 matching, ladder 5/10/15 gated at 19 and 32' + (remote ? ', source unchanged' : ''));
}

(check ? doCheck() : doVendor()).catch((e) => { console.error(e.message); process.exit(1); });
