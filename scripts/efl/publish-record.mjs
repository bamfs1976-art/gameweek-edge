/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — the public projection of the ledger.

   The ledger files carry everything needed to re-grade a round years later:
   every player's rating, every player's season total at lockout, the club
   points column, the rules in force. That is roughly 70kB per round and
   none of it belongs in a phone's data allowance.

   This builds the small file the website reads: what was picked, what it
   scored, and what the alternatives scored. Nothing is computed here that
   is not already in the ledger — the page and the ledger cannot disagree,
   because the page has no second source.
   ═══════════════════════════════════════════════════════════ */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readLedger, ROOT } from './lib.mjs';
import { seasonSummary } from './metrics.mjs';

const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const round3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

/** @param {Object[]} entries — the ledger, oldest round first. */
export function buildPublicRecord(entries, generatedAt = new Date().toISOString()) {
  const rounds = (entries || []).map((e) => {
    const r = e.result;
    const pointsById = new Map(((r && r.squad && r.squad.players) || []).map((p) => [String(p.id), p.points]));

    return {
      round: e.round,
      recordedAt: e.recordedAt,
      lockoutAt: e.lockoutAt,
      hoursBeforeLock: e.hoursBeforeLock,
      formation: e.picks.formation,
      captain: e.picks.captain,
      players: e.picks.players.map((p) => ({
        id: p.id,
        name: p.name,
        club: p.club,
        division: p.division,
        position: p.position,
        score: p.score,
        fixture: p.fixture,
        points: pointsById.has(String(p.id)) ? pointsById.get(String(p.id)) : null
      })),
      clubs: e.picks.clubs.map((c, i) => {
        const graded = r && r.clubs && r.clubs.perClub ? r.clubs.perClub[i] : null;
        return {
          id: c.id, name: c.name, division: c.division, score: c.score,
          value: graded ? graded.value : null,
          outcome: graded ? graded.outcome : null
        };
      }),
      graded: Boolean(r),
      result: r ? {
        gradedAt: r.gradedAt,
        attribution: r.attribution,
        clubBasis: r.clubBasis,
        fixtures: r.fixtures,
        total: r.squad.total,
        unresolved: r.squad.unresolved,
        captain: r.captain ? {
          points: r.captain.points,
          rank: r.captain.rank,
          wasBest: r.captain.wasBest,
          bestPoints: r.captain.bestPoints,
          foregonePerMultiple: r.captain.foregonePerMultiple,
          vsOwnMean: round1(r.captain.vsOwnMean)
        } : null,
        clubs: r.clubs ? {
          basis: r.clubs.basis,
          total: r.clubs.total,
          fieldMeanTwo: round1(r.clubs.fieldMeanTwo),
          bestTwo: r.clubs.bestTwo,
          percentile: round3(r.clubs.percentile),
          crowd: r.crowdClubs ? r.crowdClubs.value : null
        } : null,
        baselines: {
          randomMean: round1(r.baselines.randomMean),
          naive: r.baselines.naive,
          ceiling: r.baselines.ceiling,
          fieldMeanSeven: round1(r.baselines.fieldMeanSeven),
          percentile: round3(r.baselines.percentile)
        },
        model: {
          n: r.model.n,
          rho: round3(r.model.rho),
          topDecileLift: round3(r.model.topDecileLift),
          byPosition: Object.fromEntries(Object.entries(r.model.byPosition || {})
            .map(([k, v]) => [k, { n: v.n, rho: round3(v.rho) }]))
        }
      } : null
    };
  });

  /* Rounded once, here, rather than in the page: a figure that renders as
     35.1 in one place and 35.06 in another reads as two different numbers.
     Correlations keep three places because the third one moves. */
  const season = roundNumbers(seasonSummary(entries || []));

  return {
    generatedAt,
    /* Stated in the file rather than assumed by the page: a reader who
       downloads this should not have to read our source to know that the
       season figures deliberately exclude rounds whose points could not be
       pinned to one round. */
    method: {
      pointsFrom: 'the difference between each player\'s cumulative season total at lockout and after the round',
      attribution: 'rounds whose window overlapped a later round are marked "ambiguous" and excluded from the season figures',
      captain: 'graded on where the armband landed within our own seven, not on a points multiplier this app has never verified',
      clubs: 'graded on official club points when the feed publishes them, otherwise on the match result'
    },
    season,
    rounds
  };
}

/* Points and totals to one place, correlations and shares to three. */
function roundNumbers(value, key = '') {
  if (Array.isArray(value)) return value.map((v) => roundNumbers(v, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundNumbers(v, k)]));
  }
  if (!Number.isFinite(value)) return value;
  const fine = /rho|percentile|Share|[Ll]ift/.test(key);
  return fine ? round3(value) : round1(value);
}

/* CLI / build-step use. */
export async function publishRecord(outDir) {
  const entries = await readLedger();
  const record = buildPublicRecord(entries);
  const dir = outDir || join(ROOT, 'www', 'fantasy-efl', 'data');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
  return { path: join(dir, 'record.json'), rounds: record.rounds.length, graded: record.season.graded || 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await publishRecord();
  console.log(`✓ ${out.path} — ${out.rounds} round(s), ${out.graded} graded`);
}
