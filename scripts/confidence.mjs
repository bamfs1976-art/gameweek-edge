/* ═══════════════════════════════════════════════════════════
   GAMEWEEK EDGE — is a gain real, or luck? A paired block bootstrap.

   Every accuracy claim this repo makes compares two forecasts on the same
   player-gameweeks: the new model against the one it replaces, the model
   against recent form, the Team of the Week against a form XI. A smaller
   average error on one season can still be noise, and the rows are not
   independent: one gameweek's surprises (a red card, a rotated XI, a goal
   fest) move hundreds of rows together. Resampling rows one at a time
   would treat those hundreds as separate evidence and give an interval far
   too narrow.

   So the unit is the gameweek. Draw as many gameweeks as there are, with
   replacement, recompute the difference on that resample, repeat a few
   thousand times, and read the 2.5th and 97.5th percentiles. Both models
   are scored on the same drawn gameweeks (paired), so the luck of the week
   cancels and only the difference between them is left.

   The verdict is deliberately strict: a change is "better" only when the
   whole interval is on the right side of zero. Anything else is "unclear",
   and a claim that is unclear is reported as unclear.

   Adopted from Prem Predict (github.com/GiwinEdwin09/FPL-Predictor, MIT),
   which gates every model promotion on the same test. Pure maths, seeded,
   so a rerun prints the same interval.
   ═══════════════════════════════════════════════════════════ */

/* Small, fast, seedable generator; Math.random cannot be seeded. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const quantile = (sorted, q) => {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/* Below this many blocks a percentile interval is too coarse to trust, and
   the result says so rather than letting a tidy number imply certainty. */
export const THIN_BLOCKS = 8;

/**
 * Bootstrap any statistic over blocks.
 * @param {Array} blocks              one entry per block (a gameweek), any shape
 * @param {(sample: Array) => number} stat  the statistic of a list of blocks
 * @param {{reps?: number, seed?: number, level?: number}} [opts]
 * @returns {{estimate: number, lo: number, hi: number, blocks: number, reps: number, level: number, thin: boolean, below: number}}
 *   `below` is the share of resamples with the statistic under zero.
 */
export function blockBootstrap(blocks, stat, { reps = 2000, seed = 20261003, level = 0.95 } = {}) {
  const n = blocks.length;
  const estimate = n ? stat(blocks) : NaN;
  if (n < 2) return { estimate, lo: NaN, hi: NaN, blocks: n, reps: 0, level, thin: true, below: NaN };
  const rnd = mulberry32(seed), draws = [], sample = new Array(n);
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < n; i++) sample[i] = blocks[Math.floor(rnd() * n)];
    const v = stat(sample);
    if (Number.isFinite(v)) draws.push(v);
  }
  draws.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  return {
    estimate,
    lo: quantile(draws, tail),
    hi: quantile(draws, 1 - tail),
    blocks: n,
    reps: draws.length,
    level,
    thin: n < THIN_BLOCKS,
    below: draws.length ? draws.filter((v) => v < 0).length / draws.length : NaN,
  };
}

/**
 * Paired difference in mean loss, B minus A, resampling whole blocks.
 * Negative means B has the lower loss. Rows are pooled, so a gameweek with
 * more graded players carries more weight, exactly as in the headline mean.
 *
 * @param {Array} rows
 * @param {{block: (r) => any, a: (r) => number, b: (r) => number}} keys
 *   `a` and `b` give each row's loss under the two forecasts (absolute
 *   error, squared error, Brier, log loss: anything averaged).
 */
export function pairedDelta(rows, { block, a, b }, opts) {
  const by = new Map();
  for (const r of rows) {
    const la = a(r), lb = b(r);
    if (!Number.isFinite(la) || !Number.isFinite(lb)) continue;
    const k = block(r);
    let s = by.get(k);
    if (!s) by.set(k, (s = { n: 0, a: 0, b: 0 }));
    s.n++; s.a += la; s.b += lb;
  }
  const blocks = [...by.values()];
  const res = blockBootstrap(blocks, (xs) => {
    let n = 0, d = 0;
    for (const s of xs) { n += s.n; d += s.b - s.a; }
    return n ? d / n : NaN;
  }, opts);
  const n = blocks.reduce((t, s) => t + s.n, 0);
  return { ...res, n, meanA: n ? blocks.reduce((t, s) => t + s.a, 0) / n : NaN, meanB: n ? blocks.reduce((t, s) => t + s.b, 0) / n : NaN };
}

/**
 * Mean of one value per block (a gameweek margin, a per-gameweek rank
 * correlation difference), with its interval.
 */
export function meanOfBlocks(values, opts) {
  const xs = values.filter(Number.isFinite);
  return blockBootstrap(xs, (s) => s.reduce((t, v) => t + v, 0) / s.length, opts);
}

/**
 * "better", "worse" or "unclear" for a difference, B minus A.
 * @param {{lo: number, hi: number, thin?: boolean}} ci
 * @param {{lowerIsBetter?: boolean}} [opts]  true for losses, false for scores
 */
export function verdict(ci, { lowerIsBetter = true } = {}) {
  if (!ci || !Number.isFinite(ci.lo) || !Number.isFinite(ci.hi)) return 'unclear';
  if (lowerIsBetter ? ci.hi < 0 : ci.lo > 0) return 'better';
  if (lowerIsBetter ? ci.lo > 0 : ci.hi < 0) return 'worse';
  return 'unclear';
}

/** One line for a console report: "−0.059 [−0.071, −0.047] better (38 GWs)". */
export function describe(ci, { digits = 3, lowerIsBetter = true } = {}) {
  const f = (v) => (Number.isFinite(v) ? (v < 0 ? '−' : '+') + Math.abs(v).toFixed(digits) : 'n/a');
  const v = verdict(ci, { lowerIsBetter });
  return `${f(ci.estimate)} [${f(ci.lo)}, ${f(ci.hi)}] ${v}${ci.thin ? ', too few gameweeks to trust' : ''} (${ci.blocks} GW${ci.blocks === 1 ? '' : 's'})`;
}
