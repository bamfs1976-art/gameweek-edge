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
    for (const f of rec.factors) {
      assert.ok(f.value >= 0 && f.value <= 1, `${f.key}: factor value outside 0-1`);
      assert.ok(model.PLAYER_WEIGHTS[f.key] === f.weight, `${f.key}: weight does not match the table`);
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

ok('the weights in each table sum to one', () => {
  const sum = (t) => Object.values(t).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum(model.PLAYER_WEIGHTS) - 1) < 1e-9, 'player weights do not sum to 1');
  assert.ok(Math.abs(sum(model.CLUB_WEIGHTS) - 1) < 1e-9, 'club weights do not sum to 1');
  assert.ok(Math.abs(sum(model.FIXTURE_WEIGHTS) - 1) < 1e-9, 'fixture weights do not sum to 1');
  assert.ok(Math.abs(sum(model.DIFFERENTIAL_WEIGHTS) - 1) < 1e-9, 'differential weights do not sum to 1');
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
