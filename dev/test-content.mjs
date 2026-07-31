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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
import { selectStory, score, novelty, remember, KINDS, W, MIN_SCORE, NOVELTY_DAYS, TIMELINESS }
  from '../scripts/content/stories.mjs';
import { priceVerdicts, differentials, templateRisks, valuePicks, purplePatches, fixtureSwings,
  bestRun, fixtureRuns, chipWindows, RUN_MIN, RUN_MAX, CHIP_MIN_EDGE }
  from '../scripts/content/candidates.mjs';
import { draft } from '../scripts/content/copy.mjs';
import { buildThread, grade, minutesScore, returnsScore, fixtureScore, clubVerdict, STATUS, angles,
  rotationRisks, rotationTension, availability, shirtAdjust,
  TALISMAN_SHARE, TALISMAN_MIN_GOALS, CLUB_CAP } from '../scripts/content/club.mjs';

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
    ['fixtureSwings', fixtureSwings, [{}, teamName]],
    ['fixtureRuns', fixtureRuns, [{}, teamName]],
    ['chipWindows', chipWindows, [null, teamName]]]) {
    let threw = false;
    try { fn(...args); } catch (_) { threw = true; }
    ok(!threw, name + ' survives an empty league');
  }
}


console.log('• fixture runs: the best window, not the opening one');
{
  const teamName = (id) => 'Team ' + id;
  /* A hard opening, a genuinely kind middle, a hard close. `purplePatches`
     reads only the first five gameweeks and would report nothing useful
     here, which is exactly the gap this kind exists to fill. */
  const horizon = [4.5, 4.5, 4.5, 4.5, 1.8, 1.9, 1.8, 1.9, 4.5, 4.5]
    .map((difficulty, i) => ({ event: i + 1, opp: 2, home: i % 2 === 0, difficulty }));

  const b = bestRun(horizon);
  ok(b.slice[0].event === 5, 'the mid-horizon window is found, not the opening one (GW' +
    b.slice[0].event + ')');
  ok(b.len >= RUN_MIN && b.len <= RUN_MAX, 'the window respects its length bounds');
  ok(b.slice.every((f) => f.difficulty < 3), 'and does not reach into the hard fixtures for length');

  /* The length tilt is a nudge, not a thumb on the scale: a clearly easier
     short run must still beat a longer mediocre one. */
  const shortEasy = [1.2, 1.2, 1.2, 3.0, 3.0, 3.0]
    .map((difficulty, i) => ({ event: i + 1, opp: 2, home: true, difficulty }));
  ok(bestRun(shortEasy).len === RUN_MIN, 'a much easier three beats a padded six');

  const fr = fixtureRuns({ 7: horizon }, teamName);
  ok(fr.length === 1 && fr[0].kind === 'fixture-run', 'a run becomes a candidate');
  ok(fr[0].data.from === 5 && fr[0].data.to === 8, 'the window is named by its gameweeks');
  ok(/GW5–8/.test(fr[0].headline), 'and the headline says so (' + fr[0].headline + ')');
  ok(fr[0].data.fixtures.length === fr[0].effect.weeks, 'the card shows every fixture it counted');
  ok(near(fr[0].effect.avgDifficulty, 1.85, 1e-6), 'the average is the window average, not the horizon');
  ok(fixtureRuns({ 1: horizon.slice(0, 2) }, teamName).length === 0,
    'too short a horizon yields no run');
}


console.log('• chip windows: a week only gets named when it earns it');
{
  const teamName = (id) => 'Team ' + id;
  const plan = { picks: {
    wildcard: { gw: 9, edge: 0.4 },
    benchboost: { gw: 12, edge: CHIP_MIN_EDGE - 0.05 },
    triplecaptain: { gw: 15, edge: 0.01, double: 6, el: { web_name: 'Salah' }, opp: 3 },
    freehit: { gw: 18, edge: 0.01, blank: 4 }
  } };
  const cw = chipWindows(plan, teamName);
  const by = (chip) => cw.find((c) => c.data.chip === chip);

  ok(!by('Bench Boost'), 'a week no better than average produces no card');
  ok(by('Wildcard') && by('Wildcard').data.gw === 9, 'a real edge does');
  /* The live chip-plan run that prompted this found a whole half sitting
     within 0.1 FDR of the mean. Silence is the correct output there. */
  ok(by('Triple Captain') && by('Free Hit'),
    'a double or a blank is a calendar fact and bypasses the edge floor');
  ok(by('Triple Captain').effect.edge === 15, 'and registers as maximal');
  ok(by('Triple Captain').data.player === 'Salah' && by('Triple Captain').data.opponent === 'Team 3',
    'the pick carries its player and opponent');
  /* The card has three text slots and only so much to say. The headline
     names the week, the body carries the number, so the subtitle must not
     be a third statement of either. */
  ok(cw.every((c) => /not an instruction/.test(c.sub)),
    'the subtitle is the caveat rather than a restatement');
  ok(by('Free Hit') && !/\b4\b/.test(by('Free Hit').sub), 'and does not repeat the body figure');
  ok(chipWindows({ picks: {} }, teamName).length === 0, 'no picks means no cards');
  ok(chipWindows({ picks: { wildcard: { edge: 9 } } }, teamName).length === 0,
    'a pick with no gameweek is not a window');
}


console.log('• every kind that can be selected can also be published');
{
  /* The `chip-window` kind sat in KINDS for the whole life of the pipeline
     with no builder producing one and a writer reading a field nothing
     emitted. Both halves were invisible because nothing checked that a
     selectable kind was renderable end to end. */
  const tpl = readFileSync(join(ROOT, 'scripts/content/template.html'), 'utf8');
  const bodies = tpl.slice(tpl.indexOf('const BODIES'), tpl.indexOf('const s = D.story'));
  ok(bodies.length > 200, 'the card bodies block was located');

  for (const kind of Object.keys(KINDS)) {
    let missing = false;
    /* A writer that runs and chokes on empty data still exists; only a
       null return means there is no writer at all. */
    try {
      missing = draft({ story: { kind, headline: 'h', data: {},
        total: 0.5, magnitude: 0.5, timeliness: 0.5, novelty: 0.5 } }) === null;
    } catch (_) { missing = false; }
    ok(!missing, kind + ': has a post writer');
    /* Hyphenated kinds must be quoted keys, plain ones need not be. */
    ok(bodies.includes("'" + kind + "':") || new RegExp('\\b' + kind + ':').test(bodies),
      kind + ': has a card body');
  }

  /* And the writer must read the fields the builder actually emits. */
  const teamName = (id) => 'Team ' + id;
  const runs = { 7: [4.5, 4.5, 1.8, 1.9, 1.8, 1.9]
    .map((difficulty, i) => ({ event: i + 1, opp: 2, home: i % 2 === 0, difficulty })) };
  const cards = [
    fixtureRuns(runs, teamName)[0],
    chipWindows({ picks: { wildcard: { gw: 9, edge: 0.4 } } }, teamName)[0]
  ];
  for (const c of cards) {
    const post = draft({ story: { ...c, total: 0.5, magnitude: 0.5, timeliness: 0.5, novelty: 0.5 } });
    ok(post && post.text, c.kind + ': drafts a post');
    ok(!/undefined|NaN|\[object/.test(post.text),
      c.kind + ': the post has no placeholder holes (' + post.text.split('\n')[0] + ')');
    ok(post.alt && post.alt.length > 20 && !/undefined|NaN/.test(post.alt),
      c.kind + ': and real alt text');
  }
}


console.log('• club threads: the grade is the payload, so it needs a rule');
{
  const P = (o) => ({ web_name: 'X', element_type: 3, now_cost: 60, teamGames: 10,
    starts: 10, minutes: 900, goals: 5, assists: 5, avgDifficulty: 2.5, ...o });

  /* Each component must move only with its own input. */
  ok(minutesScore(P({ starts: 10 })) > minutesScore(P({ starts: 3, minutes: 300 })),
    'more starts means more minutes security');
  ok(returnsScore(P({ xp: 6 })) > returnsScore(P({ xp: 1 })), 'a higher projection scores higher');
  ok(fixtureScore(P({ avgDifficulty: 2 })) > fixtureScore(P({ avgDifficulty: 4.5 })),
    'an easier run scores higher');
  for (const fn of [minutesScore, returnsScore, fixtureScore]) {
    for (const probe of [P({}), P({ starts: 1e6, minutes: 1e6, xp: 1e6, avgDifficulty: -50 }),
      P({ starts: -5, minutes: -5, xp: -5, avgDifficulty: 99 })]) {
      const v = fn(probe);
      ok(v >= 0 && v <= 1, fn.name + ' stays in 0..1 (' + v + ')');
    }
  }

  /* The congestion discount is the whole reason to model this rather than
     eyeball it — a European midweek must visibly cost minutes security. */
  const clear = minutesScore(P({ congestion: 0 }));
  const loaded = minutesScore(P({ congestion: 1 }));
  ok(loaded < clear, 'midweek European load reduces minutes security (' +
    clear.toFixed(2) + ' → ' + loaded.toFixed(2) + ')');

  /* The veto: strong everywhere else must not rescue a player who will not
     start. This is the recommendation that would actually cost someone. */
  const benched = grade(P({ starts: 1, minutes: 120, xp: 9, avgDifficulty: 1.5 }));
  ok(benched.status.key === 'avoid', 'elite returns cannot outvote insecure minutes');
  ok(/minutes/.test(benched.why), 'and the reason says so (' + benched.why + ')');

  ok(grade(P({ xp: 6, starts: 10, avgDifficulty: 2 })).status.key === 'major',
    'strong on all three is a major target');
  ok(grade(P({ xp: 6, starts: 10, avgDifficulty: 4.4 })).status.key === 'watchlist',
    'strong on two is watchlist');
  ok(grade(P({ xp: 1.2, starts: 10, avgDifficulty: 4.4 })).status.key === 'monitor',
    'strong on one is monitor');

  /* July: no projection at all. The thread must still grade, or the format
     is unusable in exactly the window it exists for. */
  const preseason = grade(P({ xp: null, goals: 8, assists: 4, minutes: 900 }));
  ok(preseason.status.key !== 'avoid', 'realised output stands in when nothing projects yet');

  /* The cameo problem, from the first real run: Arsenal's key asset came out
     as a 17-year-old with 1 goal and 1 assist in 152 minutes, ranked above
     Saka and Gyökeres. A per-90 rate off two substitute appearances is the
     best rate in the squad and is worth nothing, so it has to be shrunk
     toward an ordinary one by how much football stands behind it. */
  const cameo = { xp: null, minutes: 152, starts: 1, goals: 1, assists: 1, teamGames: 0 };
  const proven = { xp: null, minutes: 2600, starts: 30, goals: 10, assists: 12, teamGames: 0 };
  ok(returnsScore(P(cameo)) < returnsScore(P(proven)),
    'a cameo rate does not outscore a season of proven output (' +
    returnsScore(P(cameo)).toFixed(2) + ' vs ' + returnsScore(P(proven)).toFixed(2) + ')');
  ok(returnsScore(P(cameo)) < 0.55, 'and it does not clear the strong-returns bar');
  ok(returnsScore(P({ xp: null, minutes: 0, starts: 0, goals: 0, assists: 0 })) === 0,
    'no football at all scores zero rather than inheriting the prior');

  /* Same run, same root cause on the other axis: pre-season teamGames is 0,
     and dividing by "no matches yet" made one appearance look nailed on. */
  ok(minutesScore(P(cameo)) < 0.35, 'pre-season, a cameo is not mistaken for an ever-present (' +
    minutesScore(P(cameo)).toFixed(2) + ')');
  ok(minutesScore(P(proven)) >= 0.7, 'while a genuine ever-present still reads as nailed on (' +
    minutesScore(P(proven)).toFixed(2) + ')');
  ok(grade(P(cameo)).status.key === 'avoid', 'so the cameo cannot be recommended');

  /* Both ends have to hold at once, and the second run proved the first fix
     could break the second: measured against a theoretical 38x90 season, Saka
     on 2218 minutes came out "minutes worth watching" and Arsenal cleared
     nobody. The reference is what a first-choice player actually plays. */
  const nailed = P({ xp: null, teamGames: 0, starts: 26, minutes: 2218,
    goals: 7, assists: 10 });
  ok(minutesScore(nailed) >= 0.7, 'a first-choice season reads as nailed on, not rotated (' +
    minutesScore(nailed).toFixed(2) + ')');
  ok(/nailed on/.test(grade(nailed).why), 'and the copy says so (' + grade(nailed).why + ')');
  ok(grade({ ...nailed, avgDifficulty: 2.4 }).status.key === 'major',
    'a first-choice player with a kind run is a major target');

  /* THE DEFENDER PROBLEM, from running this against Everton: a centre-back
     who banks defensive contributions and clean sheets graded last of six,
     because the returns axis only counted goals and assists. On that axis he
     scores nothing by construction, so no amount of defensive value could
     move him and the defensive-floor tag decorated a ranking it could not
     change. Returns are points per 90 now, on the real tariff. */
  const cb = { element_type: 2, xp: null, teamGames: 0, starts: 32, minutes: 2900,
    goals: 1, assists: 1, cleanSheets: 9, defconRate: 0.55, avgDifficulty: 3.0 };
  const cbNoFloor = { ...cb, cleanSheets: 0, defconRate: 0 };
  ok(returnsScore(cb) > returnsScore(cbNoFloor),
    'clean sheets and a defensive floor count as returns (' +
    returnsScore(cb).toFixed(2) + ' vs ' + returnsScore(cbNoFloor).toFixed(2) + ')');
  ok(returnsScore(cb) >= 0.55,
    'a high-volume centre-back clears the returns bar on his own merits (' +
    returnsScore(cb).toFixed(2) + ')');
  ok(grade(cb).status.key !== 'avoid' && /projects well/.test(grade(cb).why),
    'and grades on it (' + grade(cb).why + ')');

  /* A defender must not out-rank a genuinely elite attacker, though — the
     point is that the floor is visible, not that it wins. */
  const striker = { element_type: 4, xp: null, teamGames: 0, starts: 30, minutes: 2700,
    goals: 18, assists: 6, cleanSheets: 0, defconRate: 0, avgDifficulty: 3.0 };
  ok(returnsScore(striker) > returnsScore(cb),
    'an elite forward still scores higher than a defensive floor (' +
    returnsScore(striker).toFixed(2) + ' vs ' + returnsScore(cb).toFixed(2) + ')');

  /* The tariff is position-aware: the same goal is worth more to a defender. */
  const sameNumbers = { xp: null, teamGames: 0, starts: 30, minutes: 2700,
    goals: 6, assists: 4, cleanSheets: 0, defconRate: 0 };
  ok(returnsScore({ ...sameNumbers, element_type: 2 }) >
     returnsScore({ ...sameNumbers, element_type: 4 }),
    'identical goals are worth more on the defender tariff');
  ok(returnsScore({ ...sameNumbers, element_type: 3 }) >
     returnsScore({ ...sameNumbers, element_type: 4 }),
    'and more to a midfielder than a forward');

  /* Clean sheets pay a defender, barely pay a midfielder, and never a
     forward — crediting them flat would invent value up front. */
  const cs = { xp: null, teamGames: 0, starts: 30, minutes: 2700, goals: 0,
    assists: 0, cleanSheets: 12, defconRate: 0 };
  ok(returnsScore({ ...cs, element_type: 2 }) > returnsScore({ ...cs, element_type: 3 }),
    'a clean sheet is worth more to a defender than a midfielder');
  ok(returnsScore({ ...cs, element_type: 4 }) === returnsScore({ ...cs, element_type: 4, cleanSheets: 0 }),
    'and nothing at all to a forward');

  const clubOf = (players, extra = {}) => buildThread({ name: 'CLB', fullName: 'Club',
    scored: 60, conceded: 40, avgDifficulty: 2.6,
    fixtures: [{ gw: 1, opp: 'AAA', home: true }, { gw: 2, opp: 'BBB', home: false }],
    players, ...extra });

  const strongSquad = [P({ web_name: 'A', xp: 6.5 }), P({ web_name: 'B', xp: 6.2 }),
    P({ web_name: 'C', xp: 3.0, element_type: 4 })];
  const t = clubOf(strongSquad);
  ok(t.posts.length >= 6, 'a thread is at least six posts (' + t.posts.length + ')');
  const kinds = t.posts.map((p) => p.kind);
  for (const k of ['hook', 'baseline', 'key-asset', 'rotation-risk', 'hierarchy', 'takeaway']) {
    ok(kinds.includes(k), 'thread includes the ' + k + ' post');
  }
  ok(t.posts.every((p) => p.title && p.lines.length), 'every post has a title and body');
  ok(t.verdict.verdict === 'load-up', 'two majors reads as a club to load up on');

  /* The Coventry conclusion: one cheap name, nothing else — an enabler
     source, not a team to buy into. */
  const thin = clubOf([P({ web_name: 'Cheap', now_cost: 40, element_type: 2, xp: 4.2 }),
    P({ web_name: 'Meh', xp: 1.0, avgDifficulty: 4.5 }),
    P({ web_name: 'Bench', starts: 1, minutes: 90, xp: 5 })]);
  ok(thin.verdict.verdict === 'enabler-source',
    'one cheap qualifier reads as an enabler source (' + thin.verdict.verdict + ')');

  const hier = t.posts.find((p) => p.kind === 'hierarchy');
  const order = { major: 0, watchlist: 1, monitor: 2, avoid: 3 };
  ok(hier.rows.every((r, i, a) => i === 0 || order[a[i-1].status] <= order[r.status]),
    'the hierarchy is ordered best status first');
  ok(hier.rows.every((r) => r.light && r.name && r.cost), 'each row carries its traffic light');

  /* A club with nobody worth naming must still produce a usable thread
     rather than throwing or inventing a recommendation. */
  const empty = clubOf([]);
  ok(empty.posts.length >= 4 && empty.verdict.verdict === 'avoid',
    'an empty squad still yields a thread, and it says avoid');
  ok(Object.values(STATUS).every((s) => s.light && s.label), 'every status has a light and a label');

  /* Pre-season there are no results, and "0 scored, 0 conceded" would read as
     a fact rather than as an absence — in the window these threads exist for. */
  const noFootball = buildThread({ name: 'X', played: 0, scored: 0, conceded: 0,
    avgDifficulty: 2.5, players: [], fixtures: [] });
  const baseline = noFootball.posts.find((x) => x.kind === 'baseline').lines[0];
  ok(!/0 scored|Scored 0/.test(baseline), 'no results reads as absence, not as zeros');
  ok(/No results yet/.test(baseline), 'and says so plainly (' + baseline + ')');

  /* The angle is what makes a preview worth reading — "buy this club for X,
     not Y" rather than a ranking. Both angles are things the model knows and
     a hand-written thread has to eyeball. */
  ok(angles({}).length === 0, 'no angle is claimed without evidence');
  ok(angles({ oop: { level: 1, label: 'attacking like a midfielder' } })
    .some((a) => a.tag === 'out of position'), 'an out-of-position defender is flagged');
  ok(angles({ oop: { level: -1, label: 'playing deep' } }).length === 0,
    'playing BELOW position is not a buying angle');
  ok(angles({ defconRate: 0.7 }).some((a) => a.tag === 'defensive floor'),
    'a reliable defensive-contribution floor is flagged');
  ok(angles({ defconRate: 0.1 }).length === 0, 'an unreliable one is not');

  /* The set-piece angle was unreachable code: angles() looked for p.setPieces
     and the runner never supplied it, so across every club ever generated the
     tag printed exactly zero times. A tag nothing can populate is worse than
     no tag — it reads as "this club has no set-piece story". */
  ok(angles({ setPieces: 'penalties — 82% confidence on the duty' })
    .some((a) => a.tag === 'set pieces'), 'a set-piece duty is flagged');
  ok(angles({ setPieces: null }).length === 0, 'and no duty claims nothing');
  const spSrc = readFileSync(join(ROOT, 'scripts/content/club-thread.mjs'), 'utf8');
  ok(/setPieces:\s*setPieceNote\(e\)/.test(spSrc),
    'the runner actually populates it, so the tag is reachable');
  ok(/E\.setPieceConfidence\(/.test(spSrc),
    'and reads the duty from the shared engine rather than re-deriving it');

  const P2 = (o) => ({ web_name: 'X', element_type: 2, now_cost: 55, teamGames: 10,
    starts: 10, minutes: 900, goals: 3, assists: 4, avgDifficulty: 2.2, xp: 6.2, ...o });
  const palace = buildThread({ name: 'CPFC', fullName: 'Palace', played: 10,
    scored: 41, conceded: 51, avgDifficulty: 2.4, fixtures: [],
    players: [
      P2({ web_name: 'Munoz', oop: { level: 1, label: 'attacking like a midfielder' } }),
      P2({ web_name: 'Richards', defconRate: 0.72, xp: 4.0 }),
      P2({ web_name: 'Filler', xp: 1.0, avgDifficulty: 4.5 })
    ] });
  const take = palace.posts.find((x) => x.kind === 'takeaway').lines.join(' ');
  ok(/angle is/.test(take), 'the takeaway names the angle, not just a ranking');
  ok(/Munoz|Richards/.test(take), 'and names who it belongs to (' + take.slice(0, 90) + ')');
  ok(/clean sheet/.test(take), 'a defensive floor is framed as points without a clean sheet');
  const hrows = palace.posts.find((x) => x.kind === 'hierarchy').rows;
  ok(hrows.some((r) => r.angles.includes('out of position')), 'hierarchy rows carry their angles');

  /* THE TALISMAN. Share of a club's goals a player was directly involved in.
     None of the three axes can see it: a good rate at a club that scores
     freely is a different asset from the same rate at a club that only
     scores through one man, and the second is both the way in and the
     single point of failure. */
  {
    ok(angles({ teamShare: 0.45 }).some((a) => a.tag === 'talisman'),
      'a player involved in 45% of the goals is flagged');
    ok(!angles({ teamShare: 0.18 }).some((a) => a.tag === 'talisman'),
      'an ordinary contributor is not');
    ok(!angles({ teamShare: null }).some((a) => a.tag === 'talisman'),
      'and a club too thin to divide by claims nothing');
    ok(angles({ teamShare: TALISMAN_SHARE }).some((a) => a.tag === 'talisman'),
      'the boundary itself counts');
    const note = angles({ teamShare: 0.455 }).find((a) => a.tag === 'talisman').note;
    ok(/46%/.test(note), 'the share is stated (' + note + ')');
    /* It has to read as a risk as well as a route in, or it is just praise. */
    ok(/does not play|breaks/.test(note), 'and the downside is named, not only the upside');
    ok(TALISMAN_MIN_GOALS >= 10, 'the denominator floor is a real one (' + TALISMAN_MIN_GOALS + ')');

    /* The runner must apply that floor rather than dividing by a handful. */
    const src = readFileSync(join(ROOT, 'scripts/content/club-thread.mjs'), 'utf8');
    ok(/squadGoals >= TALISMAN_MIN_GOALS/.test(src),
      'the runner guards the denominator with the shared constant');
    ok(!/squadGoals >= 20/.test(src), 'and does not carry its own copy of the number');

    const t3 = buildThread({ name: 'T', fullName: 'Tal', played: 10, scored: 40,
      conceded: 20, avgDifficulty: 2.2, fixtures: [], players: [
        { web_name: 'Star', element_type: 4, now_cost: 90, xp: 6.4, starts: 30,
          minutes: 2700, teamGames: 10, avgDifficulty: 2.2, teamShare: 0.45 }] });
    ok(t3.posts.find((x) => x.kind === 'hierarchy').rows[0].angles.includes('talisman'),
      'and it reaches the hierarchy row');
  }

  /* THE VERDICT MUST MATCH THE HIERARCHY ABOVE IT. Every rule keyed off
     MAJORS, so a Liverpool thread printed six green lights and then "nothing
     here clears the bar" two posts later. A reader does not need the rule
     table to see that is nonsense. */
  {
    const P3 = (o) => ({ web_name: 'X', element_type: 3, now_cost: 65, teamGames: 10,
      starts: 10, minutes: 900, avgDifficulty: 2.2, ...o });
    /* xp 6.0 with a 4.4 run clears returns and minutes but not fixtures —
       watchlist, never major. */
    const watchOnly = (n) => Array.from({ length: n }, (_, i) =>
      P3({ web_name: 'W' + i, xp: 6.0, avgDifficulty: 4.4 }));
    const deepGraded = watchOnly(6).map((p) => ({ ...p, grade: grade(p) }));
    ok(deepGraded.every((g) => g.grade.status.key === 'watchlist'),
      'the setup really is six watchlist players (' +
      [...new Set(deepGraded.map((g) => g.grade.status.key))].join(', ') + ')');
    const deep = clubVerdict(deepGraded);
    ok(deep.verdict === 'deep-no-standout',
      'a deep squad with no standout gets its own verdict (' + deep.verdict + ')');
    ok(!/Nothing here clears the bar/.test(deep.text),
      'and does not read as though the club were empty');
    ok(/6 names/.test(deep.text), 'the count is stated (' + deep.text + ')');

    /* A genuinely empty club must still say so. */
    const nothing = clubVerdict(watchOnly(0));
    ok(nothing.verdict === 'avoid', 'an empty squad is still avoid');
    const two = clubVerdict(watchOnly(2).map((p) => ({ ...p, grade: grade(p) })));
    ok(two.verdict === 'avoid', 'and two watchlist names is not yet depth');

    /* The stronger verdicts still outrank it. */
    const withMajors = watchOnly(4).map((p) => ({ ...p, grade: grade(p) }))
      .concat([1, 2].map((i) => { const p = P3({ web_name: 'M' + i, xp: 6.5, avgDifficulty: 2.0 });
        return { ...p, grade: grade(p) }; }));
    ok(clubVerdict(withMajors).verdict === 'load-up',
      'two majors still beat depth (' + clubVerdict(withMajors).verdict + ')');

    /* And the thread as a whole must not contradict itself. */
    const t2 = buildThread({ name: 'L', fullName: 'Deep', played: 10, scored: 20,
      conceded: 20, avgDifficulty: 4.4, fixtures: [], players: watchOnly(6) });
    const lights = t2.posts.find((x) => x.kind === 'hierarchy').rows
      .filter((r) => r.status === 'watchlist').length;
    const take = t2.posts.find((x) => x.kind === 'takeaway').lines.join(' ');
    ok(lights >= 3 && !/Nothing here clears/.test(take),
      'a hierarchy full of green lights is not followed by "nothing clears the bar"');
  }

  /* SAY WHAT THE READ CANNOT SEE. Four consecutive club previews in the wild
     made their central case on defensive contribution — the DEFCON frame is
     how the community is arguing this season — and FPL has published no
     values for it. A thread that ranks defenders on clean sheets alone while
     staying silent about that looks most confident about exactly the thing
     it is blind to. */
  {
    const squad = [{ web_name: 'CB', element_type: 2, now_cost: 55, xp: 5.0,
      starts: 30, minutes: 2700, teamGames: 10, avgDifficulty: 2.5 }];
    const blind = buildThread({ name: 'D', fullName: 'Dee', played: 10, scored: 20,
      conceded: 20, avgDifficulty: 2.5, fixtures: [], players: squad, defconData: false });
    const seeing = buildThread({ name: 'D', fullName: 'Dee', played: 10, scored: 20,
      conceded: 20, avgDifficulty: 2.5, fixtures: [], players: squad, defconData: true });
    const hookOf = (t) => t.posts.find((x) => x.kind === 'hook').lines.join(' ');
    ok(/Defensive contribution is not in the data/.test(hookOf(blind)),
      'with no DEFCON data the thread says so up front');
    ok(/clean sheets alone/.test(hookOf(blind)),
      'and names what the defensive read actually rests on instead');
    ok(!/Defensive contribution is not in the data/.test(hookOf(seeing)),
      'and stays quiet when the data is there');
    /* Absent flag means the old behaviour, so an existing caller cannot start
       emitting a caveat it never asked for. */
    const legacy = buildThread({ name: 'D', fullName: 'Dee', played: 10, scored: 20,
      conceded: 20, avgDifficulty: 2.5, fixtures: [], players: squad });
    ok(!/not in the data/.test(hookOf(legacy)), 'defaulting to available keeps old callers unchanged');
  }

  /* SQUAD CHURN. Minutes read off last season describe a squad that may no
     longer exist: sell two centre-backs and the ones who stay are nailed on,
     which their own history cannot say because it was compiled while the
     rivals were still there. A departed player is absent from the squad list,
     so the depth read is current even when the minutes are not. */
  {
    const base = { element_type: 2, xp: null, teamGames: 0, starts: 20, minutes: 1800,
      goals: 1, assists: 1, cleanSheets: 6, avgDifficulty: 3 };
    const clear = minutesScore({ ...base, shirt: { leader: true, settled: true, rivals: 2 } });
    const plain = minutesScore(base);
    const fight = minutesScore({ ...base, shirt: { leader: false, contested: true, rivals: 4 } });
    ok(clear > plain, 'the clear leader of a settled position gains minutes security (' +
      plain.toFixed(2) + ' → ' + clear.toFixed(2) + ')');
    ok(fight < plain, 'and a live contest costs it (' + fight.toFixed(2) + ')');
    ok(shirtAdjust({}) === 0 && shirtAdjust({ shirt: null }) === 0,
      'no depth information changes nothing');
    ok(shirtAdjust({ shirt: { leader: true, settled: false } }) === 0,
      'leading a contested position is not a bonus');
    ok(minutesScore({ ...base, shirt: { leader: true, settled: true }, starts: 30, minutes: 2700 }) <= 1,
      'the adjustment cannot push security past 1');
  }

  /* AVAILABILITY. The runner used to drop anyone whose status was not "a",
     which silently deleted a club's biggest talking point — a striker with a
     pre-season knock is what a preview leads on. */
  {
    ok(availability({ status: 'a' }) === null, 'a fit player carries no flag');
    ok(availability({}) === null, 'and neither does one with no status at all');
    const doubt = availability({ status: 'd', chanceOfPlaying: 50 });
    ok(doubt && doubt.cap === 'watchlist' && /50%/.test(doubt.label),
      'a doubt caps at watchlist and names the percentage (' + (doubt || {}).label + ')');
    ok(availability({ status: 'i' }).cap === 'avoid', 'an injury caps at avoid');
    ok(availability({ status: 's' }).cap === 'avoid', 'so does a suspension');
    /* A stated 0% is not a doubt, it is an absence. */
    ok(availability({ status: 'd', chanceOfPlaying: 0 }).cap === 'avoid',
      'a 0% chance is an absence rather than a doubt');
    ok(availability({ status: 'd', chanceOfPlaying: 75 }).cap === 'watchlist',
      'while a likely return stays a doubt');

    const elite = { element_type: 3, xp: 6.5, starts: 30, minutes: 2700, teamGames: 0,
      avgDifficulty: 2.0 };
    ok(grade(elite).status.key === 'major', 'the same player fit is a major target');
    ok(grade({ ...elite, status: 'd', chanceOfPlaying: 50 }).status.key === 'watchlist',
      'and a doubt caps him rather than being averaged away');
    ok(grade({ ...elite, status: 'i' }).status.key === 'avoid', 'an injury caps him harder');
    ok(/fitness doubt/.test(grade({ ...elite, status: 'd', chanceOfPlaying: 50 }).why),
      'and the reason leads with it');
    /* A flag must never PROMOTE anyone. */
    const poor = { element_type: 3, xp: 0.5, starts: 2, minutes: 200, teamGames: 0, avgDifficulty: 4.5 };
    ok(grade({ ...poor, status: 'd', chanceOfPlaying: 50 }).status.key === 'avoid',
      'a cap cannot lift a bad player up to it');

    const club = buildThread({ name: 'F', fullName: 'Flags', played: 10, scored: 20,
      conceded: 20, avgDifficulty: 2.5, fixtures: [], players: [
        { web_name: 'Knock', element_type: 4, now_cost: 60, xp: 6.2, starts: 28,
          minutes: 2500, teamGames: 10, avgDifficulty: 2.5, status: 'd', chanceOfPlaying: 50 },
        { web_name: 'Fit', element_type: 3, now_cost: 65, xp: 6.0, starts: 30,
          minutes: 2700, teamGames: 10, avgDifficulty: 2.5 }
      ] });
    const av = club.posts.find((x) => x.kind === 'availability');
    ok(!!av, 'a club with a flagged player gets an availability post');
    ok(av && av.lines.some((l) => /Knock/.test(l) && /fitness doubt/.test(l)),
      'naming the player and the doubt (' + (av ? av.lines[0] : '') + ')');
    const hier = club.posts.find((x) => x.kind === 'hierarchy');
    ok(hier.rows.some((r) => r.flag && /fitness doubt/.test(r.flag)),
      'and the hierarchy row carries the flag rather than hiding it');
    const noFlags = buildThread({ name: 'G', fullName: 'Good', played: 10, scored: 20,
      conceded: 20, avgDifficulty: 2.5, fixtures: [], players: [
        { web_name: 'Fit', element_type: 3, now_cost: 65, xp: 6.0, starts: 30,
          minutes: 2700, teamGames: 10, avgDifficulty: 2.5 }] });
    ok(!noFlags.posts.some((x) => x.kind === 'availability'),
      'a fully fit squad gets no availability post rather than an empty one');
  }

  /* Rotation risk is a tension, not a low number. The first real run filled
     this post with fourth-choice keepers and players on their way out — true,
     and useless, because nobody was going to buy them anyway. */
  {
    const G = (o) => ({ web_name: 'N', now_cost: 60, element_type: 3,
      grade: { returns: 0.8, minutes: 0.5 }, ...o });
    const tempting = G({ web_name: 'Tempting', grade: { returns: 0.85, minutes: 0.45 } });
    const fringe = G({ web_name: 'Fringe', grade: { returns: 0.10, minutes: 0.05 } });
    const nailed = G({ web_name: 'Nailed', grade: { returns: 0.90, minutes: 0.95 } });
    const picked = rotationRisks([nailed, fringe, tempting]);
    const names = picked.map((p) => p.web_name);
    ok(names.includes('Tempting'), 'a player worth wanting with shaky minutes is the risk');
    ok(!names.includes('Fringe'),
      'a squad player nobody would buy is not a rotation risk, just a squad player');
    ok(!names.includes('Nailed'), 'and neither is a nailed-on starter');

    /* Ordered by how much the two disagree, so the sharpest warning leads. */
    const mild = G({ web_name: 'Mild', grade: { returns: 0.55, minutes: 0.68 } });
    ok(rotationTension(tempting) > rotationTension(mild),
      'the sharper tension ranks first (' + rotationTension(tempting).toFixed(2) +
      ' vs ' + rotationTension(mild).toFixed(2) + ')');
    ok(rotationRisks([mild, tempting])[0].web_name === 'Tempting', 'and leads the post');
    ok(rotationRisks([nailed, fringe]).length === 0,
      'a squad with no tension yields no names rather than filler');

    /* The trap the format exists for: real returns, no starts. The grade vetoes
       him to `avoid`, and that is exactly why he must still be named here. */
    const trap = G({ web_name: 'Trap', grade: { returns: 0.75, minutes: 0.2 } });
    ok(rotationRisks([trap]).length === 1, 'a vetoed player is still a rotation warning');

    const squad = [P2({ web_name: 'Star', xp: 6.4 }),
      P2({ web_name: 'Rotated', xp: 6.0, starts: 5, minutes: 500 }),
      P2({ web_name: 'Nobody', xp: 0.4, starts: 0, minutes: 20 })];
    const rot = buildThread({ name: 'R', fullName: 'Rot', played: 10, scored: 20,
      conceded: 20, avgDifficulty: 2.5, fixtures: [], players: squad })
      .posts.find((x) => x.kind === 'rotation-risk');
    ok(rot.lines.some((l) => /Rotated/.test(l)), 'the thread names the tempting-but-rotated player');
    ok(!rot.lines.some((l) => /Nobody/.test(l)), 'and leaves the non-player out of it');
    ok(rot.lines.some((l) => /would otherwise buy him|does not start|midweek/.test(l)),
      'every name comes with the shape of the doubt (' + rot.lines.join(' | ') + ')');
    ok(rot.rows.every((r) => r.name && r.tension >= 0), 'the post carries structured rows too');

    /* Congestion is the part a hand-written thread cannot see, so where it is
       the cause it has to be named as the cause. */
    const euro = P2({ web_name: 'Euro', xp: 6.2, starts: 8, minutes: 700 });
    const club = { name: 'C', fullName: 'Cong', played: 10, scored: 20,
      conceded: 20, avgDifficulty: 2.5, fixtures: [], players: [euro] };
    const congested = buildThread({ ...club, congestion: 0.8 })
      .posts.find((x) => x.kind === 'rotation-risk');
    ok(congested.lines.some((l) => /midweek calendar is what is eating it/.test(l)),
      'a European midweek is named as the cause (' + congested.lines.join(' | ') + ')');

    /* The same player at a club with no midweek football must not have the
       calendar blamed for a doubt it did not cause. */
    const domestic = buildThread({ ...club, congestion: 0 })
      .posts.find((x) => x.kind === 'rotation-risk');
    ok(!domestic.lines.some((l) => /midweek calendar/.test(l)),
      'and is not blamed where there is none (' + domestic.lines.join(' | ') + ')');
  }

  /* An angle one line under "worth monitoring rather than buying" reads as a
     contradiction — the first run said exactly that about Chelsea and then
     named Palmer. On a club we are not buying, the angle is what would change
     the verdict, and the copy has to say so. */
  const avoidWithAngle = buildThread({ name: 'CFC', fullName: 'Chelsea', played: 10,
    scored: 30, conceded: 30, avgDifficulty: 4.4, fixtures: [],
    players: [P2({ web_name: 'Palmer', xp: 3.4, avgDifficulty: 4.4,
      oop: { level: 1, label: 'attacking like a forward' } })] });
  const avoidTake = avoidWithAngle.posts.find((x) => x.kind === 'takeaway').lines;
  ok(avoidWithAngle.verdict.verdict === 'avoid', 'the setup is a club we are not buying into');
  ok(avoidTake.some((l) => /Palmer/.test(l)), 'the angle is still named (' + avoidTake.join(' | ') + ')');
  ok(!avoidTake.some((l) => /^The angle is/.test(l)),
    'but not as a buying reason directly under "rather than buying"');
  ok(avoidTake.some((l) => /If that changes/.test(l)), 'it is framed as what would change the verdict');

  /* One goal is not "1 goals". The threads name real players; the copy has to
     survive being read. */
  const singular = buildThread({ name: 'Z', fullName: 'Zed', played: 10,
    scored: 20, conceded: 20, avgDifficulty: 2.2, fixtures: [],
    players: [P2({ web_name: 'One', goals: 1, assists: 1, minutes: 900, xp: 6.2 })] });
  const keyLine = singular.posts.find((x) => x.kind === 'key-asset').lines.join(' ');
  ok(/1 goal,/.test(keyLine) && /1 assist\./.test(keyLine),
    'a single goal and assist read as singular (' + keyLine + ')');
  ok(!/1 goals|1 assists|1 minutes/.test(keyLine), 'and never as "1 goals"');

  const withFootball = buildThread({ name: 'Y', played: 6, scored: 9, conceded: 4,
    avgDifficulty: 2.5, players: [], fixtures: [] });
  ok(/Scored 9, conceded 4/.test(withFootball.posts.find((x) => x.kind === 'baseline').lines[0]),
    'a real baseline is still reported');
}

console.log('• club threads: the squad cap must not decide who gets graded');
{
  const P = (o) => ({ web_name: 'X', element_type: 3, now_cost: 60, teamGames: 20,
    starts: 20, minutes: 1800, goals: 3, assists: 3, avgDifficulty: 2.5, ...o });

  /* The real defect: club-thread.mjs sliced the squad in the bootstrap's own
     id order, so a club with more players than the cap lost whoever happened
     to sit late in the feed. On Man City that was Haaland — a club preview
     with no forward in it. The ordering rule is what stops that, so it is
     pinned here rather than left to the shape of a live feed. */
  const order = (squad) => squad.slice()
    .sort((a, b) => b.minutes - a.minutes || b.now_cost - a.now_cost);

  const fringe = Array.from({ length: 25 }, (_, i) =>
    P({ web_name: 'Fringe' + i, minutes: 200, now_cost: 45 }));
  const star = P({ web_name: 'Star', element_type: 4, now_cost: 155, minutes: 2700, goals: 30 });
  /* Star last, exactly as a late id would place him. */
  const kept = order(fringe.concat([star])).slice(0, 24);
  ok(kept.some((p) => p.web_name === 'Star'),
    'the club’s biggest asset survives the cap wherever the feed put him');
  ok(kept[0].web_name === 'Star', 'and is graded first');

  /* Pre-season there are no minutes, so price has to carry the ordering —
     otherwise the cap goes back to being arbitrary in exactly the window
     these threads run in. */
  const preseason = fringe.map((p) => ({ ...p, minutes: 0 })).concat([{ ...star, minutes: 0 }]);
  ok(order(preseason)[0].web_name === 'Star', 'with no minutes yet, price orders the squad');

  /* The three-per-club rule: a shortlist longer than the cap has to say so. */
  const majors = (n) => Array.from({ length: n }, (_, i) => ({
    web_name: 'M' + i, now_cost: 60, element_type: 3,
    grade: { status: { key: 'major' }, returns: 0.8, minutes: 0.9, fixtures: 0.8 } }));
  const four = clubVerdict(majors(4));
  ok(four.verdict === 'load-up', 'four majors is still a club to load up on');
  ok(new RegExp('only own ' + CLUB_CAP).test(four.text),
    'but the squad cap is stated (' + four.text + ')');
  const three = clubVerdict(majors(CLUB_CAP));
  ok(three.verdict === 'load-up' && !/only own/.test(three.text),
    'at exactly the cap there is nothing to cut, so nothing is said');
  const two = clubVerdict(majors(2));
  ok(!/only own/.test(two.text), 'and two names never triggers it');

  /* The takeaway has to name the three, not just mention that there is a
     limit — the arithmetic is the thing the thread exists to do. */
  const P2 = (o) => ({ web_name: 'W', element_type: 3, now_cost: 70, minutes: 2400,
    starts: 27, goals: 12, assists: 8, teamGames: 30, xp: 6.5, avgDifficulty: 2.0, ...o });
  const loaded = buildThread({ name: 'X', fullName: 'Xtown', played: 20,
    scored: 40, conceded: 20, avgDifficulty: 2.0, fixtures: [],
    players: [P2({ web_name: 'Alpha', now_cost: 120 }), P2({ web_name: 'Bravo', now_cost: 95 }),
      P2({ web_name: 'Chas', now_cost: 80 }), P2({ web_name: 'Delta', now_cost: 70 }),
      P2({ web_name: 'Echo', now_cost: 60 })] });
  const take = loaded.posts.find((x) => x.kind === 'takeaway').lines.join(' ');
  if (/only own/.test(loaded.verdict.text)) {
    ok(/If you want 3:/.test(take), 'the takeaway names the three (' + take + ')');
    ok((take.match(/£/g) || []).length === CLUB_CAP, 'exactly three, with prices');
    const named = loaded.posts.find((x) => x.kind === 'hierarchy').rows.slice(0, CLUB_CAP)
      .map((r) => r.name);
    ok(named.every((n) => take.includes(n)),
      'and they are the top three of the hierarchy, not a different order');
  } else {
    ok(false, 'the fixture was meant to produce more majors than the cap');
  }

  /* An unavailable player must never be one of the three: the thread would
     be telling you to spend a scarce club slot on someone who cannot play. */
  const hurt = buildThread({ name: 'Y', fullName: 'Ytown', played: 20,
    scored: 40, conceded: 20, avgDifficulty: 2.0, fixtures: [],
    players: [P2({ web_name: 'Crocked', now_cost: 130, status: 'i' }),
      P2({ web_name: 'Alpha', now_cost: 120 }), P2({ web_name: 'Bravo', now_cost: 95 }),
      P2({ web_name: 'Chas', now_cost: 80 }), P2({ web_name: 'Delta', now_cost: 70 })] });
  const hurtTake = hurt.posts.find((x) => x.kind === 'takeaway').lines.join(' ');
  ok(!/Crocked/.test(hurtTake), 'an injured player is never one of the three');
}

console.log('• club threads: a summer signing’s rates belong to his old club');
{
  const base = { web_name: 'New', element_type: 2, now_cost: 55, minutes: 2700,
    starts: 30, goals: 2, assists: 3, teamGames: 30, avgDifficulty: 2.5 };
  const stayed = (o) => angles({ ...base, ...o });
  const moved = (o) => angles({ ...base, ...o, newClub: true });

  /* A rate is a statement about a role, and a role does not move with the
     player. Two analysts read Elliot Anderson's defensive contribution at
     City in opposite directions; the thread must not sound settled. */
  const dcStay = stayed({ defconRate: 0.7 }).find((a) => a.tag === 'defensive floor');
  const dcMove = moved({ defconRate: 0.7 }).find((a) => a.tag === 'defensive floor');
  ok(dcStay && dcMove, 'the defensive floor is still reported after a move');
  ok(!/previous club/.test(dcStay.note), 'a player who stayed gets no caveat');
  ok(/previous club/.test(dcMove.note), 'a signing’s defensive floor is marked (' + dcMove.note + ')');
  ok(dcMove.note.startsWith(dcStay.note), 'and the number itself is unchanged');

  const oopMove = moved({ oop: { level: 2, label: 'attacked like a winger last season' } })
    .find((a) => a.tag === 'out of position');
  ok(/previous club/.test(oopMove.note), 'so is an out-of-position read');

  /* Set-piece order is set by the club he is at NOW, so caveating it would
     be wrong in the other direction — hedging the one angle that is current. */
  const spMove = moved({ setPieces: 'penalties — 82% confidence on the duty' })
    .find((a) => a.tag === 'set pieces');
  ok(spMove && !/previous club/.test(spMove.note),
    'set-piece duty is current and carries no caveat');

  /* The talisman share divides his goals by a squad total he was not part
     of. That is not uncertainty, it is arithmetic across two clubs. */
  ok(stayed({ teamShare: 0.5 }).some((a) => a.tag === 'talisman'),
    'a talisman who stayed is still named');
  ok(!moved({ teamShare: 0.5 }).some((a) => a.tag === 'talisman'),
    'but a signing gets no talisman share, because it mixes two squads');

  /* The caveat has to reach the HIERARCHY, which prints tags and never
     notes. The first version marked a signing's defensive floor in every
     post except the one a reader screenshots — the tests passed and the
     live thread still read "Anderson — defensive floor", flat. */
  const H = (o) => ({ web_name: 'H', element_type: 3, now_cost: 70, minutes: 2400,
    starts: 27, goals: 10, assists: 6, teamGames: 30, xp: 6.4, avgDifficulty: 2.0, ...o });
  const hierOf = (t) => t.posts.find((x) => x.kind === 'hierarchy').lines.join('\n');
  const signed = hierOf(buildThread({ name: 'S', fullName: 'Stown', played: 0,
    avgDifficulty: 2.0, fixtures: [],
    players: [H({ web_name: 'Mover', defconRate: 0.7, newClub: true }), H({ web_name: 'Other' })] }));
  ok(/Mover.*defensive floor\*/.test(signed), 'the hierarchy marks a carried rate (' + signed.split('\n')[0] + ')');
  ok(/^\* measured at his previous club/m.test(signed), 'and explains the marker once, as a footnote');
  ok(!/Other.*\*/.test(signed), 'a player who stayed is unmarked');

  const settled = hierOf(buildThread({ name: 'T', fullName: 'Ttown', played: 0,
    avgDifficulty: 2.0, fixtures: [], players: [H({ web_name: 'Stayer', defconRate: 0.7 })] }));
  ok(!/\*/.test(settled), 'and a thread with no signings carries no footnote at all');

  /* Set-piece duty is current even for a signing, so it must not be starred
     — the marker would claim doubt about the one thing we do know. */
  const sp = hierOf(buildThread({ name: 'U', fullName: 'Utown', played: 0,
    avgDifficulty: 2.0, fixtures: [],
    players: [H({ web_name: 'Taker', setPieces: 'penalties — 82% confidence on the duty',
      defconRate: 0.7, newClub: true })] }));
  ok(/defensive floor\*/.test(sp) && /set pieces(?!\*)/.test(sp),
    'the marker lands on the carried rate only, not on set-piece duty (' + sp.split('\n')[0] + ')');

  /* And when the feed cannot say who signed, the thread says so once rather
     than marking nobody and sounding certain about everybody. */
  const club = { name: 'Z', fullName: 'Ztown', played: 0, avgDifficulty: 2.4,
    fixtures: [], players: [{ ...base, xp: 5 }] };
  const blind = buildThread({ ...club, joinData: false });
  const known = buildThread({ ...club, joinData: true });
  const hookOf = (t) => t.posts.find((x) => x.kind === 'hook').lines.join(' ');
  ok(/does not say when anyone signed/.test(hookOf(blind)),
    'the caveat appears when join dates are missing');
  ok(!/does not say when anyone signed/.test(hookOf(known)),
    'and not when they are available');
  ok(!/does not say when anyone signed/.test(hookOf(buildThread(club))),
    'the default assumes the data is there rather than caveating every thread');
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
