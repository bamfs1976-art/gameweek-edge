#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — grade the rounds that have finished.

   Reads the ledger, finds entries with no result, and fills one in for each
   round that has settled. It never touches `picks`: a recorded pick is
   evidence, and evidence that gets edited after the fact is not evidence.

   ── HOW A ROUND'S POINTS ARE OBTAINED ──────────────────────
   The official feed publishes a player's SEASON total, not a per-round
   figure. So a round's points are the difference between the total recorded
   at its lockout and the total now:

       round points = totalNow − totalAtLock

   That subtraction is this round's score only if nothing else was played in
   between, so it runs only while the window is clean — after this round's
   last kick-off, before any later round's first. Outside that window the
   round is still graded, and marked `attribution: "ambiguous"`, and the
   season figures leave it out. A number that might be two rounds added
   together is worse than a gap, because a gap is visibly a gap.
   ═══════════════════════════════════════════════════════════ */

import { gradeRound } from './metrics.mjs';
import {
  fetchDocuments, readLedger, writeRound, roundSettlement, clubResults,
  pointsFieldFor, totalsById, gradable
} from './lib.mjs';
import { clubOutcome } from './metrics.mjs';

const now = Date.now();
const force = process.argv.includes('--force');

const raw = await fetchDocuments().catch((err) => {
  console.error(`✗ The official Fantasy EFL feed did not answer: ${err.message}`);
  process.exit(1);
});

const ledger = await readLedger();
if (!ledger.length) {
  console.log('· The ledger is empty — nothing has been recorded yet, so there is nothing to grade.');
  process.exit(0);
}

const ready = gradable(ledger, raw.rounds, now);
if (!ready.length) {
  const waiting = ledger.filter((e) => !e.result).map((e) => e.round);
  console.log(waiting.length
    ? `· Waiting on ${waiting.length} recorded round(s) to finish: ${waiting.join(', ')}`
    : '· Every recorded round is already graded.');
  process.exit(0);
}

const pointsField = pointsFieldFor(raw.players);
const totalsNow = totalsById(raw.players, pointsField);
const clubPointsField = pointsFieldFor(raw.squads);
const clubTotalsNow = totalsById(raw.squads, clubPointsField);

let wrote = 0;

for (const { entry, settlement } of ready) {
  if (!settlement.clean && !force) {
    /* Still gradable, still recorded — but the subtraction below can no
       longer be pinned to this round alone, and the entry will say so. */
    console.log(`! Round ${entry.round} settled, but a later round has already kicked off — `
      + 'grading it as ambiguous.');
  }

  /* The points column must be the one the picks were recorded against. If
     the feed renamed it mid-season, every difference below would be
     computed from two different quantities. */
  if (entry.source && entry.source.pointsField && pointsField
    && entry.source.pointsField !== pointsField) {
    console.error(`✗ Round ${entry.round} was recorded against "${entry.source.pointsField}" `
      + `but the feed now publishes "${pointsField}". Refusing to grade a subtraction across `
      + 'two different columns — fix the mapping first.');
    continue;
  }

  const cols = entry.universe.columns;
  const iId = cols.indexOf('id');
  const iClub = cols.indexOf('clubId');
  const iPos = cols.indexOf('position');
  const iScore = cols.indexOf('score');
  const iLock = cols.indexOf('pointsAtLock');

  /* points scored between the two snapshots, per player */
  const actual = {};
  const universe = [];
  for (const row of entry.universe.rows) {
    const id = String(row[iId]);
    const before = row[iLock];
    const after = totalsNow[id];
    universe.push({ id, clubId: String(row[iClub]), position: row[iPos] });
    if (before == null || !Number.isFinite(after)) continue;
    /* A total that went DOWN is a post-match correction upstream, not a
       negative round. It is kept as-is rather than clamped: hiding it would
       make the ledger disagree with the feed, and the number is small. */
    actual[id] = after - before;
  }

  /* ── DOES THIS SUBTRACTION DESCRIBE A ROUND OF FOOTBALL? ──────────────
     Round 1 of 2026-27 was graded and published with every one of 3,442
     players on roughly minus two hundred and fifty points, our squad on
     -1899, and a rank correlation of -0.72 that was identical in all four
     positions. None of that is a bad model; it is the wrong quantity.

     What happened: pointsAtLock was captured on 13 August while the feed
     still published the PREVIOUS season's cumulative totals (median 19,
     max 357, when a new season should read 0). By grading time the feed had
     rolled over, so `after - before` computed newSeasonSoFar minus
     lastSeasonFinal. Every established player "scored" minus their last
     campaign, and the model — which ranks by expected quality, and so
     correlates with last season's total — came out neatly inverted.

     The guard above only catches the points COLUMN being renamed. Here the
     name never changed; its MEANING did. A rollover is invisible to a name
     check and visible immediately in the numbers, so check the numbers.

     The old comment on the subtraction said a total going down is a small
     upstream correction "and the number is small". That was true when it
     was written and is what made this publishable. An assumption that has
     stopped holding is worse than no assumption, so it is now enforced
     rather than asserted. */
  {
    const deltas = Object.values(actual);
    const negatives = deltas.filter((d) => d < 0).length;
    const share = deltas.length ? negatives / deltas.length : 0;
    const worst = deltas.length ? Math.min(...deltas) : 0;
    /* A real round has a few small negatives from upstream corrections.
       A rollover has almost every player negative and by a season's worth. */
    if (deltas.length >= 50 && (share > 0.5 || worst < -60)) {
      console.error(`✗ Round ${entry.round}: refusing to grade. ${negatives} of ${deltas.length} `
        + `players (${Math.round(share * 100)}%) have NEGATIVE round points, worst ${worst}. `
        + 'That is the signature of the points field being reset between the lock snapshot and '
        + 'now — a season rollover — not of a round of football. The subtraction would publish '
        + 'a graded round, and a model correlation, that describe nothing. '
        + 'Re-record the lock baseline against the current season before grading.');
      continue;
    }
  }

  const results = clubResults(raw.rounds, entry.round);
  const clubOutcomes = {};
  for (const [clubId, fixtures] of Object.entries(results)) clubOutcomes[clubId] = clubOutcome(fixtures);

  /* Official club points, but only if the feed carried such a column at
     lockout AND still carries the same one now. Otherwise the club grade
     falls back to the observable match result, and says which it used. */
  const lockClub = entry.clubUniverse || {};
  let clubPoints = null;
  if (clubPointsField && lockClub.pointsField === clubPointsField && lockClub.pointsAtLock) {
    clubPoints = {};
    for (const [id, before] of Object.entries(lockClub.pointsAtLock)) {
      const after = clubTotalsNow[id];
      if (Number.isFinite(after) && Number.isFinite(before)) clubPoints[id] = after - before;
    }
  }

  const graded = gradeRound({
    round: entry.round,
    picks: {
      players: entry.picks.players,
      captain: entry.picks.captain,
      clubs: (entry.picks.clubs || []).map((c) => String(c.id)),
      naive: entry.picks.naive,
      formation: entry.picks.formation,
      scores: entry.universe.rows.map((row) => [String(row[iId]), row[iScore]])
    },
    actual,
    rules: entry.rules,
    universe,
    clubOutcomes,
    clubPoints
  });

  /* The crowd's clubs, graded on the same basis as ours — the one baseline
     that is a real opponent rather than a construction. */
  const crowd = (entry.picks.crowdClubs || []).map(String);
  const crowdValue = crowd.length
    ? crowd.reduce((s, id) => s + (clubPoints ? (clubPoints[id] || 0)
      : (clubOutcomes[id] ? clubOutcomes[id].leaguePoints : 0)), 0)
    : null;

  const out = {
    ...entry,
    result: {
      gradedAt: new Date(now).toISOString(),
      attribution: settlement.clean ? 'clean' : 'ambiguous',
      window: {
        lastKickoff: settlement.lastKickoff ? new Date(settlement.lastKickoff).toISOString() : null,
        nextRoundKickoff: settlement.nextKickoff ? new Date(settlement.nextKickoff).toISOString() : null
      },
      fixtures: { played: settlement.played, total: settlement.total },
      pointsField,
      clubBasis: clubPoints ? 'official-points' : 'match-result',
      crowdClubs: { ids: crowd, value: crowdValue },
      ...graded
    }
  };

  await writeRound(out);
  wrote++;

  const b = graded.baselines;
  const pct = b.percentile == null ? '—' : `${(b.percentile * 100).toFixed(0)}th`;
  console.log(`✓ Round ${entry.round}: our seven scored ${graded.squad.total}`
    + ` (random ${b.randomMean == null ? '—' : b.randomMean.toFixed(1)},`
    + ` naive ${b.naive == null ? '—' : b.naive},`
    + ` best possible ${b.ceiling == null ? '—' : b.ceiling}) — ${pct} percentile`);
  console.log(`  rank correlation across ${graded.model.n} players: `
    + `${graded.model.rho == null ? '—' : graded.model.rho.toFixed(3)}`
    + `, top-decile lift ${graded.model.topDecileLift == null ? '—' : `${graded.model.topDecileLift.toFixed(2)}×`}`);
  if (graded.captain) {
    console.log(`  captain scored ${graded.captain.points}`
      + `${graded.captain.wasBest ? ' — the best of the seven' : `, ${graded.captain.foregonePerMultiple} behind the best of the seven`}`);
  }
}

console.log(wrote ? `✓ Graded ${wrote} round(s).` : '· Nothing graded.');
