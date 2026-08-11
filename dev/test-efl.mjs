/*
 * Fantasy EFL — contract tests.
 *
 * Three things are worth testing here and one is not.
 *
 * WORTH TESTING:
 *   1. The sample dataset is COHERENT. It is generated, so the risk is not
 *      that a number is wrong — it is that two numbers disagree: a league
 *      table that does not match the results it was built from, a form
 *      string that does not match the last five games. A demo that
 *      contradicts itself is worse than no demo.
 *   2. The PROVIDER is defensive. It is the seam a future feed plugs into,
 *      and it will be handed a payload nobody has seen. Missing fields,
 *      wrong types and orphaned players must degrade, not throw.
 *   3. The MODELS say what the interface claims they say. Ratings inside
 *      1-5, home advantage pointing the right way, an injured player
 *      dropping out of contention rather than being marked down, division-
 *      local normalisation actually being division-local.
 *
 * NOT WORTH TESTING: the exact score of a given player. Those are weights
 * meant to be re-tuned, and a test that pins them would make tuning them
 * a chore rather than a decision.
 *
 * Plus a static pass over the five pages, because the SEO contract (unique
 * title, unique description, canonical, links to its siblings) is the kind
 * of thing that rots silently.
 *
 * Run: node dev/test-efl.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'efl', 'app');

const { buildSampleSnapshot } = await import(join(APP, 'assets/sample-data.js'));
const provider = await import(join(APP, 'assets/provider.js'));
const model = await import(join(APP, 'assets/model.js'));
const tariff = await import(join(APP, 'assets/tariff.js'));
/* ui.js touches the DOM only inside its render helpers, and errorState()
   is a pure string builder — importable here without a browser. */
const ui = await import(join(APP, 'assets/ui.js'));

/* A fixed `now` so kickoff-derived assertions cannot drift with the clock. */
const NOW = Date.parse('2026-08-10T12:00:00Z');
const snap = provider.normaliseSnapshot(buildSampleSnapshot({ now: NOW }));
const ctx = model.buildContext(snap);

let checks = 0;
/* Two of the provider checks are async. Collecting their promises and
   awaiting them at the end matters: a rejected assertion that nobody awaits
   is an unhandled rejection warning and a PASSING test run, which is the
   worst of both. */
const pending = [];
const ok = (label, fn) => {
  const result = fn();
  if (result && typeof result.then === 'function') pending.push(result.then(() => { checks += 1; }));
  else checks += 1;
  void label;
};

/* ── 1. Sample data coherence ─────────────────────────── */

ok('72 clubs across three divisions', () => {
  assert.equal(snap.clubs.length, 72);
  for (const div of ['championship', 'league-one', 'league-two']) {
    assert.equal(snap.clubs.filter((c) => c.division === div).length, 24, `${div} should have 24 clubs`);
  }
});

ok('the league table is derived from the results, not asserted beside them', () => {
  for (const c of snap.clubs) {
    assert.equal(c.won + c.drawn + c.lost, c.played, `${c.name}: W/D/L does not sum to played`);
    assert.equal(c.points, c.won * 3 + c.drawn, `${c.name}: points do not match W/D/L`);
    assert.equal(c.home.played + c.away.played, c.played, `${c.name}: home+away splits do not sum`);
    assert.equal(c.home.goalsFor + c.away.goalsFor, c.goalsFor, `${c.name}: split goals do not sum`);
    assert.equal(c.home.goalsAgainst + c.away.goalsAgainst, c.goalsAgainst,
      `${c.name}: split goals conceded do not sum`);
    assert.ok(c.cleanSheets <= c.played, `${c.name}: more clean sheets than matches`);
  }
});

ok('goals scored across a division equal goals conceded', () => {
  for (const div of ['championship', 'league-one', 'league-two']) {
    const inDiv = snap.clubs.filter((c) => c.division === div);
    const scored = inDiv.reduce((s, c) => s + c.goalsFor, 0);
    const conceded = inDiv.reduce((s, c) => s + c.goalsAgainst, 0);
    assert.equal(scored, conceded, `${div}: goals scored and conceded do not balance`);
  }
});

ok('form strings are exactly the last five results', () => {
  for (const c of snap.clubs) {
    assert.ok(c.form.length <= 5, `${c.name}: form longer than five`);
    assert.equal(c.form.length, c.last5.played, `${c.name}: form length does not match last5.played`);
    const expected = c.form.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
    assert.equal(c.last5.points, expected, `${c.name}: last5 points do not match the form string`);
  }
});

ok('every club has a full league position, one per place', () => {
  for (const div of ['championship', 'league-one', 'league-two']) {
    const positions = snap.clubs.filter((c) => c.division === div).map((c) => c.position).sort((a, b) => a - b);
    assert.deepEqual(positions, Array.from({ length: 24 }, (_, i) => i + 1), `${div}: positions are not 1..24`);
  }
});

ok('players belong to real clubs and have sane counting stats', () => {
  const clubIds = new Set(snap.clubs.map((c) => c.id));
  for (const p of snap.players) {
    assert.ok(clubIds.has(p.clubId), `${p.name}: unknown club ${p.clubId}`);
    const club = snap.clubs.find((c) => c.id === p.clubId);
    assert.ok(p.starts <= p.appearances, `${p.name}: more starts than appearances`);
    assert.ok(p.appearances <= club.played, `${p.name}: more appearances than club matches`);
    assert.ok(p.minutes <= club.played * 90 + 1, `${p.name}: impossible minutes`);
    assert.ok(p.last5.length <= 5, `${p.name}: more than five recent matches`);
    assert.equal(p.ownership, null, 'ownership must stay null — no feed publishes it');
  }
});

ok('the dataset is deterministic for a given seed and clock', () => {
  const again = provider.normaliseSnapshot(buildSampleSnapshot({ now: NOW }));
  assert.equal(JSON.stringify(again.clubs), JSON.stringify(snap.clubs));
  assert.equal(again.players.length, snap.players.length);
  assert.equal(again.players[0].name, snap.players[0].name);
});

ok('the sample source declares itself as not live', () => {
  assert.equal(snap.source.live, false);
  assert.equal(snap.source.id, 'sample');
  assert.match(snap.source.label, /sample/i);
});

ok('the fixture window contains at least one blank and one double round', () => {
  let blanks = 0; let doubles = 0;
  for (const c of snap.clubs) {
    const run = model.runSummary(ctx, c.id, 6);
    blanks += run.blanks;
    doubles += run.doubles;
  }
  assert.ok(blanks > 0, 'no blank rounds in the next six — the blank path is never exercised');
  assert.ok(doubles > 0, 'no double rounds in the next six — the double path is never exercised');
});

/* ── 2. Provider defensiveness ────────────────────────── */

ok('a half-answered payload is repaired rather than thrown at the user', () => {
  const out = provider.normaliseSnapshot({
    clubs: [{ id: 'a', name: 'Club A', division: 'league-one' },
      { id: 'b', name: 'Club B', division: 'nonsense' }],
    players: [
      { id: 'p1', clubId: 'a', name: 'A Player', position: 'STRIKER', minutes: '450' },
      { id: 'p2', clubId: 'ghost', name: 'Orphan' }
    ],
    fixtures: [{ id: 'f1', homeId: 'a', awayId: 'b', round: '4', status: 'weird' },
      { id: 'f2', homeId: 'a', awayId: 'ghost' }],
    currentRound: '4'
  }, { id: 'test', live: false, label: 'Test', description: '', generatedAt: '' });

  assert.equal(out.clubs.length, 2);
  assert.equal(out.clubs[1].division, 'championship', 'an unknown division falls back, it does not crash');
  assert.equal(out.clubs[0].form.length, 0, 'a missing form array becomes an empty one');
  assert.equal(out.players.length, 1, 'a player whose club is absent is dropped, not rendered as dashes');
  assert.equal(out.players[0].position, 'MID', 'an unknown position falls back to a valid one');
  assert.equal(out.players[0].minutes, 450, 'numeric strings are coerced');
  assert.equal(out.players[0].availability.status, 'available', 'missing availability is not fatal');
  assert.equal(out.players[0].ownership, null);
  assert.equal(out.fixtures.length, 1, 'a fixture against an unknown club is dropped');
  assert.equal(out.fixtures[0].status, 'scheduled', 'an unknown status falls back');
  assert.equal(out.fixtures[0].round, 4);
  assert.equal(out.currentRound, 4);
});

ok('a payload with no clubs is an error, not an empty page', () => {
  assert.throws(() => provider.normaliseSnapshot({ clubs: [] }), /no clubs/);
});

ok('an availability status outside the vocabulary is rejected', () => {
  assert.equal(provider.normaliseAvailability({ status: 'vibes' }).status, 'available');
  assert.equal(provider.normaliseAvailability({ status: 'injured', chancePlaying: 250 }).chancePlaying, 100);
  assert.equal(provider.normaliseAvailability({ status: 'doubtful' }).chancePlaying, null);
});

ok('the remote provider surfaces an upstream failure instead of substituting sample data', async () => {
  const failing = provider.remoteProvider({ endpoint: '/api/efl/snapshot' },
    async () => ({ ok: false, status: 503 }));
  await assert.rejects(() => failing.load(), /503/);
});

ok('the remote provider normalises a well-formed payload', async () => {
  const payload = {
    source: { id: 'remote', live: true, label: 'Live feed', description: 'x', generatedAt: 'y' },
    clubs: [{ id: 'a', name: 'Club A', division: 'championship' }],
    players: [{ id: 'p', clubId: 'a', name: 'P', position: 'FWD' }],
    fixtures: [], currentRound: 2
  };
  const p = provider.remoteProvider({ endpoint: '/api/efl/snapshot' },
    async () => ({ ok: true, status: 200, json: async () => payload }));
  const out = await p.load();
  assert.equal(out.source.live, true);
  assert.equal(out.players.length, 1);
});

/* ── 3. The models ────────────────────────────────────── */

ok('every fixture rating is a whole number from 1 to 5', () => {
  for (const c of snap.clubs) {
    for (const round of model.fixtureRun(ctx, c.id, 6)) {
      for (const m of round.matches) {
        assert.ok(Number.isInteger(m.rating) && m.rating >= 1 && m.rating <= 5,
          `${c.name}: rating ${m.rating} is outside 1-5`);
        assert.ok(model.RATING_LABELS[m.rating], 'every rating has a word as well as a number');
      }
    }
  }
});

ok('the same opponent is rated easier at home than away', () => {
  const fixture = snap.fixtures.find((f) => !f.finished);
  const homeSide = model.fixtureRating(ctx, fixture.homeId, fixture);
  const awaySide = model.fixtureRating(ctx, fixture.awayId, fixture);
  assert.equal(homeSide.home, true);
  assert.equal(awaySide.home, false);
  /* Same opponent index, opposite home shift — so a club's own fixture is
     always rated easier from the home dressing room. */
  const mirrored = model.fixtureRating(ctx, fixture.awayId,
    { ...fixture, homeId: fixture.awayId, awayId: fixture.homeId });
  assert.ok(mirrored.difficulty < awaySide.difficulty,
    'home advantage must make the identical fixture look easier');
});

ok('fixture ratings are spread across the scale, not clustered on 3', () => {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const c of snap.clubs) {
    const next = model.nextFixture(ctx, c.id);
    if (next) counts[next.rating] += 1;
  }
  for (const band of [1, 2, 3, 4, 5]) {
    assert.ok(counts[band] > 0, `no fixture rated ${band} — the scale is not being used`);
  }
});

ok('ratings are normalised inside a division, so no division looks uniformly easy', () => {
  for (const div of ['championship', 'league-one', 'league-two']) {
    const idx = snap.clubs.filter((c) => c.division === div).map((c) => ctx.opponentIndex[c.id]);
    assert.ok(Math.min(...idx) < 0.05, `${div}: no club is near the easy end of its own scale`);
    assert.ok(Math.max(...idx) > 0.95, `${div}: no club is near the hard end of its own scale`);
  }
});

ok('a blank round scores worse than a hard fixture, not the same as a neutral one', () => {
  const blanked = snap.clubs.find((c) => model.runSummary(ctx, c.id, 6).blanks > 0);
  assert.ok(blanked, 'expected at least one club with a blank round');
  const run = model.runSummary(ctx, blanked.id, 6);
  assert.ok(run.meanDifficulty > 0, 'a blank must push the run rating towards the hard end');
});

ok('a player score is 0-100 and carries its reasoning', () => {
  for (const p of snap.players.slice(0, 200)) {
    const rec = model.playerScore(ctx, p);
    assert.ok(rec.score >= 0 && rec.score <= 100, `${p.name}: score ${rec.score} outside 0-100`);
    assert.equal(rec.kind, 'player');
    assert.ok(rec.factors.length >= 5, 'every weighted input is reported as a factor');
    assert.ok(rec.summary.length > 10, 'every score explains itself in words');
    assert.match(rec.summary, /\.$/, 'the summary is a sentence');
    const expected = model.positionWeights(p.position);
    for (const f of rec.factors) {
      assert.ok(f.value >= 0 && f.value <= 1, `${f.key}: factor value outside 0-1`);
      assert.equal(f.weight, expected[f.key], `${f.key}: weight does not match this position's table`);
    }
  }
});

ok('availability is a multiplier, not a deduction', () => {
  const base = snap.players.find((p) => p.availability.status === 'available' && p.starts > 5);
  const withInjury = { ...base, availability: { status: 'injured', note: 'test', chancePlaying: 0 } };
  const healthy = model.playerScore(ctx, base).score;
  const injured = model.playerScore(ctx, withInjury).score;
  assert.ok(injured < healthy * 0.25,
    `an injured player scored ${injured} against ${healthy} — that is a deduction, not a multiplier`);
  assert.match(model.playerScore(ctx, withInjury).summary, /Injured/,
    'the summary must say so, not merely score lower');
});

ok('the weights in each table sum to one, per position as well as in the base', () => {
  const sum = (t) => Object.values(t).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum(model.PLAYER_WEIGHTS) - 1) < 1e-9, 'player weights do not sum to 1');
  assert.ok(Math.abs(sum(model.CLUB_WEIGHTS) - 1) < 1e-9, 'club weights do not sum to 1');
  assert.ok(Math.abs(sum(model.FIXTURE_WEIGHTS) - 1) < 1e-9, 'fixture weights do not sum to 1');
  assert.ok(Math.abs(sum(model.DIFFERENTIAL_WEIGHTS) - 1) < 1e-9, 'differential weights do not sum to 1');
  /* Position emphasis renormalises, so a score stays comparable between a
     goalkeeper and a forward. Without this, emphasising anything would
     quietly inflate one position's scores against another's. */
  for (const pos of ['GK', 'DEF', 'MID', 'FWD']) {
    assert.ok(Math.abs(sum(model.positionWeights(pos)) - 1) < 1e-9, `${pos} weights do not sum to 1`);
  }
});

ok('minutes outweigh form, as the measured correlations require', () => {
  /* The headline finding from 52,158 walk-forward player-rounds: minutes
     (+0.515) predict next-round points better than any points-based form
     measure (+0.494 at best). A future tuning pass that quietly puts form
     back on top should have to argue with this line. */
  assert.ok(model.PLAYER_WEIGHTS.minutes > model.PLAYER_WEIGHTS.form,
    'minutes must be weighted above form — that is what the data shows');
  for (const pos of ['GK', 'DEF', 'MID', 'FWD']) {
    const w = model.positionWeights(pos);
    assert.ok(w.minutes > w.form, `${pos}: minutes must outweigh form`);
  }
});

ok('position emphasis points the way the data does', () => {
  const gk = model.positionWeights('GK');
  const fwd = model.positionWeights('FWD');
  const def = model.positionWeights('DEF');
  /* Home advantage measured at +0.7% for keepers and +14.3% for forwards. */
  assert.ok(fwd.home > gk.home * 5, 'a forward must weight home far above a goalkeeper');
  /* Clean-sheet rate moves 36.3% → 19.0% across fixture bands; overall
     points move only ~17%. The fixture matters most at the back. */
  assert.ok(def.fixture > fwd.fixture, 'a defender must weight the fixture above a forward');
  assert.ok(gk.fixture > fwd.fixture, 'a goalkeeper must weight the fixture above a forward');
});

ok('a club score is 0-100 and carries its reasoning', () => {
  for (const c of snap.clubs) {
    const rec = model.clubScore(ctx, c);
    assert.ok(rec.score >= 0 && rec.score <= 100, `${c.name}: score ${rec.score} outside 0-100`);
    assert.equal(rec.kind, 'club');
    assert.ok(rec.summary.length > 10, `${c.name}: no written rationale`);
    for (const f of rec.factors) {
      assert.ok(model.CLUB_WEIGHTS[f.key] === f.weight, `${f.key}: weight does not match the table`);
    }
  }
});

ok('the differential model never invents an ownership figure', () => {
  const p = snap.players[10];
  const d = model.differentialScore(ctx, p);
  assert.ok(d.score >= 0 && d.score <= 100);
  assert.match(d.note, /not an ownership figure/i,
    'the differential must state what it is not, every time it is produced');
});

ok('a lower-division player is a bigger differential than an identical top-flight one', () => {
  /* Same recent form, different visibility: the model must separate them on
     visibility alone, which is the only claim it makes. */
  const champ = snap.clubs.find((c) => c.division === 'championship' && c.position <= 3);
  const two = snap.clubs.find((c) => c.division === 'league-two' && c.position >= 20);
  const source = snap.players[0];
  const a = model.differentialScore(ctx, { ...source, clubId: champ.id, division: champ.division });
  const b = model.differentialScore(ctx, { ...source, clubId: two.id, division: two.division });
  assert.ok(b.score > a.score,
    'a player at a low-profile club should score higher on the differential model');
});

ok('the dashboard produces all seven picks', () => {
  const picks = model.roundPicks(ctx);
  for (const key of ['goalkeeper', 'defender', 'midfielder', 'forward', 'differential', 'club', 'captain']) {
    assert.ok(picks[key], `no ${key} pick was produced`);
  }
  assert.equal(picks.goalkeeper.player.position, 'GK');
  assert.equal(picks.defender.player.position, 'DEF');
  assert.equal(picks.midfielder.player.position, 'MID');
  assert.equal(picks.forward.player.position, 'FWD');
  for (const key of ['goalkeeper', 'defender', 'midfielder', 'forward', 'captain']) {
    assert.equal(picks[key].player.availability.status, 'available',
      `the ${key} pick must be a player who can actually play`);
    assert.ok(picks[key].next, `the ${key} pick must have a fixture`);
  }
  assert.ok(picks.captain.next.rating <= 3,
    'a captain suggestion must not be sent into the two hardest fixture bands');
});

/* ── 3b. The scoring tariff ───────────────────────────── */

ok('the tariff pays each position for the right things', () => {
  assert.equal(tariff.statPoints('goals', 1, 'GK'), 10, 'a goalkeeper\'s goal is worth ten');
  assert.equal(tariff.statPoints('goals', 1, 'FWD'), 5);
  assert.equal(tariff.statPoints('interceptions', 3, 'MID'), 6, 'interceptions pay two each');
  assert.equal(tariff.statPoints('interceptions', 3, 'DEF'), 0, 'and only to midfielders');
  assert.equal(tariff.statPoints('tackles', 5, 'DEF'), 2, 'tackles pay one per two, rounded down');
  assert.equal(tariff.statPoints('tackles', 5, 'MID'), 0, 'and only to defenders');
  assert.equal(tariff.statPoints('clearances', 7, 'DEF'), 1);
  assert.equal(tariff.statPoints('saves', 7, 'GK'), 4, 'saves pay two per three');
  assert.equal(tariff.statPoints('saves', 7, 'DEF'), 0);
  assert.equal(tariff.statPoints('goalsConceded', 3, 'DEF'), -1, 'conceded rounds towards zero');
  assert.equal(tariff.statPoints('shotsOnTarget', 4, 'FWD'), 4);
  assert.equal(tariff.statPoints('shotsOnTarget', 4, 'DEF'), 0);
});

ok('minutes and clean sheets follow their irregular rules', () => {
  assert.equal(tariff.statPoints('minutes', 0, 'MID'), 0);
  assert.equal(tariff.statPoints('minutes', 45, 'MID'), 1);
  assert.equal(tariff.statPoints('minutes', 60, 'MID'), 2);
  assert.equal(tariff.statPoints('cleanSheets', 1, 'DEF', 90), 5);
  assert.equal(tariff.statPoints('cleanSheets', 1, 'DEF', 45), 0, 'a clean sheet under 60 pays nothing');
  assert.equal(tariff.statPoints('cleanSheets', 1, 'MID', 90), 0, 'and midfielders are not paid for it');
});

ok('scoreAppearance adds a whole match up correctly', () => {
  /* A defender: 90 minutes (+2), a goal (+7), a clean sheet (+5),
     8 clearances (+2), 4 blocks (+2), 5 tackles (+2), a yellow (−1). */
  assert.equal(tariff.scoreAppearance({
    minutes: 90, goals: 1, cleanSheets: 1, clearances: 8, blocks: 4, tackles: 5, yellowCards: 1
  }, 'DEF'), 19);
  assert.equal(tariff.scoreAppearance({ minutes: 0, goals: 1 }, 'FWD'), 0,
    'a player who did not play scores nothing, whatever the row says');
});

ok('every sample appearance recomputes exactly from its own stats', () => {
  /* The real dataset this tariff was verified against reproduces 99.99% of
     the official points column. The sample data is held to a stricter bar,
     because there is no excuse for it: 100%. This is what stops the demo
     drifting back to an FPL-shaped tariff and quietly training the models
     on the wrong incentives. */
  let checked = 0;
  for (const p of snap.players) {
    for (const match of p.last5) {
      if (!match.minutes) { assert.equal(match.points, 0, `${p.name}: no minutes but scored`); continue; }
      assert.ok(match.stats, `${p.name}: an appearance with no stats behind it`);
      assert.equal(match.points, tariff.scoreAppearance(match.stats, p.position),
        `${p.name}: round ${match.round} does not reproduce from its own stats`);
      checked += 1;
    }
  }
  assert.ok(checked > 1000, `expected thousands of sample appearances to check, got ${checked}`);
});

ok('a position only gets columns for stats it is actually paid for', () => {
  for (const [pos, columns] of Object.entries(tariff.POSITION_COLUMNS)) {
    if (pos === 'ALL') continue;
    for (const key of columns) {
      assert.ok(tariff.TARIFF[key], `${pos}: unknown column ${key}`);
      assert.ok(tariff.scoresFor(key, pos), `${pos} is shown ${key} but is not paid for it`);
    }
  }
  /* The mixed view must only contain stats EVERY position is paid for,
     otherwise one row's zero and the next row's not-applicable look alike. */
  for (const key of tariff.POSITION_COLUMNS.ALL) {
    for (const pos of ['GK', 'DEF', 'MID', 'FWD']) {
      assert.ok(tariff.scoresFor(key, pos), `${key} is in the all-positions view but ${pos} is not paid for it`);
    }
  }
});

/* ── 3c. Building a legal seven ───────────────────────── */

ok('the squad builder returns a legal seven', () => {
  const squad = model.buildSquad(ctx);
  assert.ok(squad, 'no squad was built');
  assert.equal(squad.picks.length, 7, 'a Fantasy EFL side is seven players');
  const shape = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const r of squad.picks) shape[r.player.position] += 1;
  const legal = model.FORMATIONS.some((f) =>
    f.GK === shape.GK && f.DEF === shape.DEF && f.MID === shape.MID && f.FWD === shape.FWD);
  assert.ok(legal, `shape ${JSON.stringify(shape)} is not one of the three legal formations`);
  assert.equal(shape.GK, 1, 'exactly one goalkeeper');
});

ok('the two-players-per-club limit is respected', () => {
  const squad = model.buildSquad(ctx);
  for (const [clubId, n] of Object.entries(squad.clubCounts)) {
    assert.ok(n <= model.MAX_PER_CLUB, `${clubId}: ${n} players from one club`);
  }
});

ok('the one-club chip lifts the club limit and never scores worse', () => {
  const normal = model.buildSquad(ctx);
  const chipped = model.buildSquad(ctx, { oneClubChip: true });
  assert.ok(chipped, 'no squad was built with the chip');
  assert.ok(chipped.total >= normal.total - 1e-9,
    'lifting a constraint cannot produce a worse best squad');
});

ok('every player in the squad is available, has a fixture, and is not excluded', () => {
  const squad = model.buildSquad(ctx, { exclude: [ctx.players[0].id] });
  for (const r of squad.picks) {
    assert.equal(r.player.availability.status, 'available');
    assert.ok(r.next, 'a player with no fixture cannot be in the side');
    assert.notEqual(r.player.id, ctx.players[0].id, 'an excluded player came back');
  }
});

ok('the captain is the best player IN the squad, not the best overall', () => {
  const squad = model.buildSquad(ctx);
  assert.ok(squad.picks.includes(squad.captain), 'the captain must be one of the seven');
  for (const r of squad.picks) {
    assert.ok(squad.captain.score >= r.score, 'a higher-rated player was left without the armband');
  }
});

ok('the search beats a greedy pass, which is the reason it exists', () => {
  /* Greedy down a sorted list is what the constraint makes wrong: taking
     the best midfielder can lock you out of two better defenders at the
     same club. If the search ever stops beating greedy, it is not earning
     its complexity. */
  const scored = ctx.players.map((p) => model.playerScore(ctx, p))
    .filter((r) => r.next && r.player.availability.status === 'available')
    .sort((a, b) => b.score - a.score);
  let bestGreedy = 0;
  for (const formation of model.FORMATIONS) {
    const counts = {}; const shape = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    let total = 0; let taken = 0;
    for (const r of scored) {
      const pos = r.player.position;
      if (shape[pos] >= formation[pos]) continue;
      if ((counts[r.player.clubId] || 0) >= model.MAX_PER_CLUB) continue;
      counts[r.player.clubId] = (counts[r.player.clubId] || 0) + 1;
      shape[pos] += 1; total += r.score; taken += 1;
      if (taken === 7) break;
    }
    if (taken === 7) bestGreedy = Math.max(bestGreedy, total);
  }
  const squad = model.buildSquad(ctx);
  assert.ok(squad.total >= bestGreedy - 1e-9,
    `search (${squad.total}) came out below greedy (${bestGreedy})`);
});

/* ── 3d. The official Fantasy EFL feed ────────────────── */

/* A synthetic payload in the official feed's shape. The FIELD NAMES are
   facts about a public API; the values are made up here so this test owns
   its own fixture and copies nobody's data. */
function officialFixture() {
  const squads = [];
  for (const competitionId of [7, 8, 9]) {
    for (let i = 0; i < 24; i += 1) {
      squads.push({
        id: competitionId * 100 + i,
        competitionId,
        name: `Club ${competitionId}-${i}`,
        shortName: `C${competitionId}${i}`,
        abbreviation: `C${i}`,
        leaguePosition: i + 1,
        percentSelected: 2 + i / 10,
        fdrHome: (i % 5) + 1,
        fdrAway: ((i + 2) % 5) + 1,
        last3Form: ['W', 'D', 'L'],
        /* Fantasy points are DELIBERATELY flat across the three competitions
           here, because that is what a real feed looks like: measured over a
           real season, the three divisions averaged 4.229 / 4.258 / 4.317 —
           a 2.1% spread, pointing the wrong way. The old fixture invented a
           two-point gap per division, which is why the old test passed while
           the shipped mapping put Championship clubs in League Two. */
        averagePoints: 4.3 - i * 0.05,
        totalPoints: 120
      });
    }
  }
  /* Two hand-written players carry the field-mapping assertions; the rest
     are a plausible squad per club so the squad builder has something legal
     to find. */
  const players = [{
    id: 9001, squadId: 700, displayName: 'X. Example', firstName: 'X', lastName: 'Example',
    position: 'MID', appearances: 20, goalsScored: 4, assists: 3, cleanSheets: 2,
    totalPoints: 88, interceptions: 31, tackles: 40, shotsOnTarget: 12, keyPasses: 18,
    injuryDetails: ''
  }, {
    id: 9002, squadId: 701, displayName: 'Y. Example', firstName: 'Y', lastName: 'Example',
    position: 'GKP', appearances: 20, saves: 60, totalPoints: 70,
    injuryDetails: 'Hamstring — three weeks'
  }];
  const shape = ['GK', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD'];
  for (const squad of squads) {
    shape.forEach((position, j) => players.push({
      id: squad.id * 100 + j,
      squadId: squad.id,
      displayName: `P${j}. Club${squad.id}`,
      position,
      appearances: 18 - j,
      goalsScored: position === 'FWD' ? 6 - (j % 4) : 2,
      assists: 3,
      cleanSheets: 5,
      totalPoints: 90 - j * 3,
      saves: position === 'GK' ? 55 : null,
      tackles: 40 - j,
      interceptions: position === 'MID' ? 30 - j : null,
      shotsOnTarget: 15,
      keyPasses: 20,
      injuryDetails: j === 9 ? 'Knee — a fortnight' : ''
    }));
  }

  const rounds = [];
  for (let r = 1; r <= 6; r += 1) {
    const games = [];
    for (const competitionId of [7, 8, 9]) {
      for (let i = 0; i < 24; i += 2) {
        games.push({
          id: r * 10000 + competitionId * 100 + i,
          homeId: competitionId * 100 + ((i + r) % 24),
          awayId: competitionId * 100 + ((i + r + 1) % 24)
        });
      }
    }
    rounds.push({
      roundNumber: r,
      status: r < 3 ? 'completed' : 'scheduled',
      lockoutDate: r < 3 ? '2026-08-01T11:00:00Z' : `20${26 + r}-01-01T11:00:00Z`,
      games
    });
  }
  return { squads, players, rounds };
}

ok('the app defaults to the official feed, with sample one query string away', () => {
  assert.equal(provider.DEFAULT_CONFIG.provider, 'official',
    'the app reads the official Fantasy EFL feed by default');
  assert.equal(provider.readConfig({}).provider, 'official');
  assert.equal(provider.readConfig({ location: { search: '?provider=sample' } }).provider, 'sample',
    'the sample dataset must stay reachable without a code change');
  assert.equal(provider.readConfig({ EFL_CONFIG: { provider: 'sample' } }).provider, 'sample');
});

ok('the API base honours the packaged-app override', () => {
  /* The EFL app made no requests while it ran on generated data, so a
     relative /api path was free. It is not free now: in the packaged iOS
     build a relative path resolves inside the app bundle. `ge-api-base` is
     the key the FPL app already uses for exactly this. */
  assert.equal(provider.resolveBase({ base: '/api/efl' }, {}), '/api/efl',
    'on the web a relative path is correct');
  assert.equal(
    provider.resolveBase({ base: '/api/efl' },
      { localStorage: { getItem: () => 'https://gameweekedge.co.uk/' } }),
    'https://gameweekedge.co.uk/api/efl'
  );
  assert.equal(
    provider.resolveBase({ base: '/api/efl' }, { GE_CONFIG: { apiBase: 'https://example.test' } }),
    'https://example.test/api/efl'
  );
  assert.equal(provider.resolveBase({ base: 'https://already.absolute/api/efl' }, {}),
    'https://already.absolute/api/efl', 'an absolute base is left alone');
});

/* ── The shape guard ──────────────────────────────────────
   This is the safety argument for defaulting to a feed nobody here has seen
   respond: a shape change must produce a NAMED error, never a page of
   plausible wrong numbers. Each case below is a way the official game could
   change its documents without telling anybody. */

ok('a structurally wrong feed fails with a diagnosis, not a shrug', () => {
  const base = {
    squads: [{ id: 1, competitionId: 1 }, { id: 2, competitionId: 2 }, { id: 3, competitionId: 3 }],
    players: [],
    rounds: []
  };
  const cases = [
    ['squads is not a list', { ...base, squads: { clubs: [] } }, /was not a list of clubs/],
    ['squads is empty', { ...base, squads: [] }, /no clubs at all/],
    ['players is not a list', { ...base, players: 'nope' }, /players document was not a list/],
    ['rounds is not a list', { ...base, rounds: { a: 1 } }, /rounds document was not a list/],
    ['a club lost competitionId', { ...base, squads: [{ id: 1, name: 'A' }] }, /competitionId/],
    ['everything is one competition',
      { ...base, squads: [{ id: 1, competitionId: 9 }, { id: 2, competitionId: 9 }] },
      /three divisions/],
    ['a player lost squadId', { ...base, players: [{ id: 9 }] }, /squadId/],
    ['a round lost its games', { ...base, rounds: [{ roundNumber: 1 }] }, /no fixtures to read/],
    ['a game lost homeId', { ...base, rounds: [{ roundNumber: 1, games: [{ id: 1 }] }] }, /homeId/]
  ];
  for (const [label, payload, pattern] of cases) {
    assert.throws(() => provider.assertOfficialShape(payload), pattern, `${label}: no useful error`);
    try { provider.assertOfficialShape(payload); } catch (err) {
      assert.equal(err.shapeError, true, `${label}: not flagged as a shape error`);
      assert.ok(err.diagnosis && err.diagnosis.length > 30,
        `${label}: the diagnosis must be a sentence someone can act on`);
    }
  }
});

ok('a feed that answers most of the question warns rather than fails', () => {
  /* Missing ownership is a coverage gap the UI already handles by hiding a
     column. Treating it as fatal would take the whole section down over a
     field nothing depends on. */
  const warnings = provider.assertOfficialShape({
    squads: [{ id: 1, competitionId: 1 }, { id: 2, competitionId: 2 },
      { id: 3, competitionId: 3 }, { id: 4, competitionId: 4 }],
    players: [],
    rounds: []
  });
  assert.ok(warnings.some((w) => /four|4 competitions/i.test(w)), 'an extra competition is worth saying');
  assert.ok(warnings.some((w) => /ownership/i.test(w)));
  assert.ok(warnings.some((w) => /1-5 fixture ratings/i.test(w)));
  assert.ok(warnings.some((w) => /no players/i.test(w)));
});

ok('warnings reach the reader instead of a console', () => {
  const fixture = officialFixture();
  for (const s of fixture.squads) { delete s.percentSelected; delete s.fdrHome; delete s.fdrAway; }
  const out = provider.buildOfficialSnapshot(fixture, { now: NOW });
  assert.equal(out.source.coverage.clubOwnership, false,
    'coverage must reflect what actually arrived, not what was hoped for');
  assert.equal(out.source.coverage.officialFdr, false);
  assert.ok(out.source.coverage.notes.some((n) => /ownership/i.test(n)),
    'the gap must appear in the disclosure the UI renders');
});

ok('describeShape says what actually arrived, briefly', () => {
  assert.match(provider.describeShape([{ a: 1, b: 2 }]), /array of 1.*keys: a, b/);
  assert.match(provider.describeShape({ x: 1 }), /object with keys: x/);
  assert.equal(provider.describeShape([]), 'an empty array');
  assert.equal(provider.describeShape(null), 'null');
});

ok('divisions come from the competition id order, not from fantasy points', () => {
  /* THE REGRESSION THIS PINS: the first version of this mapper ranked the
     competitions by mean fantasy points, shipped, and put Championship
     clubs in League Two. Fantasy points do not measure division quality —
     they barely vary, and lower divisions score slightly MORE because the
     tariff pays for clearances, blocks and tackles. */
  const { squads } = officialFixture();
  const map = provider.mapCompetitions(squads);
  assert.equal(map['7'], 'championship', 'the lowest competition id is the Championship');
  assert.equal(map['8'], 'league-one');
  assert.equal(map['9'], 'league-two');

  /* Invert the scoring entirely: the mapping must not move a single club. */
  const inverted = squads.map((s) => ({ ...s, averagePoints: 20 - s.averagePoints }));
  assert.deepEqual(provider.mapCompetitions(inverted), map,
    'the division mapping must not depend on fantasy points in any way');

  /* Nor on the order the feed happens to list clubs in. */
  const shuffled = squads.slice().reverse();
  assert.deepEqual(provider.mapCompetitions(shuffled), map,
    'the mapping must not depend on the order clubs arrive in');
});

ok('the real competition ids map the way the real feed does', () => {
  /* The ids and the division each belongs to, taken from a real published
     season: 10 → Championship, 11 → League One, 12 → League Two. */
  const squads = [];
  for (const competitionId of [10, 11, 12]) {
    for (let i = 0; i < 24; i += 1) squads.push({ id: competitionId * 100 + i, competitionId });
  }
  const map = provider.mapCompetitions(squads);
  assert.equal(map['10'], 'championship');
  assert.equal(map['11'], 'league-one');
  assert.equal(map['12'], 'league-two');
});

ok('a human can pin the mapping without a code change', () => {
  const { squads } = officialFixture();
  const pinned = provider.mapCompetitions(squads,
    { 7: 'league-two', 9: 'championship' });
  assert.equal(pinned['7'], 'league-two', 'an explicit override wins');
  assert.equal(pinned['9'], 'championship');
  assert.equal(pinned['8'], 'league-one', 'and leaves the rest alone');
  assert.equal(provider.mapCompetitions(squads, { 7: 'nonsense' })['7'], 'championship',
    'an invalid override is ignored rather than obeyed');
});

ok('the mapping it chose is stated on the page', () => {
  /* Getting this wrong reshuffles seventy-two clubs silently. It must be
     visible, not discovered by someone noticing Norwich in League Two. */
  const out = provider.buildOfficialSnapshot(officialFixture(), { now: NOW });
  const note = out.source.coverage.notes.find((n) => /competition ids/i.test(n));
  assert.ok(note, 'the division mapping is not reported anywhere');
  assert.match(note, /7 → Championship/);
  assert.match(note, /24 clubs/, 'the club count per division is the sanity check');
});

ok('a config override reaches the snapshot', () => {
  const out = provider.buildOfficialSnapshot(officialFixture(),
    { now: NOW, competitions: { 7: 'league-two', 9: 'championship' } });
  const champ = out.clubs.filter((c) => c.division === 'championship');
  assert.ok(champ.every((c) => c.id.startsWith('9')), 'the override did not reach the clubs');
});

ok('the official feed maps into our types', () => {
  const out = provider.buildOfficialSnapshot(officialFixture(), { now: NOW });
  assert.equal(out.clubs.length, 72);
  assert.equal(out.fixtures.length, 6 * 3 * 12, 'six rounds of twelve games in each of three divisions');
  assert.equal(out.currentRound, 3, 'the round being picked for is the next one still unlocked');
  const counts = out.clubs.reduce((a, c) => { a[c.division] = (a[c.division] || 0) + 1; return a; }, {});
  assert.deepEqual(counts, { championship: 24, 'league-one': 24, 'league-two': 24 });

  const club = out.clubs[0];
  assert.equal(club.ownership, 2, 'club ownership is real and must survive the mapping');
  assert.equal(club.fdrHome, 1, 'the official fixture rating must survive the mapping');
  assert.deepEqual(club.form, ['W', 'D', 'L']);
  assert.equal(club.last5.points, 4, 'form points are derived from the form string');

  const mid = out.players.find((p) => p.id === '9001');
  assert.equal(mid.position, 'MID');
  assert.equal(mid.stats.interceptions, 31);
  assert.equal(mid.stats.blocks, null, 'a stat the feed omits stays null, never zero');
  assert.deepEqual(mid.last5, [], 'the free feed carries no per-match history');
  assert.equal(mid.ownership, null, 'no public feed publishes PLAYER ownership');

  const gk = out.players.find((p) => p.id === '9002');
  assert.equal(gk.position, 'GK', 'GKP must be mapped to our GK');
  assert.equal(gk.availability.status, 'injured');
  assert.match(gk.availability.note, /Hamstring/);
});

ok('the official source declares what it cannot cover', () => {
  const out = provider.buildOfficialSnapshot(officialFixture(), { now: NOW });
  assert.equal(out.source.live, true);
  assert.equal(out.source.id, 'efl-official');
  const c = out.source.coverage;
  assert.equal(c.playerMatchHistory, false, 'per-match history is behind an account');
  assert.equal(c.clubOwnership, true);
  assert.equal(c.officialFdr, true);
  assert.ok(c.notes.length >= 2, 'each gap must be stated in a sentence a reader can act on');
});

ok('an official snapshot survives the model end to end', () => {
  /* The point of this one: a source with no minutes, no per-match history
     and no club goals must still produce ratings and a legal squad rather
     than throwing or returning NaN. */
  const out = provider.buildOfficialSnapshot(officialFixture(), { now: NOW });
  const officialCtx = model.buildContext(out);
  for (const p of out.players) {
    const rec = model.playerScore(officialCtx, p);
    assert.ok(Number.isFinite(rec.score), `${p.name}: score is not a number`);
    assert.ok(rec.score >= 0 && rec.score <= 100);
  }
  for (const c of out.clubs.slice(0, 5)) {
    assert.ok(Number.isFinite(model.clubScore(officialCtx, c).score));
  }
});

ok('a source that publishes no minutes still reports who plays', () => {
  /* The bug this pins: the minutes gate divided by the club's played count
     and read the official feed's absent minutes as zero, so EVERY player
     failed the eligibility filter and the dashboard silently produced no
     picks and no squad. A source publishing less must degrade, not
     disappear. */
  const out = provider.buildOfficialSnapshot(officialFixture(), { now: NOW });
  const officialCtx = model.buildContext(out);
  for (const p of out.players) {
    assert.equal(p.minutes, 0, 'the fixture models a feed with no minutes');
    const share = model.playingShare(officialCtx, p);
    assert.equal(share.hasMinutes, false, 'and the model must know that it has none');
    assert.ok(share.value > 0, `${p.name}: a regular starter read as never playing`);
    assert.ok(share.value <= 1, `${p.name}: share above 1`);
  }
  const regular = out.players.find((p) => p.appearances >= 15);
  assert.ok(model.playingShare(officialCtx, regular).value > 0.5,
    'a player with appearances in most rounds must read as a regular');
});

ok('minutes, where a source has them, still beat appearances alone', () => {
  const p = snap.players.find((x) => x.minutes > 0 && x.starts > 5);
  const share = model.playingShare(ctx, p);
  assert.equal(share.hasMinutes, true);
  assert.ok(share.minuteShare != null, 'the minute share must be reported when it exists');
  assert.ok(share.value > 0 && share.value <= 1);
});

ok('a source with no minutes can still build a legal seven', () => {
  const out = provider.buildOfficialSnapshot(officialFixture(), { now: NOW });
  const officialCtx = model.buildContext(out);
  const squad = model.buildSquad(officialCtx);
  assert.ok(squad, 'no squad could be built from a minutes-free source');
  assert.equal(squad.picks.length, 7);
  for (const [, n] of Object.entries(squad.clubCounts)) {
    assert.ok(n <= model.MAX_PER_CLUB, 'the club limit must hold on every source');
  }
  const picks = model.roundPicks(officialCtx);
  for (const key of ['goalkeeper', 'defender', 'midfielder', 'forward', 'captain']) {
    assert.ok(picks[key], `no ${key} pick from a minutes-free source`);
  }
});

ok('a player with no match history is described honestly, not as unused', () => {
  const out = provider.buildOfficialSnapshot(officialFixture(), { now: NOW });
  const officialCtx = model.buildContext(out);
  const rec = model.playerScore(officialCtx, out.players.find((p) => p.appearances >= 15));
  const formNote = rec.factors.find((f) => f.key === 'form').note;
  assert.doesNotMatch(formNote, /no minutes in the last five/,
    'saying a regular starter has no minutes, because the FEED has no rounds, is a lie');
  assert.match(formNote, /season/, 'it should say what it actually measured');
});

ok('the sample source leaves third-party assertions empty rather than inventing them', () => {
  /* Goals and injuries are simulated football and are generated. Ownership
     and the official fixture ratings are the official game's statements
     about the world, and generating those would be putting words in
     somebody's mouth. */
  for (const c of snap.clubs) {
    assert.equal(c.ownership, null, `${c.name}: sample data invented an ownership figure`);
    assert.equal(c.fdrHome, null, `${c.name}: sample data invented an official fixture rating`);
    assert.equal(c.fdrAway, null, `${c.name}: sample data invented an official fixture rating`);
  }
  assert.equal(snap.source.coverage.clubOwnership, false);
  assert.equal(snap.source.coverage.officialFdr, false);
});

ok('detailed stats normalise with null preserved as null', () => {
  const stats = provider.normaliseStats({ tackles: '40', interceptions: 0, saves: null, blocks: '' });
  assert.equal(stats.tackles, 40, 'numeric strings coerce');
  assert.equal(stats.interceptions, 0, 'a real zero stays zero');
  assert.equal(stats.saves, null, 'null stays null — it means "not published", not "none"');
  assert.equal(stats.blocks, null, 'an empty string is not a zero');
});

/* ── 4. The five routes ───────────────────────────────── */

const ROUTES = [
  { path: 'index.html', url: '/fantasy-efl/', module: 'page-home.js' },
  { path: 'fixtures/index.html', url: '/fantasy-efl/fixtures/', module: 'page-fixtures.js' },
  { path: 'players/index.html', url: '/fantasy-efl/players/', module: 'page-players.js' },
  { path: 'clubs/index.html', url: '/fantasy-efl/clubs/', module: 'page-clubs.js' },
  { path: 'how-to-play/index.html', url: '/fantasy-efl/how-to-play/', module: 'page-guide.js' }
];

const pages = ROUTES.map((r) => ({ ...r, html: readFileSync(join(APP, r.path), 'utf8') }));

ok('every route has a unique title, description and canonical URL', () => {
  const titles = new Set(); const descriptions = new Set(); const canonicals = new Set();
  for (const p of pages) {
    const title = (p.html.match(/<title>([^<]+)<\/title>/) || [])[1];
    const desc = (p.html.match(/<meta name="description" content="([^"]+)"/) || [])[1];
    const canon = (p.html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    assert.ok(title, `${p.path}: no title`);
    assert.ok(desc, `${p.path}: no meta description`);
    assert.ok(canon, `${p.path}: no canonical URL`);
    assert.equal(canon, `https://gameweekedge.co.uk${p.url}`, `${p.path}: canonical does not match its route`);
    assert.ok(!titles.has(title), `${p.path}: duplicate title`);
    assert.ok(!descriptions.has(desc), `${p.path}: duplicate description`);
    assert.ok(!canonicals.has(canon), `${p.path}: duplicate canonical`);
    titles.add(title); descriptions.add(desc); canonicals.add(canon);
    assert.match(p.html, /<meta property="og:title"/, `${p.path}: no Open Graph title`);
    assert.match(p.html, /<meta property="og:description"/, `${p.path}: no Open Graph description`);
  }
});

ok('every route links to every other route, with only one marked current', () => {
  for (const p of pages) {
    for (const other of ROUTES) {
      assert.ok(p.html.includes(`href="${other.url}"`), `${p.path}: no link to ${other.url}`);
    }
    const current = [...p.html.matchAll(/class="tab" href="([^"]+)" aria-current="page"/g)];
    assert.equal(current.length, 1, `${p.path}: expected exactly one current tab`);
    assert.equal(current[0][1], p.url, `${p.path}: the current tab points at the wrong route`);
  }
});

ok('every route loads its own module and the shared stylesheet', () => {
  for (const p of pages) {
    assert.ok(p.html.includes(`/fantasy-efl/assets/${p.module}`), `${p.path}: does not load ${p.module}`);
    assert.ok(p.html.includes('/fantasy-efl/assets/efl.css'), `${p.path}: does not load the stylesheet`);
    assert.match(p.html, /<html lang="en-GB"/, `${p.path}: missing language`);
    assert.match(p.html, /class="skip-link"/, `${p.path}: no skip link`);
    assert.match(p.html, /<h1[ >]/, `${p.path}: no h1`);
  }
});

ok('every route carries the independence notice and links back to the FPL app', () => {
  for (const p of pages) {
    assert.match(p.html, /Not affiliated with, endorsed by or associated with/,
      `${p.path}: no independence notice`);
    assert.ok(p.html.includes('href="/"'), `${p.path}: no link back to Gameweek Edge`);
  }
});

ok('the FPL app and the Euro app both link into Fantasy EFL', () => {
  const fpl = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const euro = readFileSync(join(ROOT, 'euro', 'app', 'index.html'), 'utf8');
  assert.ok(fpl.includes('href="/fantasy-efl/"'), 'the FPL app does not link to Fantasy EFL');
  assert.ok(euro.includes('href="/fantasy-efl/"'), 'the Euro app does not link to Fantasy EFL');
  /* The FPL pages must be otherwise untouched: the competition switcher is
     still FPL-current, and its own wording is unchanged. */
  assert.match(fpl, /<span class="sb-game-btn active" aria-current="page">FPL<\/span>/,
    'the FPL app is no longer marked as the current competition');
});

ok('the proxy exposes a health check that agrees with the app about what matters', () => {
  /* EXPECTED in the function and assertOfficialShape in the app are the
     same claim made twice — once for a human opening a URL, once for the
     code. They are allowed to be written separately; they are not allowed
     to disagree about the fields the app cannot work without. */
  const fn = readFileSync(join(ROOT, 'netlify', 'functions', 'efl.js'), 'utf8');
  assert.match(fn, /requested === 'health'/, 'no health route');
  assert.match(fn, /'Cache-Control': 'no-store'/,
    'a health check that can answer from ten minutes ago is not a health check');
  const block = fn.slice(fn.indexOf('const EXPECTED'), fn.indexOf('const CORS'));
  for (const field of ['id', 'competitionId', 'leaguePosition']) {
    assert.ok(block.includes(`'${field}'`), `health does not check squads.${field}`);
  }
  for (const field of ['squadId', 'position', 'totalPoints']) {
    assert.ok(block.includes(`'${field}'`), `health does not check players.${field}`);
  }
  for (const field of ['roundNumber', 'games', 'lockoutDate']) {
    assert.ok(block.includes(`'${field}'`), `health does not check rounds.${field}`);
  }
  /* The proxy must never grow a route that forwards credentials. */
  assert.ok(!/Authorization|Cognito|password/i.test(fn),
    'the EFL proxy must not authenticate as a user');
});

ok('the error state tells a reader what to do next', () => {
  const shapeErr = Object.assign(new Error('Clubs no longer carry "competitionId".'), { shapeError: true });
  const html = ui.errorState(shapeErr, 'retry');
  assert.match(html, /changed shape/, 'a shape change is not the same event as an outage');
  assert.match(html, /competitionId/, 'the diagnosis must reach the screen');
  assert.match(html, /\/api\/efl\/health/, 'the reader needs somewhere to look');
  assert.match(html, /\?provider=sample/, 'and a way to carry on meanwhile');
  const outage = ui.errorState(new Error('returned 503 for squads'));
  assert.match(outage, /could not be loaded/);
  assert.doesNotMatch(outage, /changed shape/, 'an outage must not be reported as a shape change');
});

ok('the UI never ships a hard-coded ownership column', () => {
  for (const name of ['ui.js', 'page-players.js', 'page-home.js', 'page-clubs.js']) {
    const src = readFileSync(join(APP, 'assets', name), 'utf8');
    assert.ok(!/ownership\s*[:=]\s*\d/.test(src), `${name}: an ownership figure is hard-coded`);
  }
});

await Promise.all(pending);

console.log(`✓ Fantasy EFL: ${checks} checks passed `
  + `(${snap.clubs.length} clubs, ${snap.players.length} players, ${snap.fixtures.length} fixtures, `
  + `${ROUTES.length} routes)`);
