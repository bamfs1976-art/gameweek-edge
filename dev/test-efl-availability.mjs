/*
 * Fantasy EFL — availability hub tests.
 *
 * What has to hold:
 *   1. The manual document reader never throws and never trusts an entry
 *      it cannot date, place or classify.
 *   2. A manual entry overrides the feed while it is active, and stops
 *      the moment it expires.
 *   3. Out, doubt and suspended reach the model's multiplier; rotation
 *      does not.
 *   4. One flag per player, most trusted layer first, and the squad
 *      warning names exactly the flagged players in the seven.
 *   5. The committed file is valid and the pages carry the hub.
 *
 * Run: node dev/test-efl-availability.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { buildSampleSnapshot } from '../efl/app/assets/sample-data.js';
import { normaliseSnapshot, withManualAvailability } from '../efl/app/assets/provider.js';
import { buildContext, playerScore, AVAILABILITY_MULTIPLIER } from '../efl/app/assets/model.js';
import * as av from '../efl/app/assets/availability.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'efl', 'app');
let passed = 0;
const ok = (name, fn) => {
  try { fn(); passed += 1; } catch (err) { console.error(`✗ ${name}`); throw err; }
};
const okAsync = async (name, fn) => {
  try { await fn(); passed += 1; } catch (err) { console.error(`✗ ${name}`); throw err; }
};

const NOW = Date.parse('2026-11-14T12:00:00Z');
const raw = buildSampleSnapshot();
const base = normaliseSnapshot(raw, raw.source);
const round = base.currentRound;
const fitPlayer = base.players.find((p) => p.availability.status === 'available' && p.appearances >= 5);
const injured = base.players.find((p) => p.availability.status === 'injured');
const entry = (over) => ({
  playerId: fitPlayer.id, playerName: fitPlayer.name, clubId: fitPlayer.clubId,
  status: 'out', note: 'Hamstring', checkedAt: '2026-11-14T09:00:00Z',
  expiresAfterRound: round, ...over
});

/* ── 1. Reading the document ─────────────────────────── */

ok('a malformed document degrades to no entries, never a throw', () => {
  for (const junk of [null, undefined, 42, 'text', [], { entries: 'nope' }, { entries: [null, 1, 'x'] }]) {
    const doc = av.normaliseManualDoc(junk);
    assert.deepEqual(doc.entries, []);
  }
});

ok('entries with no player, an unknown status or no date are rejected', () => {
  const doc = av.normaliseManualDoc({ entries: [
    entry({ playerId: '' }), entry({ status: 'injured' }), entry({ checkedAt: 'yesterday' }), entry({})
  ] });
  assert.equal(doc.entries.length, 1);
  assert.equal(doc.rejected, 3);
});

ok('notes are trimmed to one line of 90 characters', () => {
  const e = av.normaliseEntry(entry({ note: '  a\n\n' + 'x'.repeat(200) }));
  assert.equal(e.note.length, av.NOTE_MAX);
  assert.ok(!/\n/.test(e.note));
});

ok('a duplicate player keeps the most recently checked entry', () => {
  const doc = av.normaliseManualDoc({ entries: [
    entry({ note: 'old', checkedAt: '2026-11-10T09:00:00Z' }),
    entry({ note: 'new', checkedAt: '2026-11-13T09:00:00Z' })
  ] });
  assert.equal(doc.entries.length, 1);
  assert.equal(doc.entries[0].note, 'new');
});

ok('serialised output reads back unchanged', () => {
  const doc = av.normaliseManualDoc({ entries: [entry({})] });
  const again = av.normaliseManualDoc(JSON.parse(av.serialiseManualDoc(doc, NOW)));
  assert.deepEqual(again.entries, doc.entries);
  assert.equal(again.source.updatedAt, new Date(NOW).toISOString());
});

/* ── 2. Expiry ───────────────────────────────────────── */

ok('an entry lasts up to and including its expiry round', () => {
  const e = av.normaliseEntry(entry({ expiresAfterRound: 10 }));
  assert.equal(av.isActive(e, 10, NOW), true);
  assert.equal(av.isActive(e, 11, NOW), false);
});

ok('an entry with no expiry round lapses after a week', () => {
  const e = av.normaliseEntry(entry({ expiresAfterRound: null, checkedAt: '2026-11-01T09:00:00Z' }));
  assert.equal(av.isActive(e, round, NOW), false);
  const fresh = av.normaliseEntry(entry({ expiresAfterRound: null }));
  assert.equal(av.isActive(fresh, round, NOW), true);
});

ok('expired and unknown players are counted, not applied', () => {
  const { snapshot, meta } = av.applyManualAvailability(base, { entries: [
    entry({ expiresAfterRound: round - 1 }),
    entry({ playerId: 'not-a-player' })
  ] }, { now: NOW });
  assert.equal(meta.active, 0);
  assert.equal(meta.expired, 1);
  assert.equal(meta.unmatched, 1);
  const p = snapshot.players.find((x) => x.id === fitPlayer.id);
  assert.equal(p.availability.status, 'available');
});

/* ── 3. The model ────────────────────────────────────── */

const scoreOf = (snap, id) => {
  const ctx = buildContext(snap);
  return playerScore(ctx, ctx.players.find((p) => p.id === id));
};

ok('a manual Out reaches the model multiplier', () => {
  const { snapshot } = av.applyManualAvailability(base, { entries: [entry({})] }, { now: NOW });
  const after = scoreOf(snapshot, fitPlayer.id);
  assert.equal(after.availabilityMultiplier, AVAILABILITY_MULTIPLIER.injured);
  assert.ok(after.score < scoreOf(base, fitPlayer.id).score);
});

ok('a manual Doubt maps to doubtful and Suspended to suspended', () => {
  for (const [status, model] of [['doubt', 'doubtful'], ['suspended', 'suspended']]) {
    const { snapshot } = av.applyManualAvailability(base, { entries: [entry({ status })] }, { now: NOW });
    assert.equal(snapshot.players.find((p) => p.id === fitPlayer.id).availability.status, model);
  }
});

ok('manual rotation risk leaves the rating alone', () => {
  const { snapshot } = av.applyManualAvailability(base, { entries: [entry({ status: 'rotation' })] }, { now: NOW });
  assert.equal(scoreOf(snapshot, fitPlayer.id).score, scoreOf(base, fitPlayer.id).score);
});

ok('a manual Cleared to play overrides a feed injury', () => {
  const { snapshot } = av.applyManualAvailability(base,
    { entries: [entry({ playerId: injured.id, status: 'fit', note: 'Back in training' })] }, { now: NOW });
  const p = snapshot.players.find((x) => x.id === injured.id);
  assert.equal(p.availability.status, 'available');
  assert.equal(p.availability.feedStatus, 'injured', 'the feed status is kept for the admin page');
});

ok('the input snapshot is never mutated', () => {
  const before = JSON.stringify(base.players.find((p) => p.id === fitPlayer.id));
  av.applyManualAvailability(base, { entries: [entry({})] }, { now: NOW });
  assert.equal(JSON.stringify(base.players.find((p) => p.id === fitPlayer.id)), before);
});

/* ── 4. Flags and warnings ───────────────────────────── */

ok('feed injuries become flags carrying the feed read time', () => {
  const ctx = buildContext(base);
  const flags = av.buildFlags(ctx, { now: NOW, feedCheckedAt: '2026-11-14T11:55:00Z' });
  const f = flags.get(injured.id);
  assert.equal(f.status, 'out');
  assert.equal(f.origin, 'feed');
  assert.equal(f.checkedAt, '2026-11-14T11:55:00.000Z');
});

ok('manual beats feed, and a stale manual entry says so', () => {
  const { snapshot } = av.applyManualAvailability(base, { entries: [
    entry({ playerId: injured.id, status: 'doubt', note: 'Trained Thursday', checkedAt: '2026-11-10T09:00:00Z' })
  ] }, { now: NOW });
  const f = av.buildFlags(buildContext(snapshot), { now: NOW }).get(injured.id);
  assert.equal(f.origin, 'manual');
  assert.equal(f.status, 'doubt');
  assert.equal(f.stale, true, 'four days is past the 72 hour line');
});

ok('modelled rotation flags only a minority of the game', () => {
  const ctx = buildContext(base);
  const flags = av.buildFlags(ctx, { now: NOW });
  const rotation = [...flags.values()].filter((f) => f.status === 'rotation');
  assert.ok(rotation.length > 0, 'the rule should find someone in a full sample season');
  assert.ok(rotation.length < ctx.players.length * 0.1, `${rotation.length} is too many to be useful`);
  assert.ok(rotation.every((f) => f.origin === 'computed'));
});

ok('the squad warning names exactly the flagged players, worst first', () => {
  const { snapshot } = av.applyManualAvailability(base, { entries: [entry({ status: 'rotation' })] }, { now: NOW });
  const ctx = buildContext(snapshot);
  const flags = av.buildFlags(ctx, { now: NOW });
  const clean = ctx.players.filter((p) => !flags.has(p.id)).slice(0, 5).map((p) => p.id);
  const ids = [fitPlayer.id, injured.id, ...clean];
  const warned = av.squadWarnings(ctx, ids, flags);
  assert.deepEqual(warned.map((w) => w.player.id), [injured.id, fitPlayer.id]);
});

ok('a cleared player is not a warning', () => {
  const { snapshot } = av.applyManualAvailability(base,
    { entries: [entry({ playerId: injured.id, status: 'fit' })] }, { now: NOW });
  const ctx = buildContext(snapshot);
  assert.equal(av.squadWarnings(ctx, [injured.id], av.buildFlags(ctx, { now: NOW })).length, 0);
});

ok('"checked" times read as plain English', () => {
  assert.equal(av.ago('2026-11-14T11:59:30Z', NOW), 'just now');
  assert.equal(av.ago('2026-11-14T11:30:00Z', NOW), '30 minutes ago');
  assert.equal(av.ago('2026-11-14T09:00:00Z', NOW), '3 hours ago');
  assert.equal(av.ago('2026-11-12T12:00:00Z', NOW), '2 days ago');
});

/* ── 5. Loader, file and pages ───────────────────────── */

await okAsync('a missing availability file leaves the snapshot usable', async () => {
  const fail = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const snap = await withManualAvailability(base, { availabilityUrl: '/x.json' }, { fetch: fail });
  assert.equal(snap.availability.loaded, false);
  assert.equal(snap.players.length, base.players.length);
});

await okAsync('a served file is applied by the loader', async () => {
  const serve = async () => ({ ok: true, status: 200, json: async () => ({ entries: [entry({})] }) });
  const snap = await withManualAvailability(base, { availabilityUrl: '/x.json', now: NOW }, { fetch: serve });
  assert.equal(snap.availability.active, 1);
  assert.equal(snap.players.find((p) => p.id === fitPlayer.id).availability.status, 'injured');
});

ok('the committed file is valid and loses nothing on reading', () => {
  const doc = JSON.parse(readFileSync(join(APP, 'data', 'availability.json'), 'utf8'));
  assert.equal(doc.schemaVersion, av.SCHEMA_VERSION);
  assert.ok(Array.isArray(doc.entries));
  assert.equal(av.normaliseManualDoc(doc).rejected, 0, 'every committed entry must survive the reader');
});

ok('the pages carry the hub: badges, filter, warning and an unindexed admin page', () => {
  const read = (f) => readFileSync(join(APP, f), 'utf8');
  assert.match(read('assets/page-players.js'), /flagBadge\(/);
  assert.match(read('players/index.html'), /value="clear">Hide flagged players/);
  assert.match(read('assets/page-home.js'), /Flagged in your seven/);
  assert.match(read('assets/page-home.js'), /squadWarnings\(/);
  const admin = read('admin/availability/index.html');
  assert.match(admin, /<meta name="robots" content="noindex, nofollow">/);
  assert.ok(!/rel="canonical"/.test(admin), 'the admin page must not ask to be indexed');
  for (const f of ['index.html', 'fixtures/index.html', 'players/index.html', 'clubs/index.html',
    'record/index.html', 'how-to-play/index.html', 'availability/index.html']) {
    assert.ok(!read(f).includes('/fantasy-efl/admin/'), `${f} links to the admin page`);
  }
  const robots = readFileSync(join(ROOT, 'scripts', 'seo', 'routes.mjs'), 'utf8');
  assert.match(robots, /Disallow: \/fantasy-efl\/admin\//);
});

ok('no em dashes in the hub\'s reader-facing copy', () => {
  for (const f of ['availability/index.html', 'admin/availability/index.html',
    'assets/availability.js', 'assets/page-availability.js', 'assets/page-admin.js']) {
    const src = readFileSync(join(APP, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!src.includes('—'), `${f} has an em dash`);
  }
});

console.log(`✓ Fantasy EFL availability: ${passed} checks passed`);
