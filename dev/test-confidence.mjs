/*
 * The confidence check (scripts/confidence.mjs): the interval must be
 * reproducible, must find a real gain, must refuse to find one in noise,
 * and must widen when gameweeks move together.
 */
import assert from 'node:assert/strict';
import { mulberry32, blockBootstrap, pairedDelta, meanOfBlocks, verdict, describe, THIN_BLOCKS } from '../scripts/confidence.mjs';

let passed = 0;
const t = (name, fn) => { fn(); passed++; };

/* A season of rows: `gws` gameweeks of `per` players. Each row's loss under A
   is noise; B is A plus a true shift, plus a shock shared by the whole
   gameweek, plus row noise. */
function season({ gws = 38, per = 200, shift = 0, gwShock = 0, rowNoise = 1, seed = 1 }) {
  const rnd = mulberry32(seed), g = () => { let s = 0; for (let i = 0; i < 12; i++) s += rnd(); return s - 6; };
  const rows = [];
  for (let gw = 1; gw <= gws; gw++) {
    const shock = gwShock * g();
    for (let i = 0; i < per; i++) {
      const a = 2 + g();
      rows.push({ gw, a, b: a + shift + shock + rowNoise * g() });
    }
  }
  return rows;
}
const keys = { block: (r) => r.gw, a: (r) => r.a, b: (r) => r.b };

t('the same seed gives the same interval', () => {
  const rows = season({ shift: -0.05 });
  const x = pairedDelta(rows, keys), y = pairedDelta(rows, keys);
  assert.equal(x.lo, y.lo); assert.equal(x.hi, y.hi);
});

t('a real gain is found, and the estimate is the pooled mean difference', () => {
  const rows = season({ shift: -0.1, gwShock: 0.05 });
  const d = pairedDelta(rows, keys);
  const direct = rows.reduce((s, r) => s + r.b - r.a, 0) / rows.length;
  assert.ok(Math.abs(d.estimate - direct) < 1e-12);
  assert.ok(Math.abs(d.estimate - (d.meanB - d.meanA)) < 1e-12);
  assert.equal(verdict(d), 'better', describe(d));
  assert.ok(d.lo < d.estimate && d.estimate < d.hi);
  assert.equal(d.n, rows.length); assert.equal(d.blocks, 38);
});

t('a real loss is called worse', () => {
  assert.equal(verdict(pairedDelta(season({ shift: 0.1 }), keys)), 'worse');
});

t('noise is not called a gain, and false alarms stay near 5%', () => {
  let alarms = 0;
  const trials = 200;
  for (let s = 1; s <= trials; s++) {
    const d = pairedDelta(season({ gws: 20, per: 30, gwShock: 0.2, seed: s }), keys, { reps: 400, seed: s });
    if (verdict(d) !== 'unclear') alarms++;
  }
  /* Nominal 5%; the percentile interval runs slightly narrow on 20 blocks. */
  assert.ok(alarms / trials <= 0.1, `false alarms ${alarms} of ${trials}`);
});

t('gameweeks that move together widen the interval', () => {
  const calm = pairedDelta(season({ shift: -0.05, gwShock: 0, seed: 7 }), keys);
  const stormy = pairedDelta(season({ shift: -0.05, gwShock: 0.3, seed: 7 }), keys);
  assert.ok(stormy.hi - stormy.lo > 3 * (calm.hi - calm.lo), `${describe(calm)} vs ${describe(stormy)}`);
  /* A per-row bootstrap would have missed the shared shock entirely: the
     same rows, each its own block, give an interval about as narrow as calm. */
  const rows = season({ shift: -0.05, gwShock: 0.3, seed: 7 });
  const naive = pairedDelta(rows.map((r, i) => ({ ...r, gw: i })), keys, { reps: 300 });
  assert.ok(naive.hi - naive.lo < (stormy.hi - stormy.lo) / 3);
});

t('few gameweeks are flagged thin, one is not graded at all', () => {
  const d = meanOfBlocks([4, -2, 6]);
  assert.equal(d.thin, true); assert.ok(THIN_BLOCKS > 3);
  assert.match(describe(d), /too few gameweeks/);
  const one = meanOfBlocks([5]);
  assert.equal(one.estimate, 5); assert.ok(Number.isNaN(one.lo)); assert.equal(verdict(one), 'unclear');
  assert.equal(verdict(meanOfBlocks([])), 'unclear');
});

t('scores read the other way round', () => {
  const up = meanOfBlocks(Array.from({ length: 30 }, (_, i) => 3 + (i % 5) - 2));
  assert.equal(verdict(up, { lowerIsBetter: false }), 'better');
  assert.equal(verdict(up), 'worse');
});

t('a statistic that is not a mean still bootstraps', () => {
  const r = blockBootstrap([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], (s) => Math.max(...s), { reps: 500 });
  assert.equal(r.estimate, 10); assert.ok(r.hi <= 10 && r.lo >= 1);
});

t('rows with a missing loss are left out, not counted as zero', () => {
  const d = pairedDelta([{ gw: 1, a: 1, b: 0 }, { gw: 1, a: 1, b: NaN }, { gw: 2, a: 1, b: 0 }], keys);
  assert.equal(d.n, 2); assert.equal(d.estimate, -1);
});

console.log(`• confidence check: ${passed} checks passed`);
