/*
 * What bootstrap-static publishes that the app never reads — WITH VALUES.
 *
 * WHY THIS EXISTS ALONGSIDE THE FIELD DIFF IN fpl-endpoint-probe.mjs
 * That diff answers "which field names does index.html not mention". This
 * answers the question you actually act on, which is different in two ways.
 *
 *   1. POPULATED, NOT MERELY PRESENT. An unused field that is null or zero
 *      for every row is not an opportunity, it is an empty column. This repo
 *      has been caught by that twice: strength_attack_* / strength_defence_*
 *      were zero for all twenty clubs, and every cost_change_* field is zero
 *      for all six hundred players right now. Both look identical to a
 *      healthy field in a list of names. So every unused field here is
 *      reported with its fill rate, range and a real example value, and the
 *      output separates "unused and populated" from "unused and empty".
 *
 *   2. SUBSTRING MATCHING OVERSTATES USE. The existing diff asks
 *      appSrc.includes(name). "id", "code", "form", "team", "news" and
 *      "starts" all appear somewhere in a twenty-thousand-line file no matter
 *      what, so a genuinely unread field with a short name is reported as
 *      used and disappears. That direction of error HIDES opportunities,
 *      which is the direction that matters here. This uses a word-boundary
 *      match and prints every name where the two methods disagree, so the
 *      overstatement is visible rather than silent.
 *
 * WHAT THIS CANNOT TELL YOU
 * "New" needs a baseline, and we store none. One snapshot can only say
 * "published and unconsumed", never "added since last time". The run prints
 * a sorted fingerprint at the end so a future run has something to diff
 * against; until one is committed, read every finding as "unused", not as
 * "new".
 *
 * Read-only, unauthenticated, one request. Runs from a GitHub runner because
 * this sandbox cannot reach fantasy.premierleague.com.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = 'https://fantasy.premierleague.com/api';
const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const appSrc = readFileSync(path.join(HERE, '..', 'index.html'), 'utf8');

const r = await fetch(`${BASE}/bootstrap-static/`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
if (!r.ok) { console.log(`bootstrap-static answered ${r.status} — nothing below would mean anything.`); process.exit(1); }
const boot = await r.json();

/* Two tests, deliberately. `loose` is what the existing probe uses; `strict`
   is what a property reference actually looks like. Where they disagree, the
   loose one is claiming use it cannot support. */
const loose = (n) => appSrc.includes(n);
const strict = (n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(appSrc);

/* Is there anything in this column? A field is only an opportunity if some
   row carries a usable value. Counts non-null, non-empty, non-zero
   separately from merely non-null, because 0 and null fail for different
   reasons and only one of them might still be meaningful. */
function fill(rows, key) {
  let nonNull = 0, truthy = 0, min = Infinity, max = -Infinity, example = null, numeric = 0;
  for (const row of rows) {
    const v = row ? row[key] : undefined;
    if (v === null || v === undefined || v === '') continue;
    nonNull++;
    const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : null);
    if (n !== null) { numeric++; if (n < min) min = n; if (n > max) max = n; if (n !== 0) truthy++; }
    else { truthy++; }
    if (example === null && (n === null ? true : n !== 0)) {
      example = typeof v === 'string' && v.length > 40 ? v.slice(0, 40) + '…' : v;
    }
  }
  return { n: rows.length, nonNull, truthy, numeric,
    min: min === Infinity ? null : min, max: max === -Infinity ? null : max, example };
}

const pad = (s, n) => String(s ?? '').padEnd(n);
const findings = { populated: [], empty: [], disagreements: [] };

function inspect(label, rows, nameOf) {
  if (!Array.isArray(rows) || !rows[0]) return;
  const keys = Object.keys(rows[0]);
  const unused = keys.filter((k) => !strict(k));
  for (const k of keys) if (loose(k) !== strict(k)) findings.disagreements.push(`${label}.${k}`);
  console.log(`\n${label}: ${keys.length} fields, ${keys.length - unused.length} referenced in index.html`);
  if (!unused.length) { console.log('  (every field is referenced somewhere)'); return; }
  console.log(`  ${unused.length} NOT referenced — fill rate and a real value for each:\n`);
  console.log('  field                            filled     non-zero   min        max        example');
  for (const k of unused) {
    const f = fill(rows, k);
    const bucket = f.truthy > 0 ? findings.populated : findings.empty;
    bucket.push({ label, k, ...f });
    console.log(`  ${pad(k, 32)} ${pad(f.nonNull + '/' + f.n, 10)} ${pad(f.truthy, 10)} ${pad(f.min, 10)} ${pad(f.max, 10)} ${
      typeof f.example === 'object' ? JSON.stringify(f.example).slice(0, 40) : pad(f.example, 20)}`);
  }
  if (nameOf) { /* reserved */ }
}

console.log('=== BOOTSTRAP-STATIC: PUBLISHED BUT NOT REFERENCED ===');
console.log(`(elements ${(boot.elements || []).length}, teams ${(boot.teams || []).length}, events ${(boot.events || []).length})`);

inspect('elements[] (players)', boot.elements);
inspect('teams[]', boot.teams);
inspect('events[] (gameweeks)', boot.events);
inspect('element_types[] (positions)', boot.element_types);
if (Array.isArray(boot.phases)) inspect('phases[]', boot.phases);
if (Array.isArray(boot.chips)) inspect('chips[]', boot.chips);

/* Top-level scalars and any collection not inspected above. Named explicitly
   so a whole new top-level key cannot slip past — that is how a new feature
   usually arrives. */
const covered = new Set(['elements', 'teams', 'events', 'element_types', 'phases', 'chips']);
const topKeys = Object.keys(boot);
console.log(`\ntop-level keys: ${topKeys.length}`);
const topUnused = topKeys.filter((k) => !strict(k));
console.log(topUnused.length ? '  NOT referenced: ' + topUnused.join(', ') : '  (all referenced)');
for (const k of topKeys) {
  if (covered.has(k)) continue;
  const v = boot[k];
  const shape = Array.isArray(v) ? `array[${v.length}]` : v && typeof v === 'object' ? `object{${Object.keys(v).length}}` : JSON.stringify(v);
  console.log(`  ${pad(k, 26)} ${pad(strict(k) ? 'referenced' : 'NOT referenced', 16)} ${shape}`);
}
/* Any unreferenced top-level object or array is worth its own listing —
   a new sub-object is a new capability and the loop above only names it. */
for (const k of topUnused) {
  const v = boot[k];
  if (Array.isArray(v) && v[0] && typeof v[0] === 'object') {
    console.log(`\n  ${k}[0] keys: ${Object.keys(v[0]).join(', ')}`);
    console.log(`  ${k}[0] value: ${JSON.stringify(v[0]).slice(0, 300)}`);
  } else if (v && typeof v === 'object') {
    console.log(`\n  ${k} keys: ${Object.keys(v).join(', ')}`);
    console.log(`  ${k} value: ${JSON.stringify(v).slice(0, 300)}`);
  }
}

/* element_stats is FPL's own list of what it scores. A new entry is the
   loudest possible signal of a scoring-rule change. */
if (Array.isArray(boot.element_stats)) {
  const ids = boot.element_stats.map((s) => s && s.name).filter(Boolean);
  const unused = ids.filter((n) => !strict(n));
  console.log(`\nelement_stats (FPL's own scored-stat list): ${ids.length}`);
  console.log('  ' + ids.join(', '));
  console.log(unused.length ? '  NOT referenced: ' + unused.join(', ') : '  (every scored stat is referenced)');
}

console.log('\n\n=== WHAT IS ACTUALLY AVAILABLE ===');
console.log(`\nUNUSED AND POPULATED — these are the real candidates (${findings.populated.length}):`);
if (!findings.populated.length) console.log('  none.');
for (const f of findings.populated.sort((a, c) => c.truthy - a.truthy)) {
  console.log(`  ${pad(f.label + '.' + f.k, 44)} ${f.truthy}/${f.n} non-zero, e.g. ${
    typeof f.example === 'object' ? JSON.stringify(f.example).slice(0, 50) : f.example}`);
}
console.log(`\nUNUSED AND EMPTY — published but carrying nothing, not opportunities (${findings.empty.length}):`);
console.log(findings.empty.length ? '  ' + findings.empty.map((f) => f.label.split(' ')[0] + '.' + f.k).join(', ') : '  none.');

console.log(`\nSUBSTRING MATCH OVERSTATED USE FOR ${findings.disagreements.length} field(s):`);
console.log(findings.disagreements.length
  ? '  ' + findings.disagreements.join(', ') + '\n  (a plain includes() call reports these as used; a word-boundary match does not.)'
  : '  none — the two tests agree everywhere.');

/* A fingerprint a later run can diff against, so the next person can say
   "new" rather than only "unused". */
const fp = [];
for (const [label, rows] of [['elements', boot.elements], ['teams', boot.teams], ['events', boot.events]]) {
  if (Array.isArray(rows) && rows[0]) fp.push(`${label}:${Object.keys(rows[0]).sort().join(',')}`);
}
fp.push(`top:${topKeys.slice().sort().join(',')}`);
console.log('\n=== FIELD FINGERPRINT (commit this to make the next run able to say "new") ===');
console.log(fp.join('\n'));
