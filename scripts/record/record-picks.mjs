#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   GAMEWEEK EDGE — record this gameweek's calls, before the deadline.

   Writes one file — data/record/gw-NN.json — holding the model Team of
   the Week, the captain pick and the top five price predictions, exactly
   as index.html would show them at this moment, plus the naive form XI
   they will be graded against. It refuses to write after the deadline and
   refuses to overwrite. There is no flag for either.

   Exit codes: 0 wrote a gameweek or had nothing to do, 1 the feed failed.
   ═══════════════════════════════════════════════════════════ */

import {
  API_BASE, fetchJson, loadModel, buildIndex, openEvent, canRecord, readEntry, writeEntry, deadlineOf
} from './lib.mjs';

/* FPL_RECORD_NOW is for a rehearsal against the mock feed only; the
   scheduled job never sets it, and a clock that can be moved is a clock
   that can be moved to before a deadline that has passed. The refusal in
   canRecord() still runs against whatever it is set to. */
const now = process.env.FPL_RECORD_NOW ? Date.parse(process.env.FPL_RECORD_NOW) : Date.now();

let boot, fixtures;
try {
  boot = await fetchJson('bootstrap-static/');
  fixtures = await fetchJson('fixtures/');
} catch (err) {
  console.error(`✗ The FPL feed did not answer: ${err.message}`);
  console.error('  Nothing recorded. A gameweek with no entry is the honest outcome of a feed that');
  console.error('  was down; a gameweek with a guessed entry is not.');
  process.exit(1);
}

const event = openEvent(boot.events, now);
const existing = event ? await readEntry(event.id) : null;
const verdict = canRecord({ event, existing, now });

const M = loadModel();
const idx = buildIndex(boot, fixtures);

if (!verdict.ok) {
  console.log(`· Nothing to record: ${verdict.reason}`);
  /* The canary: build the picks anyway so a feed that has changed shape is
     found on a quiet Tuesday, not in the hour before a deadline. */
  try {
    const nf = M.buildNextFix(idx, fixtures);
    const xi = M.bestXI(M.scoutScored(idx, nf));
    console.log(`· Feed rehearsal passed: ${idx.elements.length} players, ${fixtures.length} fixtures, `
      + `model XI ${xi ? xi.total.toFixed(1) + ' xP' : 'unavailable'}.`);
    process.exit(0);
  } catch (err) {
    console.error(`✗ The model could not run on this feed: ${err.message}`);
    process.exit(1);
  }
}

/* ── The calls, built as the app builds them ────────────── */
const nf = M.buildNextFix(idx, fixtures);
const scored = M.scoutScored(idx, nf);
const totw = M.bestXI(scored);
if (!totw) {
  console.error(`✗ The model could not build a legal XI for gameweek ${event.id}. Nothing is written.`);
  process.exit(1);
}
const cap = M.captainModel(idx, nf, idx.elements, 3);
if (!cap.picks.length) {
  console.error(`✗ The model has no eligible captain for gameweek ${event.id}. Nothing is written.`);
  process.exit(1);
}
const total = boot.total_players || 10e6;
const prices = idx.elements
  .map((e) => ({ e, pc: M.priceChangeProb(e, total) }))
  .filter((x) => x.pc.dir !== 'flat')
  .sort((a, b) => b.pc.prob - a.pc.prob)
  .slice(0, 5);

/* The naive form XI, fixed NOW from FPL's own `form` figure. In gameweek
   one everyone is on 0.0 and the "best" XI would be whichever eleven the
   search reached first — a coin toss wearing a baseline — so it is absent. */
const formRows = idx.elements
  .filter((e) => e.status === 'a')
  .map((e) => ({ el: e, p: parseFloat(e.form) || 0 }));
const naive = formRows.some((r) => r.p > 0) ? M.bestXI(formRows) : null;

const fix = (el) => {
  const f = nf[el.team];
  return f ? { opp: f.opp, home: !!f.home, diff: f.diff, event: f.event } : null;
};
const player = (el, xp) => ({
  id: String(el.id), name: el.web_name, teamId: String(el.team), team: M.teamShort(idx, el.team),
  position: M.posShort(idx, el.element_type), cost: el.now_cost, xp: Math.round(xp * 10) / 10, fixture: fix(el)
});

const entry = {
  gw: Number(event.id),
  recordedAt: new Date(now).toISOString(),
  deadlineAt: new Date(deadlineOf(event)).toISOString(),
  hoursBeforeDeadline: Math.round(verdict.hoursBeforeDeadline * 100) / 100,
  source: { apiBase: API_BASE, players: idx.elements.length, fixtures: fixtures.length, totalPlayers: total },
  picks: {
    totw: {
      formation: totw.formation.join('-'),
      modelTotal: Math.round(totw.total * 10) / 10,
      players: totw.xi.map((s) => player(s.el, s.p))
    },
    captain: Object.assign(player(cap.picks[0].el, cap.picks[0].xp), {
      alternatives: cap.picks.slice(1).map((p) => player(p.el, p.xp))
    }),
    prices: prices.map((x) => Object.assign(player(x.e, 0), { dir: x.pc.dir, prob: x.pc.prob, xp: undefined })),
    naiveXI: naive ? { formation: naive.formation.join('-'), players: naive.xi.map((s) => ({ id: String(s.el.id), name: s.el.web_name, form: s.p })) } : null
  },
  /* Every available player's expected points at the moment of the pick, so
     a later, better grade can be computed without a feed that no longer
     exists. Compact: one row per player. */
  universe: {
    columns: ['id', 'teamId', 'position', 'xp', 'cost', 'form'],
    rows: scored.map((s) => [String(s.el.id), String(s.el.team), s.el.element_type, Math.round(s.p * 10) / 10, s.el.now_cost, parseFloat(s.el.form) || 0])
  },
  result: null
};
/* JSON drops undefined; xp on a price row is not a claim we make. */
const path = await writeEntry(entry);
console.log(`✓ Recorded gameweek ${entry.gw} → ${path}`);
console.log(`  ${entry.hoursBeforeDeadline}h before the deadline · XI ${entry.picks.totw.formation} `
  + `${entry.picks.totw.modelTotal} xP · captain ${entry.picks.captain.name} · `
  + `${entry.picks.prices.length} price calls · naive XI ${naive ? 'fixed' : 'absent (no form yet)'}`);
