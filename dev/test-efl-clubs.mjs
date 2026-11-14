/*
 * Fantasy EFL — club uses tracker tests.
 *
 *   1. The log reader never throws and never stores more than the game
 *      allows: two clubs a round, five uses a club.
 *   2. Seasons are separate.
 *   3. Spend or save follows its stated rule, and an exhausted club is
 *      never recommended.
 *   4. The model's club pick is checked against the log.
 *   5. The page exists and the checklist reads the log.
 *
 * Run: node dev/test-efl-clubs.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { buildSampleSnapshot } from '../efl/app/assets/sample-data.js';
import { normaliseSnapshot } from '../efl/app/assets/provider.js';
import { buildContext, roundPicks, buildSquad, playerScore } from '../efl/app/assets/model.js';
import * as cl from '../efl/app/assets/clubs.js';
import { checklist } from '../efl/app/assets/deadline.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'efl', 'app');
let passed = 0;
const ok = (name, fn) => {
  try { fn(); passed += 1; } catch (err) { console.error(`✗ ${name}`); throw err; }
};

const raw = buildSampleSnapshot();
const snap = normaliseSnapshot(raw, raw.source);
const ctx = buildContext(snap);
const ids = ctx.clubs.map((c) => c.id);
const SEASON = '2026-27';

/* ── 1. The log ──────────────────────────────────────── */

ok('a malformed log becomes an empty one, never a throw', () => {
  for (const junk of [null, 7, 'x', [], { rounds: 'no' }, { rounds: { abc: ['x'], 3: 'y', 0: ['z'] } }]) {
    assert.deepEqual(cl.normaliseLog(junk, SEASON).rounds, {});
  }
});

ok('a round keeps at most two distinct clubs, and unknown clubs are dropped', () => {
  const log = cl.normaliseLog({ rounds: { 4: [ids[0], ids[0], ids[1], ids[2]], 5: ['not-a-club', ids[3]] } }, SEASON, new Set(ids));
  assert.deepEqual(log.rounds['4'], [ids[0], ids[1]]);
  assert.deepEqual(log.rounds['5'], [ids[3]]);
});

ok('a sixth use is refused with the club named', () => {
  let log = cl.emptyLog(SEASON);
  for (let r = 1; r <= 5; r += 1) log = cl.setRound(log, r, [ids[0]]).log;
  assert.equal(cl.usesLeft(log, ids[0]), 0);
  const res = cl.setRound(log, 6, [ids[0], ids[1]], { [ids[0]]: 'Example FC' });
  assert.match(res.error, /Example FC has no uses left/);
  assert.equal(res.log, log, 'a refused change leaves the log as it was');
});

ok('editing a round frees its old uses before counting', () => {
  let log = cl.emptyLog(SEASON);
  for (let r = 1; r <= 5; r += 1) log = cl.setRound(log, r, [ids[0]]).log;
  const res = cl.setRound(log, 5, [ids[0], ids[1]]);
  assert.equal(res.error, null, 're-saving round 5 with the same club is not a sixth use');
  assert.equal(cl.usageCounts(res.log)[ids[0]], 5);
  const cleared = cl.setRound(res.log, 5, []);
  assert.equal(cl.usesLeft(cleared.log, ids[0]), 1);
  assert.equal(cleared.log.rounds['5'], undefined);
});

ok('three clubs in one round are refused', () => {
  assert.ok(cl.setRound(cl.emptyLog(SEASON), 1, ids.slice(0, 3)).error);
});

/* ── 2. Seasons ──────────────────────────────────────── */

ok('seasons turn over on 1 July and are stored apart', () => {
  assert.equal(cl.seasonFor(Date.parse('2026-11-14T00:00:00Z')), '2026-27');
  assert.equal(cl.seasonFor(Date.parse('2027-06-30T00:00:00Z')), '2026-27');
  assert.equal(cl.seasonFor(Date.parse('2027-07-01T00:00:00Z')), '2027-28');
  assert.notEqual(cl.storageKey('2026-27'), cl.storageKey('2027-28'));
});

ok('the storage helpers round-trip and survive a broken store', () => {
  const mem = new Map();
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  const log = cl.setRound(cl.emptyLog(SEASON), 3, [ids[0], ids[1]]).log;
  assert.equal(cl.writeLog(store, log), true);
  assert.deepEqual(cl.readLog(store, SEASON).rounds, log.rounds);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.deepEqual(cl.readLog(broken, SEASON).rounds, {});
  assert.equal(cl.writeLog(broken, log), false);
  mem.set(cl.storageKey(SEASON), '{not json');
  assert.deepEqual(cl.readLog(store, SEASON).rounds, {});
});

/* ── 3. Spend or save ────────────────────────────────── */

const plan = cl.clubPlan(ctx, cl.emptyLog(SEASON));

ok('every club is read, contenders are the top twelve by rating', () => {
  assert.equal(plan.length, ctx.clubs.length);
  assert.equal(plan.filter((p) => p.contender).length, cl.CONTENDERS);
  for (let i = 1; i < plan.length; i += 1) assert.ok(plan[i - 1].score >= plan[i].score);
  assert.ok(plan.filter((p) => !p.contender).every((p) => p.verdict === 'hold'));
});

ok('spend means one of the next three rounds is among the club\'s best for its uses left', () => {
  for (const p of plan.filter((x) => x.verdict === 'spend' && !/evenly/.test(x.reason))) {
    const soon = p.rounds.slice(0, cl.NOW_WINDOW).map((r) => r.round);
    assert.ok(p.bestRounds.some((r) => soon.includes(r)), `${p.club.name} marked spend without a best round soon`);
  }
  for (const p of plan.filter((x) => x.verdict === 'save')) {
    const soon = p.rounds.slice(0, cl.NOW_WINDOW).map((r) => r.round);
    assert.ok(!p.bestRounds.some((r) => soon.includes(r)), `${p.club.name} marked save with a best round soon`);
    assert.ok(p.nextBest.round > soon[soon.length - 1]);
  }
  assert.ok(plan.some((p) => p.verdict === 'spend'), 'a full sample season should produce at least one');
});

ok('flat fixtures say so instead of inventing a best round', () => {
  /* Every opponent equal: what the live feed gives while it publishes no
     tables or goals. */
  const flat = { ...ctx, divisionStats: ctx.divisionStats };
  const plan2 = cl.clubPlan({ ...flat, opponentIndex: Object.fromEntries(ctx.clubs.map((c) => [c.id, 0.5])) }, cl.emptyLog(SEASON));
  const contenders = plan2.filter((p) => p.contender);
  assert.ok(contenders.length);
  for (const p of contenders) {
    const opps = p.rounds.filter((r) => !r.blank).map((r) => r.opportunity);
    if (Math.max(...opps) - Math.min(...opps) < cl.EVEN_SPREAD) assert.match(p.reason, /evenly/);
  }
});

ok('fewer uses left makes a club pickier, never less picky', () => {
  /* A club with one use should only spend it on its single best round. */
  const target = plan.find((p) => p.contender);
  let log = cl.emptyLog(SEASON);
  for (let r = 1; r <= 4; r += 1) log = cl.setRound(log, r, [target.club.id]).log;
  const one = cl.clubPlan(ctx, log).find((p) => p.club.id === target.club.id);
  assert.equal(one.left, 1);
  assert.equal(one.bestRounds.length, 1);
  assert.ok(target.bestRounds.includes(one.bestRounds[0]));
});

ok('an exhausted club is never recommended', () => {
  const top = plan[0];
  let log = cl.emptyLog(SEASON);
  for (let r = 1; r <= 5; r += 1) log = cl.setRound(log, r, [top.club.id]).log;
  const after = cl.clubPlan(ctx, log).find((p) => p.club.id === top.club.id);
  assert.equal(after.verdict, 'exhausted');
  assert.equal(after.left, 0);
});

/* ── 4. The model's pick ─────────────────────────────── */

ok('the model\'s club pick is flagged when used up, with the next best offered', () => {
  const picks = roundPicks(ctx);
  const modelId = picks.club.club.id;
  assert.equal(cl.checkModelClub(plan, modelId).exhausted, false);
  let log = cl.emptyLog(SEASON);
  for (let r = 1; r <= 5; r += 1) log = cl.setRound(log, r, [modelId]).log;
  const check = cl.checkModelClub(cl.clubPlan(ctx, log), modelId);
  assert.equal(check.exhausted, true);
  assert.equal(check.pick.club.id, modelId);
  assert.ok(check.alternative && check.alternative.left > 0 && check.alternative.club.id !== modelId);
});

/* ── 5. Checklist and pages ──────────────────────────── */

ok('the checklist adds a clubs line only when a log exists', () => {
  const scored = ctx.players.map((p) => playerScore(ctx, p));
  const seven = buildSquad(ctx, { scored }).picks.map((r) => r.player.id);
  assert.ok(!checklist(ctx, seven, { scored }).items.some((i) => i.key === 'clubs'));
  const one = checklist(ctx, seven, { scored, clubs: { ids: [ids[0]], exhausted: [] } });
  assert.match(one.items.find((i) => i.key === 'clubs').text, /1 of 2 clubs logged/);
  const two = checklist(ctx, seven, { scored, clubs: { ids: [ids[0], ids[1]], exhausted: [] } });
  assert.equal(two.items.find((i) => i.key === 'clubs').ok, true);
});

ok('the page, the dashboard warning and the guide are wired in', () => {
  const read = (f) => readFileSync(join(APP, f), 'utf8');
  assert.match(read('club-uses/index.html'), /page-club-uses\.js/);
  assert.match(read('assets/page-home.js'), /No uses left on your log/);
  assert.match(read('how-to-play/index.html'), /id="club-uses"/);
  for (const f of ['club-uses/index.html', 'assets/clubs.js', 'assets/page-club-uses.js']) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!src.includes('—'), `${f} has an em dash`);
  }
});

console.log(`✓ Fantasy EFL club uses: ${passed} checks passed`);
