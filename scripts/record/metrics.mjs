/* ═══════════════════════════════════════════════════════════
   GAMEWEEK EDGE — grading a gameweek's picks. Pure maths.

   Three calls are recorded before every deadline and graded after it, each
   against something a manager could actually have done instead:

   · TEAM OF THE WEEK — the model's best legal XI by expected points. Graded
     as the XI's real points (the sum of the eleven, no captain, no bench)
     against two bars: the AVERAGE MANAGER SCORE that gameweek, which FPL
     publishes, and a NAIVE FORM XI — the best legal XI by FPL's own `form`
     figure, chosen in the same breath as our picks so hindsight never
     touches it. The same XI with our captain doubled is reported beside it
     because that is closer to what a manager would have scored, but the
     honest headline is the undoubled sum: FPL's average includes captains,
     bench boosts and auto-subs, so the two are not the same measure and
     the page says so.

   · CAPTAIN — his rank by points among every player who played that
     gameweek. Rank 1 means the model named the top scorer.

   · PRICE PREDICTIONS — the five most likely moves. A hit is a price that
     moved in the predicted direction between the record and the grade.

   Every input comes from the official feed. Where one is missing the field
   is null, which the page renders as "not graded" — never an estimate.
   ═══════════════════════════════════════════════════════════ */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Points per element from the live document: { id: total_points } and who played. */
export function livePoints(live) {
  const points = {}, played = {};
  for (const e of (live && live.elements) || []) {
    const s = e.stats || {};
    if (e.id == null) continue;
    points[String(e.id)] = num(s.total_points) == null ? 0 : Number(s.total_points);
    played[String(e.id)] = (Number(s.minutes) || 0) > 0;
  }
  return { points, played };
}

export function xiPoints(ids, points) {
  const rows = (ids || []).map((id) => ({ id: String(id), points: points[String(id)] }));
  const scored = rows.filter((r) => Number.isFinite(r.points));
  return {
    rows,
    total: scored.reduce((s, r) => s + r.points, 0),
    unresolved: rows.length - scored.length
  };
}

/** Rank of a player among every player who took the field, 1 = top scorer. */
export function captainRank(captainId, points, played) {
  const id = String(captainId);
  if (!(id in points)) return null;
  const mine = points[id];
  const field = Object.keys(points).filter((k) => played[k]);
  if (!field.length) return null;
  const above = field.filter((k) => points[k] > mine).length;
  return { points: mine, rank: above + 1, of: field.length, played: !!played[id] };
}

/** A price call is a hit when the price moved the way it said. */
export function priceHits(calls, costNow) {
  const rows = (calls || []).map((c) => {
    const now = num(costNow[String(c.id)]);
    const moved = now == null || c.cost == null ? null : now - c.cost;
    const hit = moved == null ? null : (c.dir === 'rise' ? moved > 0 : c.dir === 'fall' ? moved < 0 : false);
    return { id: String(c.id), dir: c.dir, prob: c.prob, costThen: c.cost, costNow: now, moved, hit };
  });
  const graded = rows.filter((r) => r.hit != null);
  return {
    rows,
    hits: graded.filter((r) => r.hit).length,
    graded: graded.length,
    rate: graded.length ? graded.filter((r) => r.hit).length / graded.length : null
  };
}

/**
 * Grade one recorded gameweek.
 * @param {Object} entry        the ledger entry (picks recorded before the deadline)
 * @param {Object} live         event/{gw}/live
 * @param {Object} bootNow      bootstrap-static now (average score, prices)
 * @param {string} gradedAt     ISO timestamp
 */
export function gradeEntry(entry, live, bootNow, gradedAt = new Date().toISOString()) {
  const { points, played } = livePoints(live);
  const ev = ((bootNow && bootNow.events) || []).find((e) => Number(e.id) === Number(entry.gw)) || null;
  const average = ev && num(ev.average_entry_score) > 0 ? Number(ev.average_entry_score) : null;
  const highest = ev && num(ev.highest_score) > 0 ? Number(ev.highest_score) : null;

  const totwIds = ((entry.picks.totw || {}).players || []).map((p) => p.id);
  const totw = xiPoints(totwIds, points);
  const capId = entry.picks.captain && entry.picks.captain.id;
  const capPts = capId != null && Number.isFinite(points[String(capId)]) ? points[String(capId)] : null;
  const withCaptain = capPts == null ? null : totw.total + capPts;

  const naiveIds = ((entry.picks.naiveXI || {}).players || []).map((p) => p.id);
  const naive = naiveIds.length ? xiPoints(naiveIds, points) : null;

  const costNow = {};
  for (const e of (bootNow && bootNow.elements) || []) costNow[String(e.id)] = e.now_cost;

  return {
    gradedAt,
    totw: {
      players: totw.rows,
      total: totw.total,
      unresolved: totw.unresolved,
      withCaptain,
      average,
      highest,
      beatAverage: average == null ? null : totw.total > average,
      naive: naive ? naive.total : null,
      beatNaive: naive ? totw.total > naive.total : null
    },
    captain: capId == null ? null : captainRank(capId, points, played),
    prices: priceHits(entry.picks.prices || [], costNow)
  };
}

/* ── The season ───────────────────────────────────────── */
export function seasonSummary(entries) {
  const graded = (entries || []).filter((e) => e && e.result);
  const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
  const num2 = (f) => graded.map(f).filter(Number.isFinite);
  const withAvg = graded.filter((e) => Number.isFinite(e.result.totw.average));
  const withNaive = graded.filter((e) => Number.isFinite(e.result.totw.naive));
  const capRanks = num2((e) => e.result.captain && e.result.captain.rank);
  const priced = graded.filter((e) => e.result.prices && e.result.prices.graded > 0);
  const priceHitsN = priced.reduce((s, e) => s + e.result.prices.hits, 0);
  const priceGradedN = priced.reduce((s, e) => s + e.result.prices.graded, 0);
  const sorted = capRanks.slice().sort((a, b) => a - b);
  return {
    recorded: (entries || []).length,
    graded: graded.length,
    totw: {
      meanPoints: mean(num2((e) => e.result.totw.total)),
      meanAverage: withAvg.length ? mean(withAvg.map((e) => e.result.totw.average)) : null,
      beatAverage: withAvg.filter((e) => e.result.totw.beatAverage).length,
      averageGraded: withAvg.length,
      meanNaive: withNaive.length ? mean(withNaive.map((e) => e.result.totw.naive)) : null,
      beatNaive: withNaive.filter((e) => e.result.totw.beatNaive).length,
      naiveGraded: withNaive.length
    },
    captain: {
      graded: capRanks.length,
      medianRank: sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null,
      top10: capRanks.filter((r) => r <= 10).length,
      top: capRanks.filter((r) => r === 1).length
    },
    prices: {
      graded: priceGradedN,
      hits: priceHitsN,
      rate: priceGradedN ? priceHitsN / priceGradedN : null
    }
  };
}
