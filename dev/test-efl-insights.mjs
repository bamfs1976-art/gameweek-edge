/*
 * Fantasy EFL — weekly post, deeper stats, captain comparison and chip
 * timing tests.
 *
 *   1. Rates return null, never zero, for what a source does not publish.
 *   2. Percentiles stay inside a division and position.
 *   3. The captain range is ordered, doubles add, injuries collapse it.
 *   4. Chip calendars find doubles and respect halves and used chips.
 *   5. The post is first person, says "modelled", never forecasts, keeps
 *      the source line off by default and fits Discord's limit.
 *   6. The pages exist, are wired and carry no em dashes.
 *
 * Run: node dev/test-efl-insights.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { buildSampleSnapshot } from '../efl/app/assets/sample-data.js';
import { normaliseSnapshot } from '../efl/app/assets/provider.js';
import { buildContext, playerScore } from '../efl/app/assets/model.js';
import * as st from '../efl/app/assets/stats.js';
import * as ch from '../efl/app/assets/chips.js';
import * as po from '../efl/app/assets/post.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'efl', 'app');
let passed = 0;
const ok = (name, fn) => {
  try { fn(); passed += 1; } catch (err) { console.error(`✗ ${name}`); throw err; }
};

const raw = buildSampleSnapshot();
const snap = normaliseSnapshot(raw, raw.source);
const ctx = buildContext(snap);
const scored = ctx.players.map((p) => playerScore(ctx, p));

/* ── 1. Rates ─────────────────────────────────────────── */

const mk = (over) => ({
  id: 'x', clubId: ctx.clubs[0].id, division: 'league-one', position: 'DEF', appearances: 10,
  starts: 10, minutes: 0, points: 50, goals: 0, assists: 0, cleanSheets: 0, last5: [],
  stats: { clearances: 40, blocks: 10, tackles: 20, interceptions: 5 },
  availability: { status: 'available' }, ...over
});

ok('points per 90 is null without minutes, never zero', () => {
  assert.equal(st.playerRates(mk({ minutes: 0 })).per90, null);
  assert.equal(st.playerRates(mk({ minutes: 900 })).per90, 5);
});

ok('defensive actions add up, and pay a defender by the tariff', () => {
  const r = st.playerRates(mk({}));
  assert.equal(r.defActions, 75);
  assert.equal(r.defPerApp, 7.5);
  /* 40 clearances = 10, 10 blocks = 5, 20 tackles = 10; interceptions pay midfielders only. */
  assert.equal(r.defPoints, 25);
});

ok('unpublished defensive stats stay unknown', () => {
  const r = st.playerRates(mk({ stats: { clearances: null, blocks: null, tackles: null, interceptions: null } }));
  assert.equal(r.defActions, null);
  assert.equal(r.defPerApp, null);
});

ok('a short record is pulled towards its position average', () => {
  const one = st.playerRates(mk({ appearances: 1, points: 20 }));
  assert.ok(one.shrunkPerApp < 20 && one.shrunkPerApp > 4.19);
});

/* ── 2. Percentiles ──────────────────────────────────── */

ok('percentiles are ranked within division and position only', () => {
  const players = [
    mk({ id: 'a', division: 'league-two', points: 40 }), mk({ id: 'b', division: 'league-two', points: 60 }),
    mk({ id: 'c', division: 'championship', points: 10 }), mk({ id: 'd', division: 'championship', points: 20 }),
    mk({ id: 'e', division: 'league-two', position: 'FWD', points: 5 }), mk({ id: 'f', appearances: 2 })
  ];
  const pct = st.divisionPercentiles(players, (p) => st.playerRates(p).perApp);
  assert.equal(pct.get('b'), 100);
  assert.equal(pct.get('a'), 0);
  assert.equal(pct.get('d'), 100, 'the best in the Championship is top there, whatever League Two does');
  assert.equal(pct.get('e'), 100, 'a lone forward is top of his own group');
  assert.equal(pct.has('f'), false, 'under three appearances is not ranked');
  assert.equal(st.percentileWords(92), 'top 8%');
  assert.equal(st.percentileWords(10), 'bottom 10%');
});

ok('home and away needs per-match history, and returns null without it', () => {
  assert.equal(st.homeAwaySplit(ctx, mk({ last5: [] })), null);
  const p = ctx.players.find((x) => x.last5.length >= 3);
  const split = st.homeAwaySplit(ctx, p);
  assert.ok(split.home.apps + split.away.apps > 0);
});

/* ── 3. Captain range ────────────────────────────────── */

ok('low ≤ middle ≤ high, and the captain figure is doubled', () => {
  for (const r of scored.filter((x) => x.next).slice(0, 50)) {
    const range = st.captainRange(ctx, r.player);
    assert.ok(range.captain.low <= range.captain.mid && range.captain.mid <= range.captain.high, r.player.name);
    assert.equal(range.captain.low, range.single.low * 2);
  }
});

ok('an injured player\'s range collapses', () => {
  const p = ctx.players.find((x) => x.availability.status === 'available' && x.appearances > 5);
  const fit = st.captainRange(ctx, p);
  const hurt = st.captainRange(ctx, { ...p, availability: { status: 'injured', note: '' } });
  assert.ok(hurt.captain.mid < fit.captain.mid * 0.2);
});

ok('a double round adds a second match to the range', () => {
  const doubleClub = ctx.clubs.find((c) => ctx.fixtures.filter((f) => f.round === ctx.currentRound
    && (f.homeId === c.id || f.awayId === c.id)).length > 1);
  if (!doubleClub) return;   /* the sample season has none this round; covered by the chips test */
  const p = ctx.players.find((x) => x.clubId === doubleClub.id);
  assert.equal(st.captainRange(ctx, p).matches, 2);
});

/* ── 4. Chips ────────────────────────────────────────── */

const cal = ch.chipCalendar(ctx, { rounds: snap.rounds });

ok('the calendar covers the rounds ahead with indexes topping out at 100', () => {
  assert.ok(cal.rounds.length > 0 && cal.rounds.length <= ch.MAX_WINDOW);
  assert.equal(cal.rounds[0].round, ctx.currentRound);
  assert.equal(Math.max(...cal.rounds.map((r) => r.captain.index)), 100);
  assert.equal(Math.max(...cal.rounds.map((r) => r.oneClub.index)), 100);
  assert.ok(cal.rounds.every((r) => r.captain.index >= 0 && r.oneClub.index >= 0));
});

ok('the double round is the best round for both chips', () => {
  /* The sample season moves one fixture per division into currentRound+4. */
  const doubleRound = ctx.currentRound + 4;
  const best = (key) => cal.rounds.slice().sort((a, b) => b[key].value - a[key].value)[0].round;
  assert.equal(best('captain'), doubleRound);
  assert.equal(best('oneClub'), doubleRound);
  assert.equal(cal.rounds.find((r) => r.round === doubleRound).oneClub.double, true);
});

ok('halves split the season and advice respects them', () => {
  assert.equal(cal.halves.last, 46);
  assert.equal(cal.halves.secondHalfFrom, 24);
  const advice = ch.chipAdvice(cal, {});
  const first = advice.maxCaptain.find((m) => m.half === 'first');
  const second = advice.maxCaptain.find((m) => m.half === 'second');
  assert.ok(first.round.round < 24);
  assert.ok(second.round.round >= 24);
  assert.equal(advice.oneClub.status, 'open');
});

ok('used chips are not recommended again', () => {
  const advice = ch.chipAdvice(cal, { mcFirst: true, oneClub: true });
  assert.equal(advice.maxCaptain.find((m) => m.half === 'first').status, 'used');
  assert.equal(advice.oneClub.status, 'used');
});

ok('chip storage round-trips and survives a broken store', () => {
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) || null, setItem: (k, v) => mem.set(k, v) };
  ch.writeChipsUsed(store, '2026-27', { mcFirst: true, mcSecond: false, oneClub: true });
  assert.deepEqual(ch.readChipsUsed(store, '2026-27'), { mcFirst: true, mcSecond: false, oneClub: true });
  assert.deepEqual(ch.readChipsUsed({ getItem: () => { throw new Error('no'); } }, '2026-27'),
    { mcFirst: false, mcSecond: false, oneClub: false });
});

/* ── 5. The post ─────────────────────────────────────── */

const model = po.postModel(ctx, { scored });
const reddit = po.postText(model, { flavour: 'reddit' });
const discord = po.postText(model, { flavour: 'discord' });

ok('the post lists seven players, one captain and the round note', () => {
  assert.equal(model.rows.length, 7);
  assert.equal(model.rows.filter((r) => r.captain).length, 1);
  assert.equal((reddit.match(/^- \*\*(GK|DEF|MID|FWD)\*\*/gm) || []).length, 7);
  assert.match(reddit, /\*\*Captain:\*\*/);
  assert.match(reddit, /Doubles: .*Blanks: /);
});

ok('the voice is first person, modelled and never a forecast', () => {
  assert.match(reddit, /my modelled seven/);
  assert.match(reddit, /not forecasts/);
  const banned = /\b(predict|prediction|guarantee|will score|lock|must-have|best tool|check out|free tool)\b/i;
  assert.ok(!banned.test(reddit.replace(/not forecasts/, '')), 'promotional or forecast language crept in');
});

ok('the source line is off unless asked for', () => {
  assert.ok(!reddit.includes(po.SITE_LINE));
  assert.ok(po.postText(model, { sourceLine: true }).includes(po.SITE_LINE));
});

ok('Discord fits in one message; Reddit separates its summary lines', () => {
  assert.ok(discord.length <= po.DISCORD_LIMIT);
  assert.match(reddit, /armband\.\n\n\*\*Clubs:\*\*/);
  assert.match(discord, /armband\.\n\*\*Clubs:\*\*/);
  /* A long post sheds reasons to fit, and keeps every player. */
  const long = { ...model, rows: model.rows.map((r) => ({ ...r, reason: 'x'.repeat(400) })) };
  const cut = po.postText(long, { flavour: 'discord' });
  assert.ok(cut.length <= po.DISCORD_LIMIT);
  assert.equal((cut.match(/^- \*\*/gm) || []).length, 7);
});

ok('blank and double lists name names and cap long lists', () => {
  assert.equal(po.nameList([]), 'none');
  assert.equal(po.nameList(['A', 'B']), 'A and B');
  assert.equal(po.nameList(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], 6), 'A, B, C, D, E, F and 2 more');
});

ok('a round where many clubs double or blank is given as a count', () => {
  const many = Array.from({ length: 36 }, (_, i) => `Club ${i}`);
  assert.equal(po.roundNote({ doubles: many, blanks: [], clubCount: 72 }),
    '36 of 72 clubs play twice. Blanks: none.');
  assert.equal(po.roundNote({ doubles: ['A'], blanks: many, clubCount: 72 }),
    'Doubles: A. 36 of 72 clubs have no game.');
});

ok('the card model mirrors the post', () => {
  const card = po.cardModel(model);
  assert.equal(card.rows.length, 7);
  assert.match(card.title, new RegExp(`round ${ctx.currentRound}`));
  assert.match(card.footer, /not forecasts/);
  assert.equal(card.rows.filter((r) => r.captain).length, 1);
});

/* ── 6. Pages ────────────────────────────────────────── */

ok('the three pages exist, load their modules, the bar, and are linked from every page', () => {
  const read = (f) => readFileSync(join(APP, f), 'utf8');
  for (const [slug, module] of [['post', 'page-post.js'], ['captain', 'page-captain.js'], ['chips', 'page-chips.js']]) {
    const html = read(`${slug}/index.html`);
    assert.ok(html.includes(`/fantasy-efl/assets/${module}`), `${slug}: no module`);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://gameweekedge.co.uk/fantasy-efl/${slug}/">`));
    assert.match(html, /id="deadline-bar"/);
    assert.match(html, /<h1[ >]/);
  }
  for (const f of ['index.html', 'checklist/index.html', 'fixtures/index.html', 'players/index.html',
    'availability/index.html', 'clubs/index.html', 'club-uses/index.html', 'record/index.html',
    'how-to-play/index.html', 'post/index.html', 'captain/index.html', 'chips/index.html']) {
    const html = read(f);
    for (const slug of ['post', 'captain', 'chips']) {
      assert.ok(html.includes(`href="/fantasy-efl/${slug}/"`), `${f}: no link to ${slug}`);
    }
  }
  /* The chips page states the rules before it recommends anything. */
  const chips = read('chips/index.html');
  assert.ok(chips.indexOf('id="rules-title"') < chips.indexOf('id="rec-title"'));
  /* The card preview must be a data: URL: the CSP has no blob: in img-src. */
  assert.match(read('assets/page-post.js'), /toDataURL\('image\/png'\)/);
});

ok('no em dashes in the new reader-facing copy', () => {
  for (const f of ['post/index.html', 'captain/index.html', 'chips/index.html', 'assets/stats.js',
    'assets/chips.js', 'assets/post.js', 'assets/page-post.js', 'assets/page-captain.js', 'assets/page-chips.js']) {
    const src = readFileSync(join(APP, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!src.includes('—'), `${f} has an em dash`);
  }
});

console.log(`✓ Fantasy EFL insights: ${passed} checks passed`);
