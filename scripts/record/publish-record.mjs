/* ═══════════════════════════════════════════════════════════
   GAMEWEEK EDGE — the public projection of the FPL ledger.

   Builds www/record/record.json: what was picked, what it scored, and the
   season figures. Nothing is computed here that is not already in the
   ledger — the page and the app scorecard read this one file and compute
   nothing of their own, so they cannot disagree with the evidence.
   ═══════════════════════════════════════════════════════════ */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readLedger, ROOT } from './lib.mjs';
import { seasonSummary } from './metrics.mjs';

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

export function buildPublicRecord(entries, generatedAt = new Date().toISOString()) {
  const gameweeks = (entries || []).map((e) => {
    const r = e.result;
    const pts = new Map(((r && r.totw && r.totw.players) || []).map((p) => [String(p.id), p.points]));
    return {
      gw: e.gw,
      recordedAt: e.recordedAt,
      deadlineAt: e.deadlineAt,
      hoursBeforeDeadline: e.hoursBeforeDeadline,
      totw: {
        formation: e.picks.totw.formation,
        modelTotal: e.picks.totw.modelTotal,
        players: e.picks.totw.players.map((p) => ({
          id: p.id, name: p.name, team: p.team, position: p.position, xp: p.xp, fixture: p.fixture,
          points: pts.has(String(p.id)) ? pts.get(String(p.id)) : null
        }))
      },
      captain: { id: e.picks.captain.id, name: e.picks.captain.name, team: e.picks.captain.team, xp: e.picks.captain.xp,
        alternatives: (e.picks.captain.alternatives || []).map((a) => ({ name: a.name, team: a.team, xp: a.xp })) },
      prices: (e.picks.prices || []).map((p, i) => {
        const g = r && r.prices && r.prices.rows ? r.prices.rows[i] : null;
        return { id: p.id, name: p.name, team: p.team, dir: p.dir, prob: p.prob,
          moved: g ? g.moved : null, hit: g ? g.hit : null };
      }),
      naiveXI: e.picks.naiveXI ? { formation: e.picks.naiveXI.formation, players: e.picks.naiveXI.players.length } : null,
      graded: !!r,
      result: r ? {
        gradedAt: r.gradedAt,
        totw: { total: r.totw.total, withCaptain: r.totw.withCaptain, average: r.totw.average,
          highest: r.totw.highest, beatAverage: r.totw.beatAverage, naive: r.totw.naive,
          beatNaive: r.totw.beatNaive, unresolved: r.totw.unresolved },
        captain: r.captain ? { points: r.captain.points, rank: r.captain.rank, of: r.captain.of, played: r.captain.played } : null,
        prices: { hits: r.prices.hits, graded: r.prices.graded, rate: r3(r.prices.rate) }
      } : null
    };
  });

  const s = seasonSummary(entries || []);
  const season = {
    recorded: s.recorded, graded: s.graded,
    totw: { meanPoints: r1(s.totw.meanPoints), meanAverage: r1(s.totw.meanAverage), beatAverage: s.totw.beatAverage,
      averageGraded: s.totw.averageGraded, meanNaive: r1(s.totw.meanNaive), beatNaive: s.totw.beatNaive, naiveGraded: s.totw.naiveGraded },
    captain: s.captain,
    prices: { graded: s.prices.graded, hits: s.prices.hits, rate: r3(s.prices.rate) }
  };

  const ledgerUpdatedAt = (entries || [])
    .flatMap((e) => [e.recordedAt, e.result && e.result.gradedAt])
    .filter((t) => t && isFinite(Date.parse(t))).sort().pop() || null;

  return {
    generatedAt,
    ledgerUpdatedAt,
    method: {
      recorded: 'inside the 36 hours before each deadline, from the same functions the app runs; never after a deadline, never overwritten',
      totw: 'the sum of the eleven players\' official gameweek points, no captain doubling, against the average manager score FPL publishes and against a form XI fixed at the same moment',
      captain: 'his rank by official points among every player who took the field that gameweek',
      prices: 'a hit is a price that moved the way the model said, between the record and the grade',
      notGraded: 'a null field means the official feed did not publish the input; nothing is estimated'
    },
    season,
    gameweeks
  };
}

export async function publishRecord(outDir) {
  const entries = await readLedger();
  const record = buildPublicRecord(entries);
  const dir = outDir || join(ROOT, 'www', 'record');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
  return { path: join(dir, 'record.json'), gameweeks: record.gameweeks.length, graded: record.season.graded || 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await publishRecord();
  console.log(`✓ ${out.path} — ${out.gameweeks} gameweek(s), ${out.graded} graded`);
}
