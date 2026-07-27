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
import { buildThread, grade, minutesScore, returnsScore, fixtureScore, clubVerdict, STATUS, angles }
  from '../scripts/content/club.mjs';

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

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
