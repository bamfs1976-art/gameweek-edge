/*
 * Tests for the daily content selector (scripts/content/stories.mjs).
 *
 * The rest of the pipeline is plumbing that either runs or does not. This
 * file decides what gets published, so the properties worth pinning are
 * behavioural rather than mechanical:
 *
 *   - a bigger effect wins, all else equal;
 *   - a story told yesterday loses to a fresh one of similar size, because
 *     that is the difference between a feed and a stuck record;
 *   - when nothing is happening, it publishes NOTHING rather than the
 *     least-bad thing it could find.
 *
 * Run: node dev/test-content.mjs   (wired into npm test)
 */
import { selectStory, score, novelty, remember, KINDS, W, MIN_SCORE, NOVELTY_DAYS, TIMELINESS }
  from '../scripts/content/stories.mjs';
import { priceVerdicts, differentials, templateRisks, valuePicks, purplePatches, fixtureSwings }
  from '../scripts/content/candidates.mjs';

let failures = 0, passes = 0;
const ok = (c, label) => { if (c) passes++; else { failures++; console.error('  ✗ ' + label); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const NOW = 1780000000000;           /* fixed clock: the ranking must not depend on the day */
const DAY = 86400000;

const cand = (kind, subject, effect, headline = 'h') => ({ kind, subject, effect, headline });

console.log('• every kind is well formed');
{
  for (const [name, k] of Object.entries(KINDS)) {
    ok(typeof k.norm === 'function', name + ': has a magnitude normaliser');
    ok(typeof k.timeliness === 'function', name + ': has a timeliness shape');
    ok(!!k.label, name + ': has a human label');
    /* A normaliser that can leave 0..1 would let one kind dominate the
       ranking purely by scale, which is the failure the per-kind norms exist
       to prevent. Probe it with absurd inputs. */
    const probes = [{}, { gap: 1e6, swing: 1e6, xp: 1e6, ownership: -5, difficulty: 99,
      ppm: 1e6, medianPpm: 0.0001, avgDifficulty: -99, weeks: 1e6, edge: 1e6 },
      { gap: -1e6, swing: -1e6, xp: -1, ownership: 1e6, difficulty: -99, ppm: -1e6,
        medianPpm: 1e6, avgDifficulty: 1e6, weeks: -5, edge: -1e6 }];
    for (const p of probes) {
      const v = k.norm(p);
      ok(v >= 0 && v <= 1, name + ': magnitude stays in 0..1 for extreme input (' + v + ')');
    }
  }
  ok(near(W.magnitude + W.timeliness + W.novelty, 1), 'the weights sum to 1');
}

console.log('• magnitude: a bigger effect wins, all else equal');
{
  const opts = { history: [], now: NOW, hoursToDeadline: 12 };
  const small = score(cand('price-verdict', 'a', { gap: 0.15 }), opts);
  const big = score(cand('price-verdict', 'b', { gap: 0.95 }), opts);
  ok(big.total > small.total, 'a decisive price verdict outranks a coin toss');
  ok(big.magnitude > 0.8 && small.magnitude < 0.25, 'and the gap is reflected in magnitude');

  /* Differentials must need BOTH halves — unowned and good. */
  const unownedButPoor = score(cand('differential', 'x', { xp: 1.2, ownership: 1 }), opts);
  const ownedAndGood = score(cand('differential', 'y', { xp: 6.5, ownership: 45 }), opts);
  const unownedAndGood = score(cand('differential', 'z', { xp: 6.5, ownership: 3 }), opts);
  ok(unownedAndGood.magnitude > unownedButPoor.magnitude, 'unowned AND good beats merely unowned');
  ok(unownedAndGood.magnitude > ownedAndGood.magnitude, 'unowned AND good beats merely good');
}

console.log('• novelty: yesterday’s story loses to a fresh one');
{
  const history = [{ key: 'price-verdict::haaland', at: NOW - DAY }];
  const opts = { history, now: NOW, hoursToDeadline: 12 };
  /* The stale one is the BIGGER story; freshness has to be able to overturn
     that or the feed repeats its best take forever. */
  const stale = score(cand('price-verdict', 'haaland', { gap: 1.0 }), opts);
  const fresh = score(cand('price-verdict', 'saka', { gap: 0.7 }), opts);
  ok(stale.magnitude > fresh.magnitude, 'the repeat is genuinely the bigger story');
  ok(fresh.total > stale.total, 'and still loses to the fresh one');

  ok(near(novelty(cand('k', 's'), [], NOW), 1), 'never told → fully novel');
  ok(near(novelty(cand('k', 's'), [{ key: 'k::s', at: NOW }], NOW), 0), 'told just now → zero');
  ok(near(novelty(cand('k', 's'), [{ key: 'k::s', at: NOW - NOVELTY_DAYS * DAY }], NOW), 1),
    'told NOVELTY_DAYS ago → novel again');
  const half = novelty(cand('k', 's'), [{ key: 'k::s', at: NOW - (NOVELTY_DAYS / 2) * DAY }], NOW);
  ok(near(half, 0.5), 'halfway through the window → half novel (' + half + ')');

  /* Novelty is per (kind, subject) — the same player in a different format
     is a different story and must not be suppressed. */
  const sameSubjectOtherKind = novelty(cand('value', 'haaland'), history, NOW);
  ok(sameSubjectOtherKind === 1, 'the same player in another format is still novel');
}

console.log('• timeliness: deadline-driven vs evergreen');
{
  ok(TIMELINESS.deadline(6) > TIMELINESS.deadline(100), 'deadline stories sharpen as it nears');
  ok(TIMELINESS.deadline(-2) < TIMELINESS.deadline(6), 'and go stale once it has passed');
  ok(TIMELINESS.evergreen(6) === TIMELINESS.evergreen(200), 'evergreen stories ignore the clock');
  /* July: no deadline at all. The pipeline must not fall silent — pre-season
     is when a fantasy audience is most active. */
  ok(TIMELINESS.deadline(null) > 0.4, 'no deadline (pre-season) still scores respectably');

  const preseason = selectStory([cand('value', 'p', { ppm: 9, medianPpm: 4 })],
    { history: [], now: NOW, hoursToDeadline: null });
  ok(!!preseason.pick, 'a strong evergreen story still publishes with no deadline set');
}

console.log('• the floor: silence is a valid output');
{
  const weak = [
    cand('price-verdict', 'a', { gap: 0.05 }),
    cand('differential', 'b', { xp: 0.8, ownership: 40 }),
    cand('fixture-swing', 'c', { swing: 0.05 })
  ];
  const quiet = selectStory(weak, { history: [], now: NOW, hoursToDeadline: 200 });
  ok(quiet.pick === null, 'nothing is published on a day when nothing happened');
  ok(/below the/.test(quiet.rejected || ''), 'and it says why (' + quiet.rejected + ')');
  ok(quiet.runnersUp.length > 0, 'the near-misses are still reported for a human to overrule');

  const empty = selectStory([], { history: [], now: NOW });
  ok(empty.pick === null && /no candidates/.test(empty.rejected), 'no candidates is handled');

  const strong = selectStory([cand('price-verdict', 'a', { gap: 1.2 })],
    { history: [], now: NOW, hoursToDeadline: 6 });
  ok(!!strong.pick && strong.pick.total >= MIN_SCORE, 'a real story does publish');
}

console.log('• selection is explainable and stable');
{
  const cands = [
    cand('price-verdict', 'a', { gap: 0.9 }),
    cand('value', 'b', { ppm: 8, medianPpm: 5 }),
    cand('purple-patch', 'c', { avgDifficulty: 2.0, weeks: 4 })
  ];
  const opts = { history: [], now: NOW, hoursToDeadline: 20 };
  const r = selectStory(cands, opts);
  ok(r.pick && ['magnitude', 'timeliness', 'novelty', 'total'].every((k) => k in r.pick),
    'the winner carries its score breakdown, so the choice can be explained');
  ok(r.considered === 3, 'all candidates were considered');
  ok(r.runnersUp.length === 2, 'runners-up are returned');
  ok(r.runnersUp.every((x) => x.total <= r.pick.total), 'and rank below the winner');

  /* Same inputs must give the same answer — a pipeline that shuffles its own
     output between runs cannot be debugged. */
  const again = selectStory([...cands].reverse(), opts);
  ok(again.pick.subject === r.pick.subject, 'the result does not depend on input order');

  ok(score(cand('not-a-kind', 'x', {}), opts) === null, 'an unknown kind is dropped, not crashed on');
}

console.log('• history keeps the feed moving');
{
  let history = [];
  const pool = () => [
    cand('price-verdict', 'haaland', { gap: 1.0 }, 'Haaland verdict'),
    cand('price-verdict', 'saka', { gap: 0.95 }, 'Saka verdict'),
    cand('price-verdict', 'palmer', { gap: 0.9 }, 'Palmer verdict')
  ];
  const picked = [];
  for (let d = 0; d < 3; d++) {
    const now = NOW + d * DAY;
    const r = selectStory(pool(), { history, now, hoursToDeadline: 12 });
    ok(!!r.pick, 'day ' + (d + 1) + ' publishes');
    picked.push(r.pick.subject);
    history = remember(history, r.pick, now);
  }
  ok(new Set(picked).size === 3,
    'three consecutive days give three different subjects (' + picked.join(', ') + ')');

  ok(history.length === 3 && history[0].key.endsWith('palmer'), 'history is newest-first');
  ok(remember(history, null, NOW).length === 3, 'a silent day does not write history');
  ok(remember([], { kind: 'k', subject: 's' }, NOW, 2).length === 1, 'history trims to its cap');
  let big = [];
  for (let i = 0; i < 250; i++) big = remember(big, { kind: 'k', subject: 's' + i }, NOW + i);
  ok(big.length === 200, 'history is bounded at the default cap (' + big.length + ')');
}


console.log('• candidate builders produce honest stories, or none');
{
  /* A synthetic mid-season: six clubs, priced squads, and an xP map. The mock
     FPL server only ever has one match per club, so the xP-dependent builders
     cannot be reached through it — and those are exactly the ones that carry
     a player's name into a post. */
  const teamName = (id) => 'T' + id;
  const els = [];
  let id = 1;
  const add = (type, team, cost, pts, mins, owned) =>
    els.push({ id: id++, element_type: type, team, now_cost: cost, total_points: pts,
      minutes: mins, selected_by_percent: String(owned), web_name: 'P' + id });
  for (let t = 1; t <= 6; t++) {
    add(1, t, 50, 60, 900, 5);
    for (let i = 0; i < 4; i++) add(2, t, 45 + i * 5, 70 + i * 10, 900, 4 + i);
    for (let i = 0; i < 4; i++) add(3, t, 55 + i * 10, 90 + i * 15, 900, 6 + i * 9);
    for (let i = 0; i < 3; i++) add(4, t, 70 + i * 15, 100 + i * 20, 900, 8 + i * 20);
  }
  const idx = { elements: els };
  /* One clear winner in a band, the rest bunched — a decisive verdict. */
  const xp = {};
  els.forEach((e) => { xp[e.id] = 3 + (e.now_cost / 100); });
  const star = els.find((e) => e.element_type === 3);
  xp[star.id] = 9.5;

  const pv = priceVerdicts(idx, xp, teamName);
  ok(pv.length > 0, 'price verdicts are produced (' + pv.length + ')');
  ok(pv.every((c) => c.kind === 'price-verdict' && c.effect.gap >= 0), 'each has a non-negative gap');
  ok(pv.every((c) => c.data.rows.length >= 1 && c.data.rows[0].xp >= c.data.rows[c.data.rows.length-1].xp),
    'rows are ranked best-first');
  ok(pv.some((c) => c.effect.gap > 1), 'the planted standout produces a decisive gap');
  /* A band with fewer than three options is not a verdict, it is a shortlist. */
  const thin = priceVerdicts({ elements: els.slice(0, 2) }, xp, teamName);
  ok(thin.length === 0, 'a band with too few options yields no verdict');

  const diff = differentials(idx, xp, teamName);
  ok(diff.every((c) => c.effect.ownership < 8), 'differentials are genuinely low-owned');
  ok(diff.every((c) => c.data.name && c.data.cost), 'and carry what the card needs');

  const next = {}; for (let t = 1; t <= 6; t++) next[t] = { difficulty: t === 1 ? 4.8 : 2.0, opp: 2, home: false };
  const risk = templateRisks(idx, next, teamName);
  ok(risk.every((c) => c.effect.ownership > 20), 'template risks are actually template');
  ok(!risk.length || risk[0].effect.difficulty >= (risk[risk.length-1] || risk[0]).effect.difficulty,
    'hardest fixture first');

  const val = valuePicks(idx, teamName);
  ok(val.length > 0 && val.every((c) => c.effect.ppm >= c.effect.medianPpm),
    'value picks beat their positional median');
  /* Players under the minutes bar must not qualify — a 20-minute cameo with
     one goal would otherwise top every value list forever. */
  const cameo = valuePicks({ elements: els.map((e) => ({ ...e, minutes: 100 })) }, teamName);
  ok(cameo.length === 0, 'small samples are excluded from value picks');

  const runs = {};
  for (let t = 1; t <= 6; t++) {
    runs[t] = Array.from({ length: 8 }, (_, i) => ({ event: i + 1, opp: (t % 6) + 1,
      home: i % 2 === 0, difficulty: t === 3 ? (i < 3 ? 4.5 : 2.0) : 3 }));
  }
  const pp = purplePatches(runs, teamName);
  ok(pp.every((c) => c.data.fixtures.length >= 3), 'a purple patch needs a run, not one game');
  const sw = fixtureSwings(runs, teamName);
  ok(sw.length > 0 && sw[0].subject === '3', 'the club whose fixtures ease is found (' + sw[0].subject + ')');
  ok(sw.every((c) => c.effect.swing > 0), 'only genuine improvements are reported');
  ok(fixtureSwings({ 1: runs[1].slice(0, 2) }, teamName).length === 0,
    'too short a run yields no swing');

  /* Every builder must survive an empty league without throwing. */
  for (const [name, fn, args] of [['priceVerdicts', priceVerdicts, [{ elements: [] }, {}, teamName]],
    ['differentials', differentials, [{ elements: [] }, {}, teamName]],
    ['templateRisks', templateRisks, [{ elements: [] }, {}, teamName]],
    ['valuePicks', valuePicks, [{ elements: [] }, teamName]],
    ['purplePatches', purplePatches, [{}, teamName]],
    ['fixtureSwings', fixtureSwings, [{}, teamName]]]) {
    let threw = false;
    try { fn(...args); } catch (_) { threw = true; }
    ok(!threw, name + ' survives an empty league');
  }
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
