#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — record this round's picks, before it locks.

   Run on a schedule. It writes one file — efl/data/rounds/round-NN.json —
   containing the seven players, the captain, the two clubs, and everything
   needed to grade them later, and it commits nothing it cannot defend:

   · The picks come from the SAME model.js the website runs. Not a copy of
     it, not a simplified version of it — the same file, imported. A ledger
     that graded a re-implementation would measure the wrong thing.
   · It refuses to write after the lockout, and refuses to overwrite. There
     is no flag to make it do either.
   · It stores the whole player universe as it stood at that moment — every
     player's rating and season points — because a grade computed later from
     data fetched later is a grade contaminated by hindsight.

   Exit codes: 0 wrote a round or had nothing to do, 1 the feed failed.
   ═══════════════════════════════════════════════════════════ */

import { buildOfficialSnapshot } from '../../efl/app/assets/provider.js';
import {
  buildContext, buildSquad, clubScore, playerScore,
  PLAYER_WEIGHTS, CLUB_WEIGHTS, FORMATIONS, MAX_PER_CLUB, SQUAD_SIZE
} from '../../efl/app/assets/model.js';
import { bestLegalSeven } from './metrics.mjs';
import {
  API_BASE, fetchDocuments, openRound, canRecord, readRound, writeRound,
  roundLockout, pointsFieldFor, totalsById
} from './lib.mjs';

const now = Date.now();

const raw = await fetchDocuments().catch((err) => {
  console.error(`✗ The official Fantasy EFL feed did not answer: ${err.message}`);
  console.error('  Nothing recorded. A round with no entry is the honest outcome of a feed');
  console.error('  that was down; a round with a guessed entry is not.');
  process.exit(1);
});

const round = openRound(raw.rounds, now);
const existing = round ? await readRound(round.roundNumber) : null;
const verdict = canRecord({ round, existing, now });

if (!verdict.ok) {
  console.log(`· Nothing to record: ${verdict.reason}`);
  process.exit(0);
}

/* ── The picks ────────────────────────────────────────────
   Built exactly as the dashboard builds them, from a snapshot taken now. */
const snapshot = buildOfficialSnapshot(raw, { now });
const ctx = buildContext(snapshot);
const roundNumber = Number(round.roundNumber);

const scored = ctx.players.map((p) => playerScore(ctx, p));
const squad = buildSquad(ctx, { scored });
if (!squad || !squad.legal) {
  console.error(`✗ The model could not build a legal seven for round ${roundNumber}.`);
  console.error('  Recording an illegal squad would put a number in the season table that no');
  console.error('  manager could have entered, so nothing is written.');
  process.exit(1);
}

const clubsRanked = ctx.clubs.map((c) => clubScore(ctx, c)).sort((a, b) => b.score - a.score);
const clubPicks = clubsRanked.slice(0, 2);

/* ── The universe, frozen ─────────────────────────────────
   Only players whose club plays in this round: a player with no fixture is
   not a decision anyone was offered, and including him would flatter every
   baseline with a guaranteed zero. */
const playingClubs = new Set(
  (round.games || []).flatMap((g) => [String(g.homeId), String(g.awayId)])
);
const pointsField = pointsFieldFor(raw.players);
const totals = totalsById(raw.players, pointsField);
const appearancesById = Object.fromEntries(
  (raw.players || []).map((p) => [String(p.id), Number(p.appearances) || 0])
);

const universe = scored
  .filter((r) => playingClubs.has(String(r.player.clubId)))
  .map((r) => [
    String(r.player.id),
    String(r.player.clubId),
    r.player.position,
    r.score,
    totals[String(r.player.id)] == null ? null : totals[String(r.player.id)],
    r.player.availability.status === 'available' ? 1 : 0
  ]);

/* ── The baseline that has to be chosen now ───────────────
   "Pick whoever has been scoring" — the legal seven with the best points
   per appearance so far. It must be built from pre-round data, in the same
   breath as our own picks, or it stops being a baseline and becomes a
   second hindsight number. */
const naiveRows = universe
  .filter((row) => row[5] === 1 && row[4] != null)
  .map((row) => ({
    id: row[0], clubId: row[1], position: row[2],
    ppa: (appearancesById[row[0]] || 0) >= 3 ? row[4] / appearancesById[row[0]] : 0
  }));
const naive = bestLegalSeven(naiveRows, (r) => r.ppa, {
  squadSize: SQUAD_SIZE, maxPerClub: MAX_PER_CLUB, formations: FORMATIONS, clubPicks: 2
});

const clubPointsField = pointsFieldFor(raw.squads);
const clubTotalsAtLock = clubPointsField ? totalsById(raw.squads, clubPointsField) : null;

/* The crowd's two clubs, where the feed publishes selection. Not a model,
   not our pick — the comparison that says whether we beat the room. */
const crowdClubs = (raw.squads || [])
  .filter((s) => Number.isFinite(Number(s.percentSelected)))
  .sort((a, b) => Number(b.percentSelected) - Number(a.percentSelected))
  .slice(0, 2)
  .map((s) => String(s.id));

const fixtureOf = (rec) => (rec.next ? {
  opponentId: String(rec.next.opponentId),
  opponent: (ctx.clubById[rec.next.opponentId] || {}).name || null,
  home: Boolean(rec.next.home),
  rating: rec.next.rating == null ? null : rec.next.rating,
  kickoff: rec.next.kickoff || null
} : null);

const entry = {
  round: roundNumber,
  /* Both times, always. The gap between them is the whole claim. */
  recordedAt: new Date(now).toISOString(),
  lockoutAt: new Date(roundLockout(round)).toISOString(),
  hoursBeforeLock: Math.round(verdict.hoursBeforeLock * 100) / 100,

  source: {
    id: snapshot.source.id,
    label: snapshot.source.label,
    generatedAt: snapshot.source.generatedAt,
    apiBase: API_BASE,
    pointsField
  },

  /* The rules and weights in force at the time of the pick. A later change
     to either is then visible in the ledger instead of quietly re-writing
     what past rounds are compared against. */
  rules: { squadSize: SQUAD_SIZE, maxPerClub: MAX_PER_CLUB, formations: FORMATIONS, clubPicks: 2 },
  weights: { player: PLAYER_WEIGHTS, club: CLUB_WEIGHTS },

  picks: {
    formation: squad.formation.id,
    modelTotal: squad.total,
    players: squad.picks.map((rec) => ({
      id: String(rec.player.id),
      name: rec.player.name,
      clubId: String(rec.player.clubId),
      club: (ctx.clubById[rec.player.clubId] || {}).name || null,
      division: (ctx.clubById[rec.player.clubId] || {}).division || null,
      position: rec.player.position,
      score: rec.score,
      fixture: fixtureOf(rec)
    })),
    captain: String(squad.captain.player.id),
    clubs: clubPicks.map((rec) => ({
      id: String(rec.club.id),
      name: rec.club.name,
      division: rec.club.division,
      score: rec.score,
      percentSelected: rec.club.ownership == null ? null : rec.club.ownership
    })),
    /* Baselines fixed before kick-off. */
    naive: naive ? naive.picks.map((r) => r.id) : [],
    naiveFormation: naive ? naive.formation : null,
    crowdClubs
  },

  universe: {
    columns: ['id', 'clubId', 'position', 'score', 'pointsAtLock', 'available'],
    rows: universe
  },

  /* Every club's cumulative points at lockout, when the feed publishes such
     a column. Stored for all 72 rather than for our two, because the two
     have to be compared with the best two and with the crowd's two, and all
     three comparisons need the same subtraction. When the column does not
     exist this is null and the club grade falls back to match results —
     which is stated on the page rather than papered over. */
  clubUniverse: {
    pointsField: clubPointsField,
    pointsAtLock: clubTotalsAtLock
  },

  /* Filled in by grade-round.mjs after the round settles. Never before. */
  result: null
};

const path = await writeRound(entry);
console.log(`✓ Round ${roundNumber} recorded ${verdict.hoursBeforeLock.toFixed(1)}h before lockout`);
console.log(`  ${entry.picks.formation}: ${entry.picks.players.map((p) => `${p.name} (${p.position})`).join(', ')}`);
console.log(`  Captain: ${entry.picks.players.find((p) => p.id === entry.picks.captain).name}`);
console.log(`  Clubs: ${entry.picks.clubs.map((c) => c.name).join(' and ')}`);
console.log(`  ${universe.length} players in the round, points column "${pointsField || 'none found'}"`);
console.log(`  → ${path.replace(`${process.cwd()}/`, '')}`);
