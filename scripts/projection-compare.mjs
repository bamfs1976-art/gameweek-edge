/*
 * Pure comparison maths for rival projections. No network, no engine, no file
 * reads — so the scoring can be tested without a live season, which is the
 * only way to know it works before the one week a year it matters.
 *
 * The unit throughout is a ROW: {name, team, rival, ours, actual}. `rival` and
 * `ours` are projected points over the same gameweek window; `actual` is what
 * the player really scored, and is null until the window has been played.
 */

/* Accents and case go, because the rival writes "Sesko" and "Gyokeres" as
   often as "Šeško" and "Gyökeres", and a checker that reported half its rows as
   unmatched would be read as "they projected players who do not exist". */
export const normName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z ]/g, '').trim();

/* Match a rival's row to a real player, SCOPED to the club they state.
   Two forwards share a surname often enough that a league-wide search would
   quietly pair the wrong one — and a wrong pairing is worse than no pairing,
   because it produces a number instead of a gap. Returns null rather than
   guessing whenever more than one candidate survives. */
export function matchPlayer(els, teams, name, teamLabel) {
  const n = normName(name), last = n.split(' ').pop();
  const club = (teams || []).find((t) => normName(t.name) === normName(teamLabel) ||
    normName(t.short_name) === normName(teamLabel));
  /* A club label that resolves to nothing is a defect in the rival file, not
     an invitation to search the whole league on a surname. Falling back would
     turn a visible "unmatched" row into an invisible wrong pairing, and the
     unmatched list is printed on every run precisely so the defect gets
     fixed. */
  if (teamLabel && !club) return null;
  const pool = club ? els.filter((e) => e.team === club.id) : els;
  const exact = pool.filter((e) => normName(e.web_name) === n ||
    normName(e.first_name + ' ' + e.second_name) === n);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const bySurname = pool.filter((e) => normName(e.web_name).split(' ').pop() === last ||
    normName(e.second_name).split(' ').pop() === last);
  return bySurname.length === 1 ? bySurname[0] : null;
}

/* Spearman rank correlation. Ranks rather than values because the two models
   are not on the same scale and never will be: a projection that is uniformly
   15% low is perfectly useful for picking a squad and would look terrible on
   any absolute measure. What matters is whether they agree on the ORDER.

   Ties take the average rank, so twenty players all projected 4.28 do not
   silently become an arbitrary order that inflates or destroys the score. */
export function ranks(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

export function spearman(a, b) {
  if (a.length !== b.length || a.length < 3) return null;
  const ra = ranks(a), rb = ranks(b);
  const n = a.length;
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / n;
  const ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i] - ma, y = rb[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

export const mae = (pairs) => (pairs.length
  ? pairs.reduce((s, [x, y]) => s + Math.abs(x - y), 0) / pairs.length : null);

/* Signed, so a model that is consistently high reads differently from one that
   is merely noisy. Two models with the same MAE and opposite bias are two very
   different problems. */
export const bias = (pairs) => (pairs.length
  ? pairs.reduce((s, [x, y]) => s + (x - y), 0) / pairs.length : null);

/* Where the two disagree most, which is the only part anyone reads. Returned
   with the sign kept so "we are higher" and "they are higher" stay distinct. */
export function disagreements(rows, n = 8) {
  return rows.filter((r) => r.ours != null && r.rival != null)
    .map((r) => ({ ...r, gap: r.ours - r.rival }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, n);
}

/* Grade both against what happened. Returns null for a side with no
   projections rather than a flattering zero — an absent model has not won. */
export function score(rows) {
  const played = rows.filter((r) => r.actual != null);
  const ourPairs = played.filter((r) => r.ours != null).map((r) => [r.ours, r.actual]);
  const rivalPairs = played.filter((r) => r.rival != null).map((r) => [r.rival, r.actual]);
  /* Correlation is computed on the players BOTH models projected. Scoring each
     on its own subset would let a model win by declining to project the hard
     ones — exactly the incentive a published scorecard must not create. */
  const both = played.filter((r) => r.ours != null && r.rival != null);
  return {
    n: played.length,
    bothProjected: both.length,
    ours: ourPairs.length ? { n: ourPairs.length, mae: mae(ourPairs), bias: bias(ourPairs) } : null,
    rival: rivalPairs.length ? { n: rivalPairs.length, mae: mae(rivalPairs), bias: bias(rivalPairs) } : null,
    rank: both.length >= 3 ? {
      ours: spearman(both.map((r) => r.ours), both.map((r) => r.actual)),
      rival: spearman(both.map((r) => r.rival), both.map((r) => r.actual))
    } : null
  };
}

/* Who won, stated only when the gap is worth stating. Thirty forwards over one
   five-week window is a small sample: a 0.2-point MAE difference is noise
   wearing a decimal point, and publishing it as a win would be the same sin
   this whole checker exists to catch. */
export const MIN_MEANINGFUL_MAE = 0.5;
export function verdict(s) {
  if (!s || !s.ours || !s.rival) return { call: 'incomplete', why: 'one side has no projections' };
  const d = s.rival.mae - s.ours.mae;
  if (s.bothProjected < 10) {
    return { call: 'too few', why: 'only ' + s.bothProjected + ' players projected by both' };
  }
  if (Math.abs(d) < MIN_MEANINGFUL_MAE) {
    return { call: 'level', why: 'MAE differs by ' + Math.abs(d).toFixed(2) +
      ', under the ' + MIN_MEANINGFUL_MAE + ' worth calling on ' + s.bothProjected + ' players' };
  }
  return { call: d > 0 ? 'ours' : 'theirs',
    why: 'MAE ' + s.ours.mae.toFixed(2) + ' vs ' + s.rival.mae.toFixed(2) +
      ' over ' + s.bothProjected + ' players' };
}
