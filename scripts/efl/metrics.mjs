/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — grading a round's picks.

   Pure maths. No network, no filesystem, no clock. Everything here takes
   the picks that were recorded before a round and the points that were
   actually scored in it, and answers one question: was picking them better
   than not bothering?

   ── WHY THE BASELINES ARE THE POINT ────────────────────────
   "Our seven scored 41" is not a result. Forty-one is good or bad only
   against something, and the something has to be a decision a person could
   actually have made instead:

   · RANDOM — a legal seven drawn at random from the players who were
     available. This is the floor. Beating it says the model is doing
     something; failing to beat it says it is not, however good the prose.
   · NAIVE — the legal seven with the best points-per-appearance so far.
     This is the baseline a spreadsheet gives you in ten minutes, and it is
     the one that matters: a complicated model that cannot beat "pick who
     has been scoring" has earned nothing.
   · CEILING — the best legal seven in hindsight. Nobody reaches it. It
     turns "41" into "41 out of a possible 78", which is the only way to
     read a score without knowing the week.

   Our number is then reported as a PERCENTILE against random, which is
   stable across weeks in a way raw points are not: a 12-point week where
   nobody scored is a better week than a 30-point one where everybody did.

   ── THE MEASURE THAT DOES NOT CARE ABOUT THE SQUAD RULES ───
   A seven is seven data points a week. Spearman rank correlation between
   the score this app gave EVERY player before the round and what they
   actually scored in it is ~1,800 data points a week, and it grades the
   model rather than the squad rules wrapped around it. It is the number to
   watch first. Correlation, not accuracy: the score is a 0-100 rating, not
   a points forecast, so only the ORDER it puts players in can be right.
   ═══════════════════════════════════════════════════════════ */

import { ranks, spearman } from '../projection-compare.mjs';

export { spearman };

/* The game's shape. Duplicated from model.js deliberately: this file must
   be able to grade a round recorded months ago under whatever rules were in
   force then, and importing today's constants would silently re-grade
   history every time they changed. The recorder writes them into the ledger
   entry; the grader reads them back from there and passes them in. */
export const DEFAULT_RULES = {
  squadSize: 7,
  maxPerClub: 2,
  formations: [
    { id: '1-2-2-2', GK: 1, DEF: 2, MID: 2, FWD: 2 },
    { id: '1-2-3-1', GK: 1, DEF: 2, MID: 3, FWD: 1 },
    { id: '1-3-2-1', GK: 1, DEF: 3, MID: 2, FWD: 1 }
  ],
  clubPicks: 2
};

const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'];

/* Seedable PRNG. The random baseline must give the same answer every time
   the round is graded, or "we beat 84% of random sevens" becomes a number
   that drifts each time somebody re-runs the job. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* A stable seed from the round number, so two machines grading the same
   round independently agree to the last decimal. */
export const seedForRound = (round) => (Number(round) || 0) * 7919 + 104729;

/* ── The legal-seven optimiser ────────────────────────────
   Exact, not greedy. Greedy fails on this shape: taking a club's best
   forward can cost you both of its defenders later, and "at most two from
   any one club" is exactly the constraint that makes local choices wrong.

   The method: for each formation, walk the clubs one at a time carrying a
   table of "best total for this many GK/DEF/MID/FWD used so far". Each club
   contributes at most two players, so the per-club options are a short list
   (nothing, one player in some position, two players in some pair of
   positions) and the table has at most 2×4×4×3 live states. Exact, and
   fast enough to run a thousand times for the random baseline. */
function clubOptions(rows, valueOf) {
  /* Per club: the best single pick per position, and the best pair per
     unordered pair of positions (including two from the same position). */
  const byClub = new Map();
  for (const r of rows) {
    const key = String(r.clubId);
    if (!byClub.has(key)) byClub.set(key, []);
    byClub.get(key).push(r);
  }
  const out = [];
  for (const [clubId, list] of byClub) {
    const sorted = list.slice().sort((a, b) => valueOf(b) - valueOf(a));
    const options = [{ counts: { GK: 0, DEF: 0, MID: 0, FWD: 0 }, value: 0, picks: [] }];
    const bestOne = {};
    for (const pos of POSITIONS) {
      const best = sorted.find((r) => r.position === pos);
      if (!best) continue;
      bestOne[pos] = best;
      options.push({
        counts: { GK: 0, DEF: 0, MID: 0, FWD: 0, [pos]: 1 },
        value: valueOf(best), picks: [best]
      });
    }
    for (let i = 0; i < POSITIONS.length; i++) {
      for (let j = i; j < POSITIONS.length; j++) {
        const a = POSITIONS[i]; const b = POSITIONS[j];
        let pair = null;
        if (a === b) {
          const two = sorted.filter((r) => r.position === a).slice(0, 2);
          if (two.length === 2) pair = two;
        } else if (bestOne[a] && bestOne[b]) {
          pair = [bestOne[a], bestOne[b]];
        }
        if (!pair) continue;
        const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
        counts[a] += 1; counts[b] += 1;
        options.push({ counts, value: valueOf(pair[0]) + valueOf(pair[1]), picks: pair });
      }
    }
    out.push({ clubId, options });
  }
  return out;
}

const stateKey = (c) => `${c.GK}|${c.DEF}|${c.MID}|${c.FWD}`;

/**
 * The highest-value legal seven under one formation.
 * @param {Object[]} rows  {id, clubId, position, ...}
 * @param {(row:Object)=>number} valueOf
 * @returns {{picks:Object[], value:number}|null}
 */
export function bestSevenForFormation(rows, valueOf, formation, maxPerClub = 2) {
  const clubs = clubOptions(rows, valueOf);
  let table = new Map([[stateKey({ GK: 0, DEF: 0, MID: 0, FWD: 0 }), { value: 0, picks: [] }]]);

  for (const club of clubs) {
    const next = new Map(table);
    for (const [key, state] of table) {
      const [gk, def, mid, fwd] = key.split('|').map(Number);
      for (const option of club.options) {
        if (!option.picks.length) continue;
        if (option.picks.length > maxPerClub) continue;
        const counts = {
          GK: gk + option.counts.GK, DEF: def + option.counts.DEF,
          MID: mid + option.counts.MID, FWD: fwd + option.counts.FWD
        };
        if (counts.GK > formation.GK || counts.DEF > formation.DEF
          || counts.MID > formation.MID || counts.FWD > formation.FWD) continue;
        const k = stateKey(counts);
        const value = state.value + option.value;
        const seen = next.get(k);
        if (!seen || value > seen.value) {
          next.set(k, { value, picks: state.picks.concat(option.picks) });
        }
      }
    }
    table = next;
  }

  const full = table.get(stateKey(formation));
  return full ? { picks: full.picks, value: full.value } : null;
}

/** The best legal seven across every allowed formation. */
export function bestLegalSeven(rows, valueOf, rules = DEFAULT_RULES) {
  let best = null;
  for (const formation of rules.formations) {
    const found = bestSevenForFormation(rows, valueOf, formation, rules.maxPerClub);
    if (found && (!best || found.value > best.value)) best = { ...found, formation: formation.id };
  }
  return best;
}

/**
 * One legal seven drawn at random. Rejection-free: it fills the formation
 * position by position from the players still allowed by the club cap, so a
 * thin position cannot make it loop forever — it returns null instead, and
 * a null draw is dropped rather than counted as a zero.
 */
export function randomLegalSeven(rows, rng, rules = DEFAULT_RULES) {
  const formation = rules.formations[Math.floor(rng() * rules.formations.length)];
  const used = new Map();
  const picks = [];
  for (const pos of POSITIONS) {
    for (let i = 0; i < formation[pos]; i++) {
      const pool = rows.filter((r) => r.position === pos
        && (used.get(String(r.clubId)) || 0) < rules.maxPerClub
        && !picks.some((p) => p.id === r.id));
      if (!pool.length) return null;
      const pick = pool[Math.floor(rng() * pool.length)];
      picks.push(pick);
      used.set(String(pick.clubId), (used.get(String(pick.clubId)) || 0) + 1);
    }
  }
  return { picks, formation: formation.id };
}

/**
 * The random-seven distribution for one round: how many points a legal
 * seven picked with no information at all would have scored.
 * @returns {{samples:number, mean:number, median:number, percentileOf:(total:number)=>number}}
 */
export function randomSevenDistribution(rows, pointsOf, { round = 0, draws = 2000, rules = DEFAULT_RULES } = {}) {
  const rng = mulberry32(seedForRound(round));
  const totals = [];
  for (let i = 0; i < draws; i++) {
    const seven = randomLegalSeven(rows, rng, rules);
    if (!seven) continue;
    totals.push(seven.picks.reduce((s, p) => s + (pointsOf(p) || 0), 0));
  }
  totals.sort((a, b) => a - b);
  const mean = totals.length ? totals.reduce((s, v) => s + v, 0) / totals.length : null;
  const median = totals.length ? totals[Math.floor(totals.length / 2)] : null;
  return {
    samples: totals.length,
    mean,
    median,
    /* The share of random sevens we beat. Ties count as half, so a round in
       which nobody scored cannot be reported as a 100th-percentile week. */
    percentileOf(total) {
      if (!totals.length) return null;
      let below = 0; let equal = 0;
      for (const t of totals) { if (t < total) below++; else if (t === total) equal++; }
      return (below + equal / 2) / totals.length;
    }
  };
}

/* ── Rank quality ─────────────────────────────────────────
   The model's real exam. Every player who had a fixture, scored before the
   round, against what they actually scored in it. */

/**
 * @param {Array<{score:number, points:number, position?:string}>} pairs
 * @returns {{n:number, rho:number|null, topDecileLift:number|null, byPosition:Object}}
 */
export function rankQuality(pairs) {
  const rows = (pairs || []).filter((p) => p && Number.isFinite(p.score) && Number.isFinite(p.points));
  const rho = rows.length >= 3 ? spearman(rows.map((r) => r.score), rows.map((r) => r.points)) : null;

  /* Lift is the version of the same fact a person can act on: if you only
     ever picked from the top tenth of our ratings, how much more would you
     have scored than picking at random? 1.0 means the rating is worthless. */
  let topDecileLift = null;
  if (rows.length >= 20) {
    const sorted = rows.slice().sort((a, b) => b.score - a.score);
    const cut = Math.max(1, Math.round(sorted.length / 10));
    const top = sorted.slice(0, cut);
    const all = rows.reduce((s, r) => s + r.points, 0) / rows.length;
    const tops = top.reduce((s, r) => s + r.points, 0) / top.length;
    topDecileLift = all === 0 ? null : tops / all;
  }

  const byPosition = {};
  for (const pos of POSITIONS) {
    const subset = rows.filter((r) => r.position === pos);
    byPosition[pos] = subset.length >= 3
      ? { n: subset.length, rho: spearman(subset.map((r) => r.score), subset.map((r) => r.points)) }
      : { n: subset.length, rho: null };
  }

  return { n: rows.length, rho, topDecileLift, byPosition };
}

/* ── The captain ──────────────────────────────────────────
   Deliberately NOT scored as "points × the multiplier". This app has never
   verified what the official multiplier is, and inventing one would put a
   number on the page that no measurement supports.

   What is measurable without it: whether the armband went to the best
   scorer of the seven we picked, and how much was left on the table by it
   not doing so. Whatever the multiplier turns out to be, the loss is that
   gap times (multiplier − 1) — so the gap is the honest quantity, and it is
   also the one that says whether the choice was any good. */
export function captainQuality(sevenPoints, captainId) {
  const rows = (sevenPoints || []).filter((r) => r && Number.isFinite(r.points));
  if (!rows.length || captainId == null) return null;
  const captain = rows.find((r) => String(r.id) === String(captainId));
  if (!captain) return null;
  const sorted = rows.slice().sort((a, b) => b.points - a.points);
  const best = sorted[0];
  const mean = rows.reduce((s, r) => s + r.points, 0) / rows.length;
  /* Rank with ties shared, so three players on 6 do not make the armband
     look like a miss when it landed on one of them. */
  const rank = 1 + rows.filter((r) => r.points > captain.points).length;
  return {
    id: captain.id,
    points: captain.points,
    rank,
    ties: rows.filter((r) => r.points === captain.points).length,
    wasBest: captain.points === best.points,
    bestPoints: best.points,
    bestId: best.id,
    /* What a perfect armband would have added, per extra multiple. */
    foregonePerMultiple: best.points - captain.points,
    /* Better than the average of our own seven? A captain that is not is a
       captain that lost points against picking one out of a hat. */
    vsOwnMean: captain.points - mean
  };
}

/* ── Clubs ────────────────────────────────────────────────
   The official game's club scoring is not published to this app, and this
   file will not invent a tariff to fill the hole. Two of them are graded
   instead:

   1. If the feed carries a cumulative club points figure, the difference
      across the round IS the official score. Real, and used when present.
   2. Otherwise, the observable result — win, draw, loss, goals for and
      against, clean sheet. Not the game's currency, but not a guess either,
      and enough to say whether the picks backed the right sides.

   Which of the two was used is recorded per round, so a season table can
   never blend them silently. */
export function clubOutcome(fixtures) {
  const played = (fixtures || []).filter((f) => f && f.goalsFor != null && f.goalsAgainst != null);
  const out = {
    played: played.length,
    wins: 0, draws: 0, losses: 0,
    goalsFor: 0, goalsAgainst: 0, cleanSheets: 0
  };
  for (const f of played) {
    out.goalsFor += f.goalsFor;
    out.goalsAgainst += f.goalsAgainst;
    if (f.goalsAgainst === 0) out.cleanSheets += 1;
    if (f.goalsFor > f.goalsAgainst) out.wins += 1;
    else if (f.goalsFor === f.goalsAgainst) out.draws += 1;
    else out.losses += 1;
  }
  out.leaguePoints = out.wins * 3 + out.draws;  /* football's own currency, not the game's */
  return out;
}

/**
 * Grade the two club picks against every club that played.
 * @param {string[]} pickedIds
 * @param {Object} outcomes  clubId -> clubOutcome()
 * @param {Object} [points]  clubId -> official round points, when the feed has them
 */
export function clubQuality(pickedIds, outcomes, points) {
  const ids = (pickedIds || []).map(String);
  const all = Object.keys(outcomes || {});
  if (!ids.length || !all.length) return null;

  const hasPoints = points && ids.every((id) => Number.isFinite(points[id]));
  const valueOf = (id) => (hasPoints ? points[id] : (outcomes[id] ? outcomes[id].leaguePoints : null));
  const field = all.map(valueOf).filter(Number.isFinite);
  const mine = ids.map(valueOf).filter(Number.isFinite);

  const fieldMean = field.length ? field.reduce((s, v) => s + v, 0) / field.length : null;
  const sorted = field.slice().sort((a, b) => b - a);
  const bestTwo = sorted.slice(0, ids.length).reduce((s, v) => s + v, 0);

  return {
    basis: hasPoints ? 'official-points' : 'match-result',
    total: mine.reduce((s, v) => s + v, 0),
    perClub: ids.map((id) => ({ id, value: valueOf(id), outcome: outcomes[id] || null })),
    fieldMean,
    /* Two average clubs, for the same reason the random seven exists. */
    fieldMeanTwo: fieldMean == null ? null : fieldMean * ids.length,
    bestTwo,
    /* Where our two sat among all pairs, approximated by each club's own
       percentile — exact pair enumeration adds nothing at 72 clubs. */
    percentile: field.length
      ? mine.reduce((s, v) => s + (field.filter((f) => f < v).length
        + field.filter((f) => f === v).length / 2) / field.length, 0) / Math.max(1, mine.length)
      : null
  };
}

/* ── The round card ───────────────────────────────────────
   Everything above, assembled into the object a season table reads. Takes
   only data; the caller does the fetching and the file writing. */
export function gradeRound({
  round, picks, actual, rules = DEFAULT_RULES, universe, clubOutcomes, clubPoints, draws = 2000
}) {
  const pointsById = new Map(Object.entries(actual || {}).map(([id, v]) => [String(id), v]));
  const pointsOf = (row) => {
    const v = pointsById.get(String(row.id));
    return Number.isFinite(v) ? v : null;
  };

  /* Only players who could have been picked belong in any comparison. A
     universe including players with no fixture would flatter every baseline
     by padding it with guaranteed zeroes. */
  const eligible = (universe || []).filter((r) => r && r.position && r.clubId != null
    && Number.isFinite(pointsById.get(String(r.id))));

  const seven = (picks.players || []).map((p) => ({
    ...p, points: pointsById.has(String(p.id)) ? pointsById.get(String(p.id)) : null
  }));
  const scored = seven.filter((p) => Number.isFinite(p.points));
  const total = scored.reduce((s, p) => s + p.points, 0);

  const random = randomSevenDistribution(eligible, (r) => pointsById.get(String(r.id)) || 0,
    { round, draws, rules });
  const ceiling = bestLegalSeven(eligible, (r) => pointsById.get(String(r.id)) || 0, rules);

  /* The naive seven was chosen BEFORE the round from season form alone and
     written into the ledger then. Grading it here would let hindsight into
     the baseline, which is the one place it must never get. */
  const naiveIds = (picks.naive || []).map(String);
  const naive = naiveIds.length
    ? naiveIds.reduce((s, id) => s + (pointsById.get(id) || 0), 0)
    : null;

  const fieldPoints = eligible.map((r) => pointsById.get(String(r.id)));
  const fieldMean = fieldPoints.length
    ? fieldPoints.reduce((s, v) => s + v, 0) / fieldPoints.length : null;

  return {
    squad: {
      players: seven.map((p) => ({ id: p.id, name: p.name, club: p.club, position: p.position, points: p.points })),
      total,
      unresolved: seven.length - scored.length,
      formation: picks.formation || null
    },
    captain: captainQuality(scored, picks.captain),
    clubs: clubQuality(picks.clubs || [], clubOutcomes || {}, clubPoints),
    baselines: {
      randomMean: random.mean,
      randomMedian: random.median,
      randomSamples: random.samples,
      percentile: random.percentileOf(total),
      naive,
      ceiling: ceiling ? ceiling.value : null,
      ceilingFormation: ceiling ? ceiling.formation : null,
      fieldMean,
      fieldMeanSeven: fieldMean == null ? null : fieldMean * rules.squadSize
    },
    model: rankQuality((picks.scores || []).map(([id, score]) => {
      const row = (universe || []).find((r) => String(r.id) === String(id));
      return {
        score,
        points: pointsById.has(String(id)) ? pointsById.get(String(id)) : NaN,
        position: row ? row.position : null
      };
    })),
    universe: { players: eligible.length }
  };
}

/* ── The season ───────────────────────────────────────────
   Rounds are not interchangeable — a round with fewer fixtures scores less
   for everyone — so the season figures that matter are the ones already
   normalised per round: the percentile, the share of the ceiling reached,
   and the correlation. Totals are reported too, because people want them,
   but the percentile is the number that means something. */
export function seasonSummary(rounds) {
  const graded = (rounds || []).filter((r) => r && r.result && r.result.attribution === 'clean');
  if (!graded.length) return { rounds: 0, graded: 0 };

  const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
  const num = (f) => graded.map(f).filter(Number.isFinite);

  const ours = num((r) => r.result.squad.total);
  const percentiles = num((r) => r.result.baselines.percentile);
  const ceilingShare = graded
    .map((r) => (r.result.baselines.ceiling ? r.result.squad.total / r.result.baselines.ceiling : null))
    .filter(Number.isFinite);

  return {
    rounds: (rounds || []).length,
    graded: graded.length,
    ours: { total: ours.reduce((s, v) => s + v, 0), mean: mean(ours) },
    random: { total: num((r) => r.result.baselines.randomMean).reduce((s, v) => s + v, 0), mean: mean(num((r) => r.result.baselines.randomMean)) },
    naive: { total: num((r) => r.result.baselines.naive).reduce((s, v) => s + v, 0), mean: mean(num((r) => r.result.baselines.naive)) },
    ceiling: { total: num((r) => r.result.baselines.ceiling).reduce((s, v) => s + v, 0), mean: mean(num((r) => r.result.baselines.ceiling)) },
    percentile: { mean: mean(percentiles), rounds: percentiles.length },
    ceilingShare: mean(ceilingShare),
    beatRandom: graded.filter((r) => Number.isFinite(r.result.baselines.randomMean)
      && r.result.squad.total > r.result.baselines.randomMean).length,
    beatNaive: graded.filter((r) => Number.isFinite(r.result.baselines.naive)
      && r.result.squad.total > r.result.baselines.naive).length,
    rho: { mean: mean(num((r) => r.result.model.rho)) },
    topDecileLift: { mean: mean(num((r) => r.result.model.topDecileLift)) },
    captain: {
      graded: graded.filter((r) => r.result.captain).length,
      best: graded.filter((r) => r.result.captain && r.result.captain.wasBest).length,
      aboveOwnMean: graded.filter((r) => r.result.captain && r.result.captain.vsOwnMean > 0).length,
      foregone: num((r) => r.result.captain && r.result.captain.foregonePerMultiple)
        .reduce((s, v) => s + v, 0)
    },
    clubs: {
      basis: [...new Set(graded.map((r) => r.result.clubs && r.result.clubs.basis).filter(Boolean))],
      total: num((r) => r.result.clubs && r.result.clubs.total).reduce((s, v) => s + v, 0),
      fieldMeanTotal: num((r) => r.result.clubs && r.result.clubs.fieldMeanTwo).reduce((s, v) => s + v, 0),
      percentile: mean(num((r) => r.result.clubs && r.result.clubs.percentile))
    }
  };
}

export { ranks };
