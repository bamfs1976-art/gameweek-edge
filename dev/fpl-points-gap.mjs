/*
 * Why does the rival card's live sum disagree with FPL's own gameweek total?
 *
 * The card shows both when they differ, and says they "update on different
 * clocks". That is true mid-gameweek and it is also the comfortable answer.
 * On a FINISHED gameweek both numbers are final, so any remaining difference
 * is not a clock — it is us being wrong, and the note would be excusing a bug.
 *
 * WHAT THIS MEASURES
 * For real, public entries on a finished gameweek, it computes our number and
 * FPL's, then applies candidate corrections one at a time and reports which
 * one closes the gap. Ranked hypotheses, not a guess:
 *
 *   1. AUTO-SUBS. `automatic_subs` appears nowhere in index.html. When a
 *      starter does not play, FPL substitutes a bench player and counts the
 *      sub's points instead. We read `multiplier` off the picks, which is the
 *      pre-deadline lineup, so an auto-subbed squad is summed as if the
 *      absent player played and the sub did not.
 *   2. TRANSFER COST. A -4 hit is subtracted from the official total. Our sum
 *      of player points cannot know about it, so ours would read HIGH by
 *      exactly the hit — and a 4 or an 8 is the right order of magnitude for
 *      the ~7 that was reported.
 *   3. Neither, in which case the hypothesis list is wrong and the report
 *      says so rather than picking the nearest.
 *
 * It grades the SHIPPED function, extracted from index.html, not a retyped
 * copy — a retyped copy tests my understanding of the code rather than the
 * code. If they diverge, the copy passes and the app stays broken.
 *
 * Entries come from the top of league 314, the public overall league, so this
 * reads nobody's private data and needs no credentials. Read-only.
 *
 * Runs from a GitHub runner: this sandbox cannot reach fantasy.premierleague.com.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const BASE = 'https://fantasy.premierleague.com/api';
const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(HERE, '..', 'index.html'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) return { ok: false, status: r.status };
  const ct = r.headers.get('content-type') || '';
  if (!/json/i.test(ct)) return { ok: false, status: r.status, contentType: ct };
  return { ok: true, data: await r.json() };
}

/* ── the shipped functions, verbatim ─────────────────────────────── */
function extractFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('not found in index.html: ' + name);
  let depth = 0, started = false;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
const ctx = vm.createContext({ console, Math, Array, Number, Object });
vm.runInContext([extractFn(html, 'rivalLivePts'), extractFn(html, 'rivalSquadRows')].join('\n'), ctx);
const { rivalSquadRows } = ctx;

/* ── which gameweek is genuinely finished? ─────────────────────────
   `finished` alone is not enough: FPL sets it before bonus is confirmed and
   before auto-subs are applied. `data_checked` is the flag that says the
   gameweek is settled, and settled is the whole premise here — an unsettled
   gameweek would reproduce the "different clocks" excuse and prove nothing. */
console.log('=== 1. FIND A SETTLED GAMEWEEK ===\n');
const boot = await getJSON(`${BASE}/bootstrap-static/`);
if (!boot.ok) { console.log('bootstrap-static unavailable:', boot.status); process.exit(1); }
const events = boot.data.events || [];
for (const e of events.filter((x) => x.finished || x.is_current).slice(0, 6)) {
  console.log(`  GW${e.id}  finished=${e.finished}  data_checked=${e.data_checked}  is_current=${e.is_current}`);
}
const settled = events.filter((e) => e.finished && e.data_checked).sort((a, b) => b.id - a.id)[0];
if (!settled) {
  console.log('\n  No gameweek is both finished AND data_checked yet.');
  console.log('  That is the honest answer: on an unsettled gameweek our number and FPL’s');
  console.log('  are BOTH provisional, the card’s "different clocks" note is correct, and');
  console.log('  there is no discrepancy to attribute. Re-run once one settles.');
  process.exit(0);
}
console.log(`\n  Using GW${settled.id} — finished and data_checked.\n`);

const live = await getJSON(`${BASE}/event/${settled.id}/live/`);
if (!live.ok) { console.log('live feed unavailable:', live.status); process.exit(1); }

console.log('=== 2. REAL ENTRIES FROM THE PUBLIC OVERALL LEAGUE ===\n');
const league = await getJSON(`${BASE}/leagues-classic/314/standings/`);
if (!league.ok) { console.log('league 314 unavailable:', league.status); process.exit(1); }
const rows = ((league.data.standings || {}).results || []).slice(0, 12);
console.log(`  ${rows.length} entries from the top of league 314\n`);

/* ── the comparison ────────────────────────────────────────────────── */
const HEAD = '  entry      ours   FPL   gap   +autosubs  -hit   subs hit  verdict';
console.log(HEAD);
const findings = [];
for (const row of rows) {
  await sleep(350);
  const picks = await getJSON(`${BASE}/entry/${row.entry}/event/${settled.id}/picks/`);
  if (!picks.ok) { console.log(`  ${String(row.entry).padEnd(10)} picks ${picks.status}`); continue; }
  const p = picks.data;
  const eh = p.entry_history || {};
  const official = typeof eh.points === 'number' ? eh.points : null;
  const hit = eh.event_transfers_cost || 0;
  const autoSubs = p.automatic_subs || [];

  /* Ours, exactly as the card computes it. */
  const ours = rivalSquadRows(p, live.data, new Set(), new Set()).live;

  /* Correction 1: apply the auto-subs FPL applied. Swap each `element_out`
     for its `element_in` and re-sum. Done by rewriting the picks the way FPL
     effectively did, then running the SAME shipped function over it — so the
     correction is measured through the real code path, not alongside it. */
  const swapped = JSON.parse(JSON.stringify(p));
  for (const s of autoSubs) {
    const out = swapped.picks.find((x) => x.element === s.element_out);
    const inn = swapped.picks.find((x) => x.element === s.element_in);
    if (!out || !inn) continue;
    const om = out.multiplier, im = inn.multiplier;
    out.multiplier = im; inn.multiplier = om || 1;
    const op = out.position, ip = inn.position;
    out.position = ip; inn.position = op;
  }
  const withSubs = rivalSquadRows(swapped, live.data, new Set(), new Set()).live;

  const gap = official == null ? null : ours - official;
  const gapSubs = official == null ? null : withSubs - official;
  const gapSubsHit = official == null ? null : (withSubs - hit) - official;

  const verdict = official == null ? 'no official figure'
    : gap === 0 ? 'already agrees'
    : gapSubsHit === 0 ? 'AUTO-SUBS + HIT closes it'
    : gapSubs === 0 ? 'AUTO-SUBS closes it'
    : (ours - hit) === official ? 'HIT alone closes it'
    : 'UNEXPLAINED';
  findings.push({ entry: row.entry, ours, official, gap, withSubs, hit, subs: autoSubs.length, verdict });
  console.log(`  ${String(row.entry).padEnd(10)} ${String(ours).padEnd(6)} ${String(official).padEnd(5)} ${
    String(gap).padEnd(5)} ${String(withSubs).padEnd(10)} ${String(withSubs - hit).padEnd(6)} ${
    String(autoSubs.length).padEnd(4)} ${String(hit).padEnd(4)} ${verdict}`);
}

console.log('\n=== VERDICT ===\n');
const graded = findings.filter((f) => f.official != null);
const tally = {};
for (const f of graded) tally[f.verdict] = (tally[f.verdict] || 0) + 1;
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${v}/${graded.length}  ${k}`);

const disagreeing = graded.filter((f) => f.gap !== 0);
console.log(`\n  ${disagreeing.length}/${graded.length} entries disagree with FPL before any correction.`);
if (disagreeing.length) {
  const bySubs = disagreeing.filter((f) => f.subs > 0).length;
  const byHit = disagreeing.filter((f) => f.hit > 0).length;
  console.log(`  of those, ${bySubs} had auto-subs and ${byHit} took a hit.`);
  const worst = disagreeing.slice().sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  console.log(`  largest gap: entry ${worst.entry}, ours ${worst.ours} vs FPL ${worst.official} (${worst.gap >= 0 ? '+' : ''}${worst.gap})`);
}
const unexplained = graded.filter((f) => f.verdict === 'UNEXPLAINED');
if (unexplained.length) {
  console.log(`\n  ${unexplained.length} entries are NOT explained by auto-subs or the hit.`);
  console.log('  The hypothesis list is incomplete — do not adopt either fix as "the" answer.');
  for (const f of unexplained.slice(0, 4)) {
    console.log(`    entry ${f.entry}: ours ${f.ours}, +subs ${f.withSubs}, hit ${f.hit}, FPL ${f.official}`);
  }
} else if (disagreeing.length) {
  console.log('\n  Every disagreement is accounted for. The card’s "different clocks" note');
  console.log('  is excusing a real defect on a settled gameweek, and should not.');
} else {
  console.log('\n  No entry disagrees. Whatever produced the reported gap was mid-gameweek');
  console.log('  provisional scoring, and the note is correct as written.');
}
