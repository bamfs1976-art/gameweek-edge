/* UI copy guard.

   The house rule is no em dashes in anything a reader sees. The copy was
   rewritten to zero, so the ratchet is now a ban: it counts the em dashes
   that reach the DOM (string literals in the app script and text in the
   markup, never comments) and fails on the first one. A missing value in a
   table cell is an en dash, never an em dash.

     node scripts/check-copy.mjs            # fail if the count rose
     node scripts/check-copy.mjs --report   # print the count and exit 0

   A lone '—' used as a null placeholder is counted too: use '–'. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const report = process.argv.includes('--report');

/* Ratchet baseline: the count on the day the guard landed. Lower it when
   copy is rewritten; never raise it. */
export const BASELINE = { 'index.html': 0, 'landing.html': 0, 'privacy.html': 0 };

/* Strip block and line comments from JS, and HTML comments, keeping string
   literals intact so their em dashes are counted. */
function stripComments(src) {
  let out = '', i = 0, n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '<' && src.startsWith('<!--', i)) { const e = src.indexOf('-->', i); i = e < 0 ? n : e + 3; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '/' && d === '/' && !/[\w)\]'"`]/.test(src[i - 1] || '') && src.slice(i - 6, i) !== 'https:' && src.slice(i - 5, i) !== 'http:') {
      const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; if (c !== '`' && src[j] === '\n') break; j++; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

export function countEmDashes(src) {
  return (stripComments(src).match(/—|\\u2014/g) || []).length;
}

let bad = 0;
for (const file of Object.keys(BASELINE)) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const count = countEmDashes(src);
  const base = BASELINE[file];
  const state = count > base ? 'ROSE' : count < base ? 'fell' : 'held';
  console.log(`  ${file}: ${count} em dashes in copy (baseline ${base}, ${state})`);
  if (count > base) bad++;
  if (count < base && !report) console.log(`    lower BASELINE['${file}'] to ${count} in scripts/check-copy.mjs`);
}
if (bad && !report) { console.error('check-copy: em dashes in UI copy rose above the baseline'); process.exit(1); }
console.log(bad ? 'check-copy: over baseline (report mode)' : 'check-copy OK');
