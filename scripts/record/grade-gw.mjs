#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   GAMEWEEK EDGE — grade the gameweeks that have finished.

   Reads the ledger, finds entries with no result, and fills one in for
   each gameweek FPL has finished scoring (finished + data_checked). It
   never touches `picks`: a recorded pick is evidence, and evidence that
   gets edited after the fact is not evidence.

   Points come from event/{gw}/live — the official per-player totals for
   that gameweek, so unlike the EFL ledger no subtraction is needed. The
   average manager score comes from the bootstrap's events list; prices
   from the bootstrap now. Where an input is missing the field is null and
   the page says "not graded".
   ═══════════════════════════════════════════════════════════ */

import { fetchJson, readLedger, writeEntry, gradable } from './lib.mjs';
import { gradeEntry } from './metrics.mjs';

let boot;
try { boot = await fetchJson('bootstrap-static/'); }
catch (err) { console.error(`✗ The FPL feed did not answer: ${err.message}`); process.exit(1); }

const ledger = await readLedger();
if (!ledger.length) { console.log('· The ledger is empty — nothing has been recorded yet, so there is nothing to grade.'); process.exit(0); }

const ready = gradable(ledger, boot.events);
if (!ready.length) {
  const waiting = ledger.filter((e) => !e.result).map((e) => e.gw);
  console.log(waiting.length
    ? `· Waiting on ${waiting.length} recorded gameweek(s) to be scored: ${waiting.join(', ')}`
    : '· Every recorded gameweek is already graded.');
  process.exit(0);
}

let wrote = 0;
for (const entry of ready) {
  let live;
  try { live = await fetchJson(`event/${entry.gw}/live/`); }
  catch (err) { console.error(`✗ Gameweek ${entry.gw}: live document did not answer (${err.message}); left ungraded.`); continue; }
  const result = gradeEntry(entry, live, boot);
  if (result.totw.unresolved === result.totw.players.length) {
    console.error(`✗ Gameweek ${entry.gw}: the live document carried no points for any of the eleven; left ungraded.`);
    continue;
  }
  entry.result = result;
  await writeEntry(entry);
  wrote += 1;
  const t = result.totw, c = result.captain, p = result.prices;
  console.log(`✓ Graded gameweek ${entry.gw}: XI ${t.total} pts` +
    (t.average != null ? ` vs average ${t.average}` : ' (average not published)') +
    (t.naive != null ? ` vs form XI ${t.naive}` : '') +
    (c ? ` · captain ${c.points} pts, rank ${c.rank} of ${c.of}` : '') +
    ` · prices ${p.hits}/${p.graded}`);
}
console.log(wrote ? `· ${wrote} gameweek(s) graded.` : '· Nothing graded this run.');
