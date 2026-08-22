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
    /* An empty array or empty object is NOT content. The first version
       counted anything non-numeric as populated, so scout_risks: [] — empty
       for every player — was reported as a candidate alongside real data.
       That is the same "present is not populated" error this file exists to
       catch, made one level down. */
    if (Array.isArray(v) ? v.length === 0
      : (typeof v === 'object' && Object.keys(v).length === 0)) continue;
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

/* ── The headline finding, dumped in full ─────────────────────────────
   price_change_projections is populated for every player and is FPL
   publishing its own price forecast — the thing our panel currently
   approximates with a threshold model, and the thing a previous run of the
   PRICE probe reported as absent. It reported that because its field list
   was hand-written by me and did not contain this name; "14/14 price fields
   present" measured my imagination, not the API. So this one gets printed in
   full rather than as a truncated example, for a player at each end of the
   transfer range, and so does game_config. A truncated string is not a
   schema and cannot be built against. */
console.log('\n\n=== PRICE_CHANGE_PROJECTIONS, IN FULL ===');
const byNet = (boot.elements || []).slice().sort((a, c) =>
  ((c.transfers_in_event || 0) - (c.transfers_out_event || 0)) -
  ((a.transfers_in_event || 0) - (a.transfers_out_event || 0)));
for (const e of [byNet[0], byNet[Math.floor(byNet.length / 2)], byNet[byNet.length - 1]].filter(Boolean)) {
  const net = (e.transfers_in_event || 0) - (e.transfers_out_event || 0);
  console.log(`\n  ${e.web_name}  own ${e.selected_by_percent}%  net ${net}  now_cost ${e.now_cost}`);
  console.log(`    price_change_projections: ${JSON.stringify(e.price_change_projections)}`);
  console.log(`    price_change_calibrating: ${JSON.stringify(e.price_change_calibrating)}`);
  console.log(`    price_change_percent: ${JSON.stringify(e.price_change_percent)}   hourly_rate: ${JSON.stringify(e.price_change_hourly_rate)}   locked_until: ${JSON.stringify(e.price_change_locked_until)}`);
}
/* Is the projection actually varying, or is every player the same? A field
   that is identical for all 600 carries no information however populated it
   looks. */
{
  const sigs = new Map();
  for (const e of boot.elements || []) {
    const s = JSON.stringify(e.price_change_projections);
    sigs.set(s, (sigs.get(s) || 0) + 1);
  }
  console.log(`\n  distinct price_change_projections values across ${(boot.elements || []).length} players: ${sigs.size}`);
  for (const [s, n] of [...sigs.entries()].sort((a, c) => c[1] - a[1]).slice(0, 5)) {
    console.log(`    ${String(n).padStart(4)}x  ${s.slice(0, 150)}`);
  }
  const cal = (boot.elements || []).filter((e) => e.price_change_calibrating).length;
  console.log(`  price_change_calibrating true for ${cal}/${(boot.elements || []).length} players`);
}

console.log('\n=== GAME_CONFIG, IN FULL ===');
console.log(JSON.stringify(boot.game_config, null, 2));

console.log('\n=== CHIPS, IN FULL (chip windows we do not read) ===');
console.log(JSON.stringify(boot.chips, null, 2));

/* ── Does FPL's own figure agree with our estimate? ───────────────────
   As of 22 Aug the projections populated: 319 distinct values across 600
   players, where the day before there was exactly 1. So the question is no
   longer "is there anything there" but "is it better than what we ship", and
   that is answerable — both numbers claim to say the same thing about the
   same player at the same moment.

   Three things get measured, because they justify different decisions:
     - DIRECTION agreement. If we say rise and FPL says fall, one of us is
       telling users the opposite of the truth. This is the disqualifying
       disagreement and it is counted separately from magnitude.
     - RANK correlation. Our percentage and theirs are not on the same scale
       and never will be — ours is a logistic over a threshold, theirs is a
       percentage of progress. Comparing them point-for-point would be a
       category error. What matters is whether we ORDER players the same way.
     - The `likelihood` field is NOT interpreted. It is a small signed
       integer of unknown scale, and putting a guessed label on it is exactly
       the mistake the region field is still sitting unshipped for. */
console.log('\n\n=== OUR ESTIMATE vs FPL’S OWN FIGURE ===');
{
  const els = (boot.elements || []);
  const total = boot.total_players || 10e6;
  /* The shipped model, extracted rather than retyped. */
  const src = readFileSync(path.join(HERE, '..', 'index.html'), 'utf8');
  const at = src.indexOf('function priceChangeProb(');
  const fnSrc = at < 0 ? null : src.slice(at, src.indexOf('\n}', at) + 2);
  if (!fnSrc) { console.log('  could not extract priceChangeProb — no comparison made.'); }
  else {
    const priceChangeProb = new Function('return (' + fnSrc.replace('function priceChangeProb', 'function') + ')')();
    const rows = [];
    for (const e of els) {
      const pct = parseFloat(e.price_change_percent);
      if (!Number.isFinite(pct)) continue;
      const ours = priceChangeProb(e, total);
      const theirDir = pct > 0 ? 'rise' : pct < 0 ? 'fall' : 'flat';
      rows.push({ name: e.web_name, ours: ours.prob, oursDir: ours.dir, theirs: pct, theirDir });
    }
    const moving = rows.filter((r) => r.theirDir !== 'flat' && r.oursDir !== 'flat');
    const agree = moving.filter((r) => r.oursDir === r.theirDir).length;
    console.log(`\n  ${rows.length} players carry a price_change_percent; ${moving.length} are moving on both sides.`);
    console.log(`  DIRECTION agrees on ${agree}/${moving.length} (${(agree / Math.max(1, moving.length) * 100).toFixed(1)}%).`);
    const wrong = moving.filter((r) => r.oursDir !== r.theirDir);
    if (wrong.length) {
      console.log(`  We point the OPPOSITE way for ${wrong.length}:`);
      for (const r of wrong.slice(0, 8)) console.log(`    ${r.name.padEnd(18)} ours ${r.oursDir} ${r.ours}%   FPL ${r.theirs}%`);
    }
    /* Spearman on the movers, computed on absolute progress. */
    const rank = (arr, key) => {
      const idx = arr.map((_, i) => i).sort((a, b) => Math.abs(arr[b][key]) - Math.abs(arr[a][key]));
      const out = new Array(arr.length);
      idx.forEach((orig, r) => { out[orig] = r + 1; });
      return out;
    };
    if (moving.length > 2) {
      const a = rank(moving, 'ours'), b = rank(moving, 'theirs');
      const n = moving.length;
      let d2 = 0; for (let i = 0; i < n; i++) d2 += (a[i] - b[i]) ** 2;
      const rho = 1 - (6 * d2) / (n * (n * n - 1));
      console.log(`  RANK correlation (Spearman, |progress|): rho = ${rho.toFixed(3)} over ${n} movers.`);
      console.log(rho > 0.7 ? '    Strong: we order players much as FPL does.'
        : rho > 0.4 ? '    Moderate: broadly the same ordering, materially different in places.'
        : '    Weak: our ordering is NOT theirs. Showing both without saying so would mislead.');
    }
    const top = rows.slice().sort((x, y) => Math.abs(y.theirs) - Math.abs(x.theirs)).slice(0, 10);
    console.log('\n  closest to a move, by FPL’s own figure:');
    console.log('  player               FPL%     ours');
    for (const r of top) console.log(`  ${r.name.padEnd(20)} ${String(r.theirs).padEnd(8)} ${r.oursDir} ${r.ours}%`);
  }
}
