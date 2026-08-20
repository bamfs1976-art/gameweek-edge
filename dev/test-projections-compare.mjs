/*
 * Tests for the projection comparison maths (scripts/projection-compare.mjs).
 *
 * This code decides, in public, whether our model beat somebody else's. It
 * runs for real once — after the window it grades — so every property it needs
 * has to be proved here, on synthetic data, long before then. The tests are
 * mostly about refusing to declare things: a model that projected nothing must
 * not draw, a two-player sample must not produce a winner, and a gap inside
 * the noise must be called level.
 *
 * Run: node dev/test-projections-compare.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ranks, spearman, mae, bias, disagreements, score, verdict,
  matchPlayer, normName, MIN_MEANINGFUL_MAE } from '../scripts/projection-compare.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0, passes = 0;
const ok = (c, label) => { if (c) passes++; else { failures++; console.error('  ✗ ' + label); } };
const near = (a, b, eps = 1e-9) => a != null && Math.abs(a - b) < eps;

console.log('• projections: ranks and ties');
{
  ok(JSON.stringify(ranks([10, 20, 30])) === '[1,2,3]', 'ascending values rank 1..n');
  ok(JSON.stringify(ranks([30, 20, 10])) === '[3,2,1]', 'and the order is by value, not position');
  /* Ties matter more than they look. Marcello's own table has four forwards on
     exactly 4.28: if ties took an arbitrary order, the correlation would move
     depending on row order in a JSON file. */
  ok(JSON.stringify(ranks([5, 5, 5, 5])) === '[2.5,2.5,2.5,2.5]', 'a four-way tie takes the mean rank');
  ok(JSON.stringify(ranks([1, 2, 2, 4])) === '[1,2.5,2.5,4]', 'and a tie in the middle does too');
  const a = ranks([9, 1, 5]);
  ok(a[0] === 3 && a[1] === 1 && a[2] === 2, 'ranks come back in input order');
}

console.log('• projections: rank correlation');
{
  ok(near(spearman([1, 2, 3, 4], [1, 2, 3, 4]), 1), 'identical orders correlate 1');
  ok(near(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1), 'reversed orders correlate -1');
  /* The property the whole choice of Spearman rests on: a model that is
     uniformly 40% low is perfectly useful and must not be punished. */
  ok(near(spearman([10, 20, 30, 40], [6, 12, 18, 24]), 1),
    'a uniformly scaled projection still correlates 1 — scale is not the question');
  ok(near(spearman([10, 20, 30, 40], [110, 120, 130, 140]), 1), 'and neither is an offset');
  ok(spearman([1, 2], [1, 2]) === null, 'two points is not a correlation');
  ok(spearman([1, 2, 3], [1, 2]) === null, 'mismatched lengths refuse');
  ok(spearman([5, 5, 5], [1, 2, 3]) === null, 'a constant side has no correlation to give');
}

console.log('• projections: error and bias');
{
  ok(near(mae([[10, 8], [10, 12]]), 2), 'MAE is the mean absolute gap');
  /* Two models with identical MAE and opposite bias are different problems,
     which is the reason bias is reported beside it rather than folded in. */
  ok(near(bias([[10, 8], [10, 12]]), 0), 'symmetric errors cancel in the bias');
  ok(near(bias([[12, 10], [14, 10]]), 3), 'a model that is always high shows a positive bias');
  ok(near(mae([[12, 10], [14, 10]]), 3), 'and the same MAE, so the two together separate them');
  ok(mae([]) === null, 'no pairs is null, not zero');
  ok(bias([]) === null, 'and so is the bias');
}

console.log('• projections: disagreements');
{
  const rows = [
    { name: 'A', ours: 20, rival: 10 },   /* gap +10 */
    { name: 'B', ours: 5, rival: 30 },    /* gap -25, the biggest */
    { name: 'C', ours: 9, rival: 10 },    /* gap -1 */
    { name: 'D', ours: null, rival: 12 },
  ];
  const d = disagreements(rows, 2);
  ok(d.length === 2, 'the list is capped');
  ok(d[0].name === 'B' && d[1].name === 'A', 'ranked by SIZE of gap, ignoring direction');
  ok(d[0].gap === -25 && d[1].gap === 10, 'but the sign is kept, so who is higher survives');
  ok(!disagreements(rows, 9).some((x) => x.name === 'D'), 'a row with no number on one side is not a disagreement');
}

console.log('• projections: scoring against actuals');
{
  const rows = [
    { name: 'A', ours: 10, rival: 12, actual: 10 },
    { name: 'B', ours: 20, rival: 25, actual: 20 },
    { name: 'C', ours: 30, rival: 36, actual: 30 },
    { name: 'D', ours: 40, rival: 48, actual: null },   /* not played */
  ];
  const s = score(rows);
  ok(s.n === 3, 'only players with real points are scored');
  ok(near(s.ours.mae, 0), 'a perfect projection scores 0 MAE');
  ok(s.rival.mae > 0, 'and an imperfect one does not');
  /* The rival here is uniformly 20% high — wrong on MAE, perfect on order.
     Both facts get reported, because they lead to different conclusions. */
  ok(near(s.rank.rival, 1), 'a uniformly-scaled rival still ranks perfectly');
  ok(near(s.rank.ours, 1), 'as does ours');

  /* Correlation must be computed on the players BOTH sides projected. If each
     were scored on its own subset, a model could win by declining to project
     the hard ones — the precise incentive a published scorecard must not
     create. Here ours ducks the two players it would have got wrong, and its
     rank score must not benefit. */
  const ducked = [
    { ours: 1, rival: 1, actual: 1 },
    { ours: 2, rival: 2, actual: 2 },
    { ours: 3, rival: 3, actual: 3 },
    { ours: null, rival: 4, actual: 40 },   /* the hard ones, skipped by us */
    { ours: null, rival: 5, actual: 50 },
  ];
  const d = score(ducked);
  ok(d.bothProjected === 3, 'only the three both projected count toward the rank (' +
    d.bothProjected + ')');
  ok(d.rank !== null && Number.isFinite(d.rank.ours),
    'the rank is a real number, not NaN from comparing against skipped rows');
  ok(d.rank !== null && Number.isFinite(d.rank.rival), 'on both sides');
  ok(d.ours.n === 3 && d.rival.n === 5,
    'while MAE still reports how many each side actually staked a number on (' +
    d.ours.n + ' vs ' + d.rival.n + ')');
}

console.log('• projections: what it refuses to say');
{
  /* An absent model has not drawn. Before the season nativeXP returns null for
     everyone, and the temptation is to let the comparison run anyway. */
  const noOurs = score([
    { ours: null, rival: 10, actual: 9 }, { ours: null, rival: 20, actual: 21 },
    { ours: null, rival: 30, actual: 28 },
  ]);
  ok(noOurs.ours === null, 'a side with no projections scores null, not zero');
  ok(verdict(noOurs).call === 'incomplete', 'and the verdict refuses rather than awarding a walkover');

  /* Small samples. Thirty forwards over five weeks is already thin; three is
     not a result however clean the numbers look. */
  const tiny = score([
    { ours: 10, rival: 30, actual: 10 }, { ours: 20, rival: 60, actual: 20 },
    { ours: 30, rival: 90, actual: 30 },
  ]);
  ok(tiny.ours.mae === 0 && tiny.rival.mae > 0, 'ours is flawless and theirs is miles off');
  ok(verdict(tiny).call === 'too few', 'and it still refuses to call it on three players');

  /* A gap inside the noise. This is the one that would otherwise get published
     as a win, and it is the reason the threshold exists at all. */
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push({ ours: 10 + i, rival: 10 + i + 0.2, actual: 10 + i });
  }
  const close = score(rows);
  ok(close.rival.mae - close.ours.mae < MIN_MEANINGFUL_MAE, 'the gap is under the threshold');
  ok(verdict(close).call === 'level', 'so twenty players and a real edge is still called level');

  /* And a gap that is worth calling. */
  const clear = rows.map((r) => ({ ...r, rival: r.rival + 5 }));
  ok(verdict(score(clear)).call === 'ours', 'a gap above the threshold names a winner');
  const other = rows.map((r) => ({ ...r, ours: r.ours + 5, rival: r.actual }));
  ok(verdict(score(other)).call === 'theirs', 'and it names the other one just as readily');
}

console.log('• projections: matching a rival name to a real player');
{
  /* Shaped like the bootstrap, with the names that actually make this hard:
     accents the rival drops, two-word surnames, and a shared surname across
     two clubs. */
  const teams = [{ id: 1, name: 'Manchester United', short_name: 'MUN' },
    { id: 2, name: 'Arsenal', short_name: 'ARS' },
    { id: 3, name: 'Crystal Palace', short_name: 'CRY' },
    { id: 4, name: 'Everton', short_name: 'EVE' }];
  const els = [
    { id: 10, team: 1, web_name: 'Šeško', first_name: 'Benjamin', second_name: 'Šeško' },
    { id: 11, team: 2, web_name: 'Gyökeres', first_name: 'Viktor', second_name: 'Gyökeres' },
    { id: 12, team: 3, web_name: 'Strand Larsen', first_name: 'Jørgen', second_name: 'Strand Larsen' },
    { id: 13, team: 4, web_name: 'Barry', first_name: 'Louis', second_name: 'Barry' },
    { id: 14, team: 1, web_name: 'Barry', first_name: 'Other', second_name: 'Barry' },
    { id: 15, team: 3, web_name: 'Nketiah', first_name: 'Eddie', second_name: 'Nketiah' },
  ];
  const m = (n, t) => matchPlayer(els, teams, n, t);

  ok(normName('Šeško') === 'sesko', 'accents are stripped for comparison');
  ok(m('Šeško', 'Man Utd') == null, 'an unknown club label finds nobody rather than guessing');
  ok(m('Šeško', 'Manchester United').id === 10, 'the full club name matches');
  ok(m('Sesko', 'MUN').id === 10, 'the short code matches, and the accent can be dropped');
  ok(m('Gyokeres', 'ARS').id === 11, 'an unaccented rival spelling still finds the player');
  ok(m('Strand Larsen', 'CRY').id === 12, 'a two-word surname matches');
  ok(m('Larsen', 'CRY').id === 12, 'and its last token alone is enough inside one club');
  /* The reason the search is club-scoped at all. */
  ok(m('Barry', 'EVE').id === 13, 'a shared surname resolves by club');
  ok(m('Barry', 'MUN').id === 14, 'to the other one just as cleanly');
  ok(m('Nobody', 'ARS') == null, 'a name nobody has returns null');
  /* An ambiguous match inside one club must refuse rather than pick. */
  const twins = [{ id: 20, team: 2, web_name: 'Silva', first_name: 'A', second_name: 'Silva' },
    { id: 21, team: 2, web_name: 'Silva', first_name: 'B', second_name: 'Silva' }];
  ok(matchPlayer(twins, teams, 'Silva', 'ARS') == null,
    'two players of the same name at one club is a refusal, not a coin toss');
}

console.log('• projections: the shipped rival files');
/* A club label that matches nothing would silently drop that row from every
   comparison, so the vocabulary is pinned here rather than discovered live. */
const CLUBS = new Set(['Arsenal', 'Man City', 'Man Utd', 'Aston Villa', 'Liverpool',
  'Bournemouth', 'Sunderland', 'Brighton', 'Brentford', 'Chelsea', 'Fulham', 'Newcastle',
  'Everton', 'Leeds', 'Crystal Palace', "Nott'm Forest", 'Spurs', 'Coventry City',
  'Ipswich Town', 'Hull City']);

for (const file of ['2026-27-gw1-5-marcello.json', '2026-27-gw1-5-marcello-points-analysis.json']) {
  const f = JSON.parse(readFileSync(join(ROOT, 'data/projections', file), 'utf8'));
  const at = ' [' + file + ']';
  ok(f.players.length >= 30, 'enough rows to be worth scoring (' + f.players.length + ')' + at);
  ok(f.players.every((p) => p.name && p.team && typeof p.proj === 'number'),
    'every row has a name, a club and a projection' + at);
  ok(f.players.every((p) => p.proj > 0 && p.proj < 200), 'and a projection in a plausible range' + at);
  /* Provenance is not decoration. These numbers were transcribed from images
     by hand and will be quoted in public if we ever publish the comparison.
     `posted` may legitimately be null — one of these sheets carries no visible
     publication date and inventing one would be worse than admitting it — but
     the source and the capture method are never optional. */
  ok(f.source && f.capturedFrom, 'the file records where the numbers came from' + at);
  ok('posted' in f, 'and states a publication date even if that state is "unknown"' + at);
  ok(f.window && f.window.from === 1 && f.window.to === 5, 'and the window they cover' + at);
  /* A window nobody published has to say so, or it reads as a fact somebody
     checked. --score decides a winner off this window; a silently assumed one
     would decide it off the wrong five gameweeks. */
  if (f.windowInferred) {
    ok(/inferred/i.test(f.note || ''), 'an inferred window is explained in the note' + at);
  }
  const odd = [...new Set(f.players.map((p) => p.team))].filter((t) => !CLUBS.has(t));
  ok(odd.length === 0, 'every club label is one the matcher knows' +
    (odd.length ? ' — unknown: ' + odd.join(', ') : '') + at);
  /* Duplicates would double-weight a player in every average. */
  const names = f.players.map((p) => p.name + '|' + p.team);
  ok(new Set(names).size === names.length, 'no player appears twice' + at);
}

/* The two sheets overlap on two forwards. They are separate transcriptions of
   (apparently) the same projection, so disagreement means one of them was read
   wrong — the only independent check on hand-typed numbers this repo has. */
{
  const a = JSON.parse(readFileSync(join(ROOT, 'data/projections/2026-27-gw1-5-marcello.json'), 'utf8'));
  const b = JSON.parse(readFileSync(join(ROOT, 'data/projections/2026-27-gw1-5-marcello-points-analysis.json'), 'utf8'));
  const byName = new Map(a.players.map((p) => [p.name, p]));
  const shared = b.players.filter((p) => byName.has(p.name));
  ok(shared.length > 0, 'the two transcriptions still overlap on at least one player');
  for (const p of shared) {
    const q = byName.get(p.name);
    ok(Math.abs(Math.round(q.proj * 10) / 10 - p.proj) < 0.05,
      `${p.name}: ${q.proj} and ${p.proj} agree to rounding across the two sheets`);
    ok(q.price === p.price, `${p.name}: both sheets price him at ${p.price}`);
  }
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
