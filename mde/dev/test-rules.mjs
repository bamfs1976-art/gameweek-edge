/*
 * Matchday Edge — rules engine tests.
 *
 * Phase 1 of the build, and the gate on everything after it: nothing else
 * ships until these pass. The reason is not ceremony. Every other screen in
 * this app is a question asked of rules.js, so a wrong constant here is a
 * wrong answer everywhere at once, and the kind of wrong answer you only
 * find out about after the deadline.
 *
 * WHAT IS WORTH TESTING HERE:
 *   1. The CONSTANTS, against the published rules. Fifteen players, the
 *      club cap at each stage, seventeen deadlines in order, the transfer
 *      allowance matchday by matchday. Boring, and exactly the sort of
 *      thing that gets mistyped once and believed all season.
 *   2. The RULES THAT INTERACT. Carry-over is the example: two free a week
 *      sounds simple until you ask what happens after a Wildcard, after an
 *      unlimited window, or in a knockout round. Those three answers are
 *      all "nothing carries", and all three arrive by different routes.
 *   3. The RULES THAT COST POINTS IF MISREAD. You cannot bring on a player
 *      whose club has already kicked off. You cannot change the armband
 *      back. Touch anything and auto-subs stop. Each of these is a trap
 *      with a real price, and each gets a test that fails loudly.
 *   4. The SCORING TABLE, position by position. A goalkeeper's goal is
 *      worth six and a forward's is worth four; if that inverts, every xP
 *      number downstream is confidently wrong.
 *
 * WHAT IS NOT TESTED: kick-off times and the day-by-day split of a
 * matchday. Those come from the feed in Phase 2, and pinning them here
 * would be pinning a guess.
 *
 * Run: node mde/dev/test-rules.mjs   (wired into npm test)
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const R = await import(join(HERE, '..', 'app', 'assets', 'rules.js'));

let checks = 0;
let failures = 0;
const ok = (label, fn) => {
  try {
    fn();
    checks += 1;
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${label}\n    ${err.message}`);
  }
};

/* ── A legal squad to push around ─────────────────────────────
   Three players from each of five clubs, which sits exactly on the league
   phase cap, and prices chosen to total exactly 100.0 through decimals
   that a naive float sum gets wrong. */
const P = (id, pos, club, price) => ({ id, name: `P${id}`, pos, club, price });
const SQUAD = Object.freeze([
  P(1, 'GK', 'A', 5.1), P(2, 'GK', 'B', 4.4),
  P(3, 'DEF', 'A', 5.6), P(4, 'DEF', 'A', 5.1), P(5, 'DEF', 'B', 6.1), P(6, 'DEF', 'B', 5.3), P(7, 'DEF', 'C', 6.4),
  P(8, 'MID', 'C', 8.1), P(9, 'MID', 'C', 7.3), P(10, 'MID', 'D', 9.2), P(11, 'MID', 'D', 7.1), P(12, 'MID', 'D', 6.3),
  P(13, 'FWD', 'E', 10.1), P(14, 'FWD', 'E', 8.4), P(15, 'FWD', 'E', 5.5),
]);
const byId = (id) => SQUAD.find((p) => p.id === id);
const pick = (...ids) => ids.map(byId);
/* 3-5-2. Bench in priority order: spare keeper, two defenders, a forward. */
const XI = pick(1, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14);
const BENCH = pick(2, 6, 7, 15);
const codes = (res) => res.breaches.map((b) => b.code);

/* ═══ The calendar ═══════════════════════════════════════════ */

console.log('• the calendar');

ok('fifteen players, split 2/5/5/3', () => {
  assert.equal(R.SQUAD_SIZE, 15);
  assert.equal(R.SQUAD_SHAPE.GK + R.SQUAD_SHAPE.DEF + R.SQUAD_SHAPE.MID + R.SQUAD_SHAPE.FWD, R.SQUAD_SIZE);
  assert.equal(R.XI_SIZE + R.BENCH_SIZE, R.SQUAD_SIZE);
});

ok('seventeen matchdays, seventeen deadlines', () => {
  assert.equal(R.MATCHDAY_COUNT, 17);
  assert.equal(R.DEADLINES.length, 17);
});

ok('every matchday belongs to exactly one stage', () => {
  const seen = [];
  for (const stage of R.STAGES) seen.push(...stage.mds);
  assert.deepEqual([...seen].sort((a, b) => a - b), Array.from({ length: 17 }, (_, i) => i + 1));
  assert.equal(new Set(seen).size, 17, 'no matchday in two stages');
});

ok('stages map to the published rounds', () => {
  assert.equal(R.stageFor(1).key, 'league');
  assert.equal(R.stageFor(8).key, 'league');
  assert.equal(R.stageFor(9).key, 'playoff');
  assert.equal(R.stageFor(10).key, 'playoff');
  assert.equal(R.stageFor(11).key, 'r16');
  assert.equal(R.stageFor(12).key, 'r16');
  assert.equal(R.stageFor(13).key, 'qf');
  assert.equal(R.stageFor(14).key, 'qf');
  assert.equal(R.stageFor(15).key, 'sf');
  assert.equal(R.stageFor(16).key, 'sf');
  assert.equal(R.stageFor(17).key, 'final');
});

ok('budget is 100.0 in the league phase and 105.0 from the knockouts', () => {
  for (const md of [1, 4, 8]) assert.equal(R.budgetFor(md), 100.0, `MD${md}`);
  for (const md of [9, 11, 13, 15, 17]) assert.equal(R.budgetFor(md), 105.0, `MD${md}`);
});

ok('the club cap climbs 3, 4, 4, 5, 6, 8', () => {
  assert.equal(R.clubCapFor(1), 3);
  assert.equal(R.clubCapFor(8), 3);
  assert.equal(R.clubCapFor(9), 4);
  assert.equal(R.clubCapFor(12), 4);
  assert.equal(R.clubCapFor(13), 5);
  assert.equal(R.clubCapFor(16), 6);
  assert.equal(R.clubCapFor(17), 8);
});

ok('deadlines run in order and span September to June', () => {
  for (let i = 1; i < R.DEADLINES.length; i++) {
    assert.ok(R.DEADLINES[i] > R.DEADLINES[i - 1], `MD${i + 1} must fall after MD${i}`);
  }
  assert.equal(R.deadlineFor(1), '2026-09-08');
  assert.equal(R.deadlineFor(8), '2027-01-27');
  assert.equal(R.deadlineFor(17), '2027-06-05');
});

ok('a matchday outside 1-17 is an error, not a silent undefined', () => {
  assert.throws(() => R.stageFor(0), RangeError);
  assert.throws(() => R.stageFor(18), RangeError);
  assert.throws(() => R.deadlineFor(1.5), RangeError);
  assert.equal(R.isMatchday(0), false);
  assert.equal(R.isMatchday(17), true);
});

ok('MD8 and the final are single blocks with no change window', () => {
  assert.equal(R.isSingleBlock(8), true);
  assert.equal(R.isSingleBlock(17), true);
  assert.equal(R.inMatchdayChangesAllowed(8), false);
  assert.equal(R.inMatchdayChangesAllowed(17), false);
  for (const md of [1, 2, 7, 9, 12, 16]) {
    assert.equal(R.inMatchdayChangesAllowed(md), true, `MD${md} should have a gap`);
  }
});

ok('prices are frozen through MD2 and move from MD3', () => {
  assert.equal(R.pricesLocked(1), true);
  assert.equal(R.pricesLocked(2), true);
  assert.equal(R.pricesLocked(3), false);
  assert.equal(R.pricesLocked(17), false);
});

ok('nextMatchdayAfter finds the deadline you are still in front of', () => {
  assert.equal(R.nextMatchdayAfter('2026-08-27'), 1);
  assert.equal(R.nextMatchdayAfter('2026-09-08'), 1, 'deadline day still counts');
  assert.equal(R.nextMatchdayAfter('2026-09-09'), 2);
  assert.equal(R.nextMatchdayAfter('2027-05-05'), 17);
  assert.equal(R.nextMatchdayAfter('2027-06-06'), null, 'season over');
});

/* ═══ Transfers ══════════════════════════════════════════════ */

console.log('• transfers');

ok('MD1, MD9 and MD11 are the unlimited windows', () => {
  assert.deepEqual([...R.UNLIMITED_TRANSFER_MDS], [1, 9, 11]);
  for (const md of [1, 9, 11]) assert.equal(R.isUnlimitedTransferMd(md), true, `MD${md}`);
  for (const md of [2, 8, 10, 12, 17]) assert.equal(R.isUnlimitedTransferMd(md), false, `MD${md}`);
});

ok('the league phase pays two a week', () => {
  for (let md = 2; md <= 8; md++) assert.equal(R.baseFreeTransfers(md), 2, `MD${md}`);
});

ok('the knockout allowance is the published irregular one', () => {
  assert.equal(R.baseFreeTransfers(10), 2);
  assert.equal(R.baseFreeTransfers(12), 3);
  assert.equal(R.baseFreeTransfers(13), 5);
  assert.equal(R.baseFreeTransfers(14), 3);
  assert.equal(R.baseFreeTransfers(15), 5);
  assert.equal(R.baseFreeTransfers(16), 3);
  assert.equal(R.baseFreeTransfers(17), 5);
});

ok('an unlimited matchday reports Infinity rather than a large number', () => {
  for (const md of [1, 9, 11]) assert.equal(R.baseFreeTransfers(md), Infinity, `MD${md}`);
});

ok('one transfer carries forward in the league phase, never two', () => {
  assert.equal(R.carryInto(3, { unused: 1 }), 1);
  assert.equal(R.carryInto(3, { unused: 2 }), 1, 'the cap is one');
  assert.equal(R.carryInto(3, { unused: 9 }), 1);
  assert.equal(R.carryInto(3, { unused: 0 }), 0);
  assert.equal(R.freeTransfersFor(3, { unused: 1 }), 3);
  assert.equal(R.freeTransfersFor(3, { unused: 0 }), 2);
});

ok('nothing carries into a knockout matchday', () => {
  for (const md of [10, 12, 13, 14, 15, 16, 17]) {
    assert.equal(R.carryInto(md, { unused: 1 }), 0, `MD${md}`);
  }
  assert.equal(R.freeTransfersFor(12, { unused: 1 }), 3, 'the MD12 allowance, and not one more');
});

ok('nothing carries out of a chip matchday', () => {
  assert.equal(R.carryInto(5, { unused: 1, chipPlayedPrevMd: 'wildcard' }), 0);
  assert.equal(R.carryInto(5, { unused: 1, chipPlayedPrevMd: 'limitless' }), 0);
  assert.equal(R.freeTransfersFor(5, { unused: 1, chipPlayedPrevMd: 'wildcard' }), 2);
});

ok('nothing carries out of an unlimited window', () => {
  /* "Unused" after MD1 is not a number, and treating it as one would hand
     you a free transfer the game never gave you. */
  assert.equal(R.carryInto(2, { unused: Infinity }), 0);
  assert.equal(R.freeTransfersFor(2, { unused: Infinity }), 2);
  assert.equal(R.carryInto(1, { unused: 1 }), 0, 'nothing precedes MD1');
});

ok('each move past the allowance costs four', () => {
  assert.equal(R.HIT_COST, 4);
  assert.equal(R.transferHitCost(2, 2), 0);
  assert.equal(R.transferHitCost(1, 2), 0);
  assert.equal(R.transferHitCost(3, 2), 4);
  assert.equal(R.transferHitCost(5, 2), 12);
});

ok('an unlimited window never charges a hit', () => {
  assert.equal(R.transferHitCost(15, Infinity), 0);
  assert.equal(R.transferHitCost(15, R.freeTransfersFor(9)), 0);
});

ok('the break-even is strict: a move must beat its cost, not match it', () => {
  assert.equal(R.transferIsWorthIt(4.5, 3, 2), true);
  assert.equal(R.transferIsWorthIt(4.0, 3, 2), false, 'exactly four is a wash');
  assert.equal(R.transferIsWorthIt(0.1, 2, 2), true, 'no hit, so any gain does');
});

/* ═══ Chips ══════════════════════════════════════════════════ */

console.log('• chips');

ok('the two chips differ on budget and on whether the squad sticks', () => {
  assert.equal(R.CHIPS.wildcard.budgetApplies, true);
  assert.equal(R.CHIPS.wildcard.squadPersists, true);
  assert.equal(R.CHIPS.limitless.budgetApplies, false);
  assert.equal(R.CHIPS.limitless.squadPersists, false);
  assert.equal(R.CHIPS.wildcard.unlimitedTransfers, true);
  assert.equal(R.CHIPS.limitless.unlimitedTransfers, true);
});

ok('neither chip can be played on MD1, MD9 or MD11', () => {
  for (const chip of ['wildcard', 'limitless']) {
    for (const md of [1, 9, 11]) {
      const res = R.canPlayChip(chip, md);
      assert.equal(res.ok, false, `${chip} on MD${md}`);
      assert.equal(res.code, 'UNLIMITED_WINDOW');
    }
  }
});

ok('a chip is playable on every other matchday', () => {
  assert.deepEqual(R.legalChipMatchdays('wildcard'), [2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 14, 15, 16, 17]);
  assert.equal(R.legalChipMatchdays('limitless').length, 14);
});

ok('a chip already played is gone, and says where it went', () => {
  const res = R.canPlayChip('wildcard', 6, { wildcardPlayedMd: 4 });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'ALREADY_PLAYED');
  assert.match(res.message, /MD4/);
  assert.equal(R.canPlayChip('limitless', 6, { wildcardPlayedMd: 4 }).ok, true, 'the other chip is untouched');
});

ok('spending one chip leaves the other its full board', () => {
  const left = R.legalChipMatchdays('limitless', { wildcardPlayedMd: 3 });
  assert.equal(left.length, 14);
});

ok('an unknown chip is rejected rather than quietly allowed', () => {
  const res = R.canPlayChip('bench-boost', 5);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'UNKNOWN_CHIP');
  assert.equal(R.canPlayChip('wildcard', 99).code, 'BAD_MATCHDAY');
});

ok('playing either chip cancels the transfers already made that matchday', () => {
  assert.equal(R.chipCancelsTransfers('wildcard'), true);
  assert.equal(R.chipCancelsTransfers('limitless'), true);
  assert.equal(R.chipCancelsTransfers('nonsense'), false);
});

/* ═══ Formations ═════════════════════════════════════════════ */

console.log('• formations');

ok('there are exactly eight legal shapes', () => {
  assert.deepEqual(
    R.LEGAL_FORMATIONS.map((f) => f.label),
    ['3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-2-3', '5-3-2', '5-4-1'],
  );
});

ok('every legal shape is eleven players with one keeper', () => {
  for (const f of R.LEGAL_FORMATIONS) {
    assert.equal(f.GK + f.DEF + f.MID + f.FWD, 11, f.label);
    assert.equal(f.GK, 1, f.label);
    assert.equal(R.isLegalFormation(f), true, f.label);
  }
});

ok('too few defenders, too few midfielders, no forward: all illegal', () => {
  assert.equal(R.isLegalFormation({ GK: 1, DEF: 2, MID: 5, FWD: 3 }), false, '2 at the back');
  assert.equal(R.isLegalFormation({ GK: 1, DEF: 5, MID: 1, FWD: 4 }), false, '1 in midfield');
  assert.equal(R.isLegalFormation({ GK: 1, DEF: 5, MID: 5, FWD: 0 }), false, 'no forward');
  assert.equal(R.isLegalFormation({ GK: 2, DEF: 4, MID: 4, FWD: 1 }), false, 'two keepers');
  assert.equal(R.isLegalFormation({ GK: 0, DEF: 5, MID: 3, FWD: 3 }), false, 'no keeper');
  assert.equal(R.isLegalFormation({ GK: 1, DEF: 4, MID: 4, FWD: 1 }), false, 'ten players');
  assert.equal(R.isLegalFormation({ GK: 1, DEF: 5, MID: 5, FWD: 1 }), false, 'twelve players');
});

ok('countPositions and formationLabel describe an XI', () => {
  assert.deepEqual(R.countPositions(XI), { GK: 1, DEF: 3, MID: 5, FWD: 2 });
  assert.equal(R.formationLabel(R.countPositions(XI)), '3-5-2');
});

/* ═══ The squad validator ════════════════════════════════════ */

console.log('• the squad validator');

ok('a legal squad passes, and the arithmetic survives decimal prices', () => {
  const res = R.validateSquad(SQUAD, 1);
  assert.deepEqual(res.breaches, []);
  assert.equal(res.ok, true);
  assert.equal(res.spend, 100.0, 'exactly on budget, not 99.99999999999999');
  assert.equal(res.remaining, 0);
  assert.equal(res.clubCap, 3);
});

ok('a penny over budget is a breach, and says by how much', () => {
  const over = SQUAD.map((p) => (p.id === 13 ? { ...p, price: 10.2 } : p));
  const res = R.validateSquad(over, 1);
  assert.equal(res.ok, false);
  assert.ok(codes(res).includes('BUDGET'));
  const b = res.breaches.find((x) => x.code === 'BUDGET');
  assert.equal(b.over, 0.1);
  assert.equal(res.remaining, -0.1);
});

ok('the same squad is comfortable on the knockout budget', () => {
  const over = SQUAD.map((p) => (p.id === 13 ? { ...p, price: 10.2 } : p));
  assert.equal(codes(R.validateSquad(over, 9)).includes('BUDGET'), false, '105.0 from MD9');
});

ok('a short squad is reported, not thrown', () => {
  const res = R.validateSquad(SQUAD.slice(0, 13), 1);
  assert.equal(res.ok, false);
  assert.ok(codes(res).includes('SQUAD_SIZE'));
  const b = res.breaches.find((x) => x.code === 'SQUAD_SIZE');
  assert.equal(b.have, 13);
  assert.equal(b.need, 15);
});

ok('an empty squad reports rather than crashes', () => {
  const res = R.validateSquad([], 1);
  assert.equal(res.ok, false);
  assert.equal(res.spend, 0);
  assert.ok(codes(res).includes('SQUAD_SIZE'));
  assert.equal(codes(res).filter((c) => c === 'POSITION_COUNT').length, 4);
});

ok('the wrong number of a position is caught per position', () => {
  const wrong = SQUAD.map((p) => (p.id === 15 ? { ...p, pos: 'MID' } : p));
  const res = R.validateSquad(wrong, 1);
  const b = res.breaches.filter((x) => x.code === 'POSITION_COUNT');
  assert.equal(b.length, 2, 'one too many midfielders, one too few forwards');
  assert.deepEqual(b.map((x) => x.pos).sort(), ['FWD', 'MID']);
});

ok('four from one club breaches the league phase cap', () => {
  const heavy = SQUAD.map((p) => (p.id === 5 ? { ...p, club: 'A' } : p));
  const res = R.validateSquad(heavy, 1);
  assert.equal(res.ok, false);
  const b = res.breaches.find((x) => x.code === 'CLUB_CAP');
  assert.equal(b.club, 'A');
  assert.equal(b.have, 4);
  assert.equal(b.cap, 3);
});

ok('the same four is legal once the cap rises', () => {
  const heavy = SQUAD.map((p) => (p.id === 5 ? { ...p, club: 'A' } : p));
  assert.equal(R.validateSquad(heavy, 9).ok, true, 'play-offs allow four');
  assert.equal(R.validateSquad(heavy, 1).ok, false, 'the league phase does not');
});

ok('six from one club needs the semi-finals', () => {
  const stacked = SQUAD.map((p) => ([2, 5, 6].includes(p.id) ? { ...p, club: 'A' } : p));
  assert.equal(codes(R.validateSquad(stacked, 13)).includes('CLUB_CAP'), true, 'QF caps at five');
  assert.equal(codes(R.validateSquad(stacked, 15)).includes('CLUB_CAP'), false, 'SF allows six');
  assert.equal(codes(R.validateSquad(stacked, 17)).includes('CLUB_CAP'), false, 'the final allows eight');
});

ok('the same player twice is caught', () => {
  const dupe = [...SQUAD.slice(0, 14), SQUAD[0]];
  assert.ok(codes(R.validateSquad(dupe, 1)).includes('DUPLICATE_PLAYER'));
});

ok('a player with no recognised position is caught', () => {
  const junk = SQUAD.map((p) => (p.id === 8 ? { ...p, pos: 'WNG' } : p));
  assert.ok(codes(R.validateSquad(junk, 1)).includes('UNKNOWN_POSITION'));
});

ok('Limitless switches the budget off and leaves the club cap on', () => {
  const dream = SQUAD.map((p) => ({ ...p, price: p.price * 2 }));
  assert.equal(codes(R.validateSquad(dream, 13)).includes('BUDGET'), true, 'without the chip, far over');
  const withChip = R.validateSquad(dream, 13, { chip: 'limitless' });
  assert.equal(withChip.ok, true);
  assert.equal(withChip.budget, Infinity);
  assert.equal(withChip.remaining, Infinity);

  const stacked = dream.map((p) => ([2, 5, 6].includes(p.id) ? { ...p, club: 'A' } : p));
  assert.ok(codes(R.validateSquad(stacked, 13, { chip: 'limitless' })).includes('CLUB_CAP'),
    'six from one club is still six from one club');
});

ok('Wildcard leaves the budget exactly where it was', () => {
  const dream = SQUAD.map((p) => ({ ...p, price: p.price * 2 }));
  const res = R.validateSquad(dream, 13, { chip: 'wildcard' });
  assert.equal(res.budget, 105.0);
  assert.ok(codes(res).includes('BUDGET'));
});

/* ═══ The XI validator ═══════════════════════════════════════ */

console.log('• the XI validator');

ok('a 3-5-2 out of the squad passes', () => {
  const res = R.validateXI(XI, { squad: SQUAD });
  assert.deepEqual(res.breaches, []);
  assert.equal(res.formation, '3-5-2');
  assert.equal(res.legal, true);
});

ok('ten men is a breach', () => {
  const res = R.validateXI(XI.slice(0, 10), { squad: SQUAD });
  assert.ok(codes(res).includes('XI_SIZE'));
});

ok('two defenders is a breach naming the position', () => {
  const thin = pick(1, 3, 4, 8, 9, 10, 11, 12, 13, 14, 15);
  const res = R.validateXI(thin, { squad: SQUAD });
  const b = res.breaches.find((x) => x.code === 'POSITION_MIN');
  assert.equal(b.pos, 'DEF');
  assert.equal(b.have, 2);
  assert.equal(b.min, 3);
});

ok('two keepers is a breach', () => {
  const twoGk = pick(1, 2, 3, 4, 5, 8, 9, 10, 11, 13, 14);
  const res = R.validateXI(twoGk, { squad: SQUAD });
  assert.ok(codes(res).includes('POSITION_MAX'));
});

ok('a starter who is not in the 15 is caught', () => {
  const stranger = [...XI.slice(0, 10), P(99, 'FWD', 'F', 6.0)];
  const res = R.validateXI(stranger, { squad: SQUAD });
  assert.ok(codes(res).includes('NOT_IN_SQUAD'));
  assert.equal(R.validateXI(stranger).ok, true, 'without the squad there is nothing to check it against');
});

ok('the same starter twice is caught', () => {
  const dupe = [...XI.slice(0, 10), XI[0]];
  assert.ok(codes(R.validateXI(dupe, { squad: SQUAD })).includes('DUPLICATE_PLAYER'));
});

/* ═══ In-matchday subs ═══════════════════════════════════════ */

console.log('• in-matchday subs');

const played = (clubs) => (club) => clubs.includes(club);

ok('a legal swap between days passes', () => {
  const res = R.validateSubs({
    md: 3, xi: XI, bench: BENCH,
    subs: [{ out: 13, in: 6 }],
    clubHasPlayed: played(['E']),
  });
  assert.deepEqual(res.breaches, []);
  assert.equal(res.formation, '4-5-1');
  assert.deepEqual(res.subbedOutScoreZero, [13]);
  assert.equal(res.autoSubsDisabled, true, 'touching anything turns auto-subs off');
});

ok('a bench player whose club has already played cannot come on', () => {
  const res = R.validateSubs({
    md: 3, xi: XI, bench: BENCH,
    subs: [{ out: 13, in: 6 }],
    clubHasPlayed: played(['B', 'E']),
  });
  assert.equal(res.ok, false);
  assert.ok(codes(res).includes('IN_ALREADY_PLAYED'));
});

ok('four swaps is the limit and five is a breach', () => {
  const four = [{ out: 3, in: 6 }, { out: 4, in: 7 }, { out: 13, in: 15 }, { out: 1, in: 2 }];
  assert.equal(codes(R.validateSubs({ md: 3, xi: XI, bench: BENCH, subs: four })).includes('TOO_MANY_SUBS'), false);
  const five = [...four, { out: 14, in: 15 }];
  assert.ok(codes(R.validateSubs({ md: 3, xi: XI, bench: BENCH, subs: five })).includes('TOO_MANY_SUBS'));
});

ok('no changes at all on MD8 or the final', () => {
  for (const md of [8, 17]) {
    const res = R.validateSubs({ md, xi: XI, bench: BENCH, subs: [{ out: 13, in: 6 }] });
    assert.equal(res.ok, false, `MD${md}`);
    assert.ok(codes(res).includes('NO_CHANGE_WINDOW'), `MD${md}`);
  }
});

ok('a swap that breaks the shape is refused', () => {
  /* Both forwards out for two defenders leaves 5-5-0. */
  const res = R.validateSubs({
    md: 3, xi: XI, bench: BENCH,
    subs: [{ out: 13, in: 6 }, { out: 14, in: 7 }],
  });
  assert.equal(res.ok, false);
  assert.ok(codes(res).includes('ILLEGAL_FORMATION'));
  assert.equal(res.formation, '5-5-0');
});

ok('you cannot sub out a player who is not starting, or in one who is not benched', () => {
  const res = R.validateSubs({ md: 3, xi: XI, bench: BENCH, subs: [{ out: 6, in: 13 }] });
  assert.ok(codes(res).includes('OUT_NOT_STARTING'));
  assert.ok(codes(res).includes('IN_NOT_BENCH'));
});

ok('the same swap twice is caught', () => {
  const res = R.validateSubs({
    md: 3, xi: XI, bench: BENCH,
    subs: [{ out: 13, in: 6 }, { out: 13, in: 7 }],
  });
  assert.ok(codes(res).includes('DUPLICATE_SUB'));
});

ok('making no changes leaves auto-subs alone', () => {
  const res = R.validateSubs({ md: 3, xi: XI, bench: BENCH, subs: [] });
  assert.equal(res.ok, true);
  assert.equal(res.autoSubsDisabled, false);
});

/* ═══ The armband ════════════════════════════════════════════ */

console.log('• the armband');

ok('the armband moves to a player still to kick off', () => {
  const res = R.validateCaptainChange({
    md: 3, from: 13, to: 8, xi: XI, clubHasPlayed: played(['E']),
  });
  assert.deepEqual(res.breaches, []);
  assert.equal(res.autoSubsDisabled, true);
});

ok('it cannot move to a player who has already played', () => {
  const res = R.validateCaptainChange({
    md: 3, from: 13, to: 8, xi: XI, clubHasPlayed: played(['C', 'E']),
  });
  assert.equal(res.ok, false);
  assert.ok(codes(res).includes('TARGET_ALREADY_PLAYED'));
});

ok('it cannot move twice, and cannot move back', () => {
  const res = R.validateCaptainChange({
    md: 3, from: 8, to: 13, xi: XI, alreadyChanged: true,
  });
  assert.equal(res.ok, false);
  assert.ok(codes(res).includes('ALREADY_CHANGED'));
});

ok('it cannot move to a player outside the XI', () => {
  const res = R.validateCaptainChange({ md: 3, from: 13, to: 6, xi: XI });
  assert.ok(codes(res).includes('NOT_IN_XI'));
});

ok('naming the current captain again is a no-op, not a spent change', () => {
  const res = R.validateCaptainChange({ md: 3, from: 8, to: 8, xi: XI });
  assert.ok(codes(res).includes('NO_OP'));
});

ok('no armband switch on MD8 or the final', () => {
  for (const md of [8, 17]) {
    const res = R.validateCaptainChange({ md, from: 13, to: 8, xi: XI });
    assert.ok(codes(res).includes('NO_CHANGE_WINDOW'), `MD${md}`);
  }
});

/* ═══ Auto-subs ══════════════════════════════════════════════ */

console.log('• auto-subs');

const playedIds = (ids) => (id) => ids.includes(id);
const ALL = SQUAD.map((p) => p.id);

ok('a keeper who did not play is replaced by the bench keeper who did', () => {
  const res = R.applyAutoSubs({ xi: XI, bench: BENCH, played: playedIds(ALL.filter((id) => id !== 1)) });
  assert.equal(res.applied, true);
  assert.deepEqual(res.subs, [{ out: 1, in: 2, reason: 'GK' }]);
  assert.equal(res.xi.find((p) => p.pos === 'GK').id, 2);
  assert.ok(res.bench.some((p) => p.id === 1));
});

ok('if neither keeper played, nothing happens', () => {
  const res = R.applyAutoSubs({ xi: XI, bench: BENCH, played: playedIds(ALL.filter((id) => id !== 1 && id !== 2)) });
  assert.equal(res.subs.length, 0);
  assert.equal(res.xi.find((p) => p.pos === 'GK').id, 1, 'you keep the blank rather than gaining a second');
});

ok('an outfielder is replaced from the bench in priority order', () => {
  const res = R.applyAutoSubs({ xi: XI, bench: BENCH, played: playedIds(ALL.filter((id) => id !== 8)) });
  assert.deepEqual(res.subs, [{ out: 8, in: 6, reason: 'OUTFIELD' }]);
  assert.equal(R.formationLabel(R.countPositions(res.xi)), '4-4-2');
});

ok('a bench player who did not play is skipped for the next one', () => {
  const res = R.applyAutoSubs({ xi: XI, bench: BENCH, played: playedIds(ALL.filter((id) => id !== 8 && id !== 6)) });
  assert.deepEqual(res.subs, [{ out: 8, in: 7, reason: 'OUTFIELD' }]);
});

ok('a replacement that would break the shape is passed over', () => {
  /* 3-4-3, with a defender missing and a forward first on the bench. Taking
     the forward would leave two at the back, so the defender behind him
     comes on instead. */
  const xi = pick(1, 3, 4, 5, 8, 9, 10, 11, 13, 14, 15);
  const bench = pick(2, 12, 6, 7);
  assert.equal(R.formationLabel(R.countPositions(xi)), '3-4-3');
  const res = R.applyAutoSubs({ xi, bench, played: playedIds(ALL.filter((id) => id !== 3)) });
  assert.deepEqual(res.subs, [{ out: 3, in: 6, reason: 'OUTFIELD' }]);
  assert.equal(R.formationLabel(R.countPositions(res.xi)), '3-4-3');
});

ok('the bench runs out and the remaining blank stands', () => {
  const res = R.applyAutoSubs({
    xi: XI, bench: BENCH,
    played: playedIds(ALL.filter((id) => ![8, 9, 10, 11].includes(id) && ![6, 7, 15].includes(id))),
  });
  assert.equal(res.subs.length, 0, 'nobody on the bench played');
  assert.equal(res.reason, 'NOTHING_TO_DO');
});

ok('several blanks are filled up to the number of usable bench players', () => {
  const res = R.applyAutoSubs({ xi: XI, bench: BENCH, played: playedIds(ALL.filter((id) => ![8, 9, 10].includes(id))) });
  assert.equal(res.subs.length, 3);
  assert.deepEqual(res.subs.map((s) => s.in), [6, 7, 15]);
  assert.equal(R.isLegalFormation(R.countPositions(res.xi)), true);
});

ok('an XI that all played is left alone', () => {
  const res = R.applyAutoSubs({ xi: XI, bench: BENCH, played: playedIds(ALL) });
  assert.equal(res.applied, false);
  assert.equal(res.reason, 'NOTHING_TO_DO');
  assert.deepEqual(res.xi.map((p) => p.id), XI.map((p) => p.id));
});

ok('one manual change turns auto-subs off for the whole matchday', () => {
  const res = R.applyAutoSubs({
    xi: XI, bench: BENCH,
    played: playedIds(ALL.filter((id) => id !== 8)),
    manualChangesMade: true,
  });
  assert.equal(res.applied, false);
  assert.equal(res.reason, 'MANUAL_CHANGES');
  assert.equal(res.subs.length, 0);
  assert.deepEqual(res.xi.map((p) => p.id), XI.map((p) => p.id));
});

/* ═══ Scoring ════════════════════════════════════════════════ */

console.log('• scoring');

const score = (stats, pos) => R.scorePlayer(stats, pos).total;
const NINETY = { minutes: 90 };

ok('turning up is one point and lasting an hour is two', () => {
  assert.equal(score({ minutes: 1, goalsConceded: 3 }, 'MID'), 1);
  assert.equal(score({ minutes: 59, goalsConceded: 3 }, 'MID'), 1);
  assert.equal(score({ minutes: 60, goalsConceded: 3 }, 'MID'), 2);
  assert.equal(score({ minutes: 0 }, 'MID'), 0, 'an unused sub scores nothing');
});

ok('a goal is worth six to a keeper and four to a forward', () => {
  assert.equal(R.SCORING.goal.GK, 6);
  assert.equal(R.SCORING.goal.DEF, 6);
  assert.equal(R.SCORING.goal.MID, 5);
  assert.equal(R.SCORING.goal.FWD, 4);
  assert.equal(score({ ...NINETY, goals: 1, goalsConceded: 1 }, 'FWD'), 6);
  assert.equal(score({ ...NINETY, goals: 1, goalsConceded: 1 }, 'MID'), 7);
  assert.equal(score({ ...NINETY, goals: 1, goalsConceded: 1 }, 'DEF'), 8);
});

ok('a goal from outside the box pays one on top', () => {
  assert.equal(score({ ...NINETY, goals: 1, goalsOutsideBox: 1, goalsConceded: 1 }, 'FWD'), 7);
  assert.equal(R.SCORING.goalOutsideBox, 1);
});

ok('a clean sheet is four at the back, one in midfield, nothing up front', () => {
  assert.equal(score({ ...NINETY, goalsConceded: 0 }, 'GK'), 6);
  assert.equal(score({ ...NINETY, goalsConceded: 0 }, 'DEF'), 6);
  assert.equal(score({ ...NINETY, goalsConceded: 0 }, 'MID'), 3);
  assert.equal(score({ ...NINETY, goalsConceded: 0 }, 'FWD'), 2);
});

ok('a clean sheet needs the full hour', () => {
  const short = { minutes: 59, goalsConceded: 0 };
  assert.equal(R.scorePlayer(short, 'DEF').cleanSheet, false);
  assert.equal(score(short, 'DEF'), 1, 'appearance only');
  assert.equal(R.scorePlayer({ minutes: 60, goalsConceded: 0 }, 'DEF').cleanSheet, true);
});

ok('keepers and defenders are docked one for every two conceded', () => {
  assert.equal(score({ ...NINETY, goalsConceded: 1 }, 'DEF'), 2, 'one goal is free');
  assert.equal(score({ ...NINETY, goalsConceded: 2 }, 'DEF'), 1);
  assert.equal(score({ ...NINETY, goalsConceded: 3 }, 'DEF'), 1, 'the third is free again');
  assert.equal(score({ ...NINETY, goalsConceded: 4 }, 'DEF'), 0);
  assert.equal(score({ ...NINETY, goalsConceded: 4 }, 'GK'), 0);
});

ok('midfielders and forwards are not docked for goals conceded', () => {
  assert.equal(score({ ...NINETY, goalsConceded: 4 }, 'MID'), 2);
  assert.equal(score({ ...NINETY, goalsConceded: 4 }, 'FWD'), 2);
  assert.deepEqual([...R.SCORING.concededPositions], ['GK', 'DEF']);
});

ok('every three saves is a point, and the remainder does not round up', () => {
  assert.equal(score({ ...NINETY, saves: 2, goalsConceded: 1 }, 'GK'), 2);
  assert.equal(score({ ...NINETY, saves: 3, goalsConceded: 1 }, 'GK'), 3);
  assert.equal(score({ ...NINETY, saves: 5, goalsConceded: 1 }, 'GK'), 3);
  assert.equal(score({ ...NINETY, saves: 6, goalsConceded: 1 }, 'GK'), 4);
});

ok('a saved penalty is five, and only a keeper can have one', () => {
  assert.equal(score({ ...NINETY, penaltySaves: 1, goalsConceded: 1 }, 'GK'), 7);
  assert.equal(score({ ...NINETY, penaltySaves: 1, goalsConceded: 1 }, 'DEF'), 2, 'ignored outfield');
});

ok('every three balls recovered is a point, for anyone', () => {
  assert.equal(score({ ...NINETY, ballsRecovered: 2, goalsConceded: 1 }, 'MID'), 2);
  assert.equal(score({ ...NINETY, ballsRecovered: 3, goalsConceded: 1 }, 'MID'), 3);
  assert.equal(score({ ...NINETY, ballsRecovered: 8, goalsConceded: 1 }, 'FWD'), 4);
});

ok('assists, Player of the Match and penalties won all pay', () => {
  assert.equal(score({ ...NINETY, assists: 1, goalsConceded: 1 }, 'MID'), 5);
  assert.equal(score({ ...NINETY, playerOfTheMatch: true, goalsConceded: 1 }, 'MID'), 5);
  assert.equal(score({ ...NINETY, penaltiesWon: 1, goalsConceded: 1 }, 'FWD'), 4);
});

ok('the punishments come off: cards, own goals, penalties given away and missed', () => {
  assert.equal(score({ ...NINETY, yellowCards: 1, goalsConceded: 1 }, 'MID'), 1);
  assert.equal(score({ ...NINETY, redCards: 1, goalsConceded: 1 }, 'MID'), -1);
  assert.equal(score({ ...NINETY, ownGoals: 1, goalsConceded: 1 }, 'MID'), 0);
  assert.equal(score({ ...NINETY, penaltiesConceded: 1, goalsConceded: 1 }, 'MID'), 1);
  assert.equal(score({ ...NINETY, penaltiesMissed: 1, goalsConceded: 1 }, 'FWD'), 0);
});

ok('extra time counts, but the appearance and the clean sheet are paid once', () => {
  const et = { minutes: 120, goalsConceded: 0 };
  assert.equal(score(et, 'DEF'), 6, 'two for the appearance and four for the sheet, not double');
  const shortEt = { minutes: 120, goalsConceded: 2 };
  assert.equal(score(shortEt, 'DEF'), 1);
});

ok('a scoreline is itemised so the debrief has something to show', () => {
  const res = R.scorePlayer({ minutes: 90, goals: 1, assists: 1, goalsConceded: 0, ballsRecovered: 6 }, 'MID');
  assert.equal(res.total, 1 + 1 + 5 + 3 + 1 + 2);
  assert.equal(res.played, true);
  assert.equal(res.cleanSheet, true);
  assert.deepEqual(
    res.lines.map((l) => l.key).sort(),
    ['appearance', 'assists', 'ballsRecovered', 'cleanSheet', 'goals', 'sixty'],
  );
  assert.equal(res.lines.reduce((t, l) => t + l.points, 0), res.total, 'the lines add up to the total');
});

ok('an unknown position is an error rather than a zero', () => {
  assert.throws(() => R.scorePlayer(NINETY, 'WNG'), RangeError);
});

ok('missing and junk stats are treated as nothing, not as NaN', () => {
  assert.equal(score({}, 'MID'), 0);
  assert.equal(score({ minutes: 90, goals: null, assists: undefined, goalsConceded: 'x' }, 'MID'), 3,
    'unparseable conceded reads as zero, so the sheet stands');
});

ok('the captain doubles, and a subbed-out player scores nothing', () => {
  const stats = {};
  for (const p of SQUAD) stats[p.id] = { minutes: 90, goalsConceded: 1 };
  stats[8] = { minutes: 90, goals: 1, goalsConceded: 1 };

  const plain = R.scoreLineup({ xi: XI, bench: BENCH, captain: null, stats });
  const withCaptain = R.scoreLineup({ xi: XI, bench: BENCH, captain: 8, stats });
  const eight = R.scorePlayer(stats[8], 'MID').total;
  assert.equal(withCaptain.total - plain.total, eight, 'the armband is worth another whole score');
  assert.equal(R.CAPTAIN_MULTIPLIER, 2);

  const subbed = R.scoreLineup({ xi: XI, bench: BENCH, captain: 8, stats, subbedOut: [13] });
  assert.equal(subbed.rows.find((r) => r.id === 13).points, 0);
  assert.equal(withCaptain.total - subbed.total, R.scorePlayer(stats[13], 'FWD').total);
});

/* ─────────────────────────────────────────────────────────── */

if (failures) {
  console.error(`\n✗ Matchday Edge rules: ${failures} failed, ${checks} passed`);
  process.exit(1);
}
console.log(`✓ Matchday Edge rules: ${checks} checks passed `
  + `(${R.MATCHDAY_COUNT} matchdays, ${R.LEGAL_FORMATIONS.length} legal formations)`);
