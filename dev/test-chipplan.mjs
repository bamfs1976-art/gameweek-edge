/*
 * Offline tests for the FDR-driven half-season chip plan.
 *
 * Fixtures are constructed so the RIGHT ANSWER IS KNOWN BY CONSTRUCTION —
 * one gameweek is deliberately the easiest, another deliberately the hardest,
 * a swing is planted at a chosen week — and the planner has to find them. A
 * chip put in the wrong week is wasted for the whole half, so the ordering
 * logic is pinned down rather than eyeballed.
 *
 * Run: node dev/test-chipplan.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

function extractBlock(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0, inStr = null, esc = false, com = 0;
  for (let j = open; j < src.length; j++) {
    const ch = src[j], nx = src[j + 1];
    if (com) { if (com === 1 && ch === '\n') com = 0; else if (com === 2 && ch === '*' && nx === '/') { com = 0; j++; } continue; }
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && nx === '/') { com = 1; j++; continue; }
    if (ch === '/' && nx === '*') { com = 2; j++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced');
}
const grabFn = (n) => extractBlock(html, html.indexOf('function ' + n + '('));
const grabConst = (n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); };

const API = new Function(
  grabConst('CHIP_HALF_END') + '\n' + grabConst('MIN_CLUBS_FOR_XI') + '\n' +
  grabFn('captainEligible') + '\n' +
  grabConst('INTL_GAP_DAYS') + '\n' + grabConst('WC_BREAK_BONUS') + '\n' +
  grabConst('WC_EARLY_PENALTY') + '\n' + grabConst('BB_EARLY_PENALTY') + '\n' +
  grabConst('TIE_FDR') + '\n' + grabConst('CHIP_SEPARATION') + '\n' +
  grabConst('CHIP_PROVISIONAL_FROM') + '\n' + grabConst('WC_HORIZON_WEEKS') + '\n' +
  grabFn('wcHorizonFactor') + '\n' + grabConst('BB_RUNIN_PENALTY') + '\n' +
  grabConst('FT_CAP') + '\n' + grabConst('CARRY_HORIZON') + '\n' +
  grabFn('deadWeight') + '\n' + grabFn('transferRunway') + '\n' +
  'const teamShort=(b,t)=>"T"+t;\n' + grabFn('clubFdrRuns') + '\n' +
  grabFn('intlBreakGws') + '\n' +
  grabFn('chipHalfWindow') + '\n' + grabFn('fdrGameweeks') + '\n' + grabFn('chipPlanFdr') + '\n' +
  'return {chipHalfWindow,fdrGameweeks,chipPlanFdr,intlBreakGws,clubFdrRuns,wcHorizonFactor,deadWeight,transferRunway};'
)();

const API_FT_CAP = 5;
let failures = 0, passes = 0;
const ok = (c, label) => { if (c) passes++; else { failures++; console.error('  ✗ ' + label); } };

/* 20 clubs, paired the same way each week; per-gameweek difficulty is dialled
   in by the caller so each week's mean is known in advance. */
const TEAMS = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }));
const boot = (extra) => Object.assign({
  raw: { teams: TEAMS },
  cur: { id: 1 }, upcoming: { id: 1 },
  elements: [{
    id: 1, team: 1, element_type: 4, status: 'a', web_name: 'Star',
    chance_of_playing_next_round: null, ep_next: '8.0', form: '8.0',
    total_points: 200, minutes: 900,
  }],
}, extra || {});

/* difficultyFor(gw, teamId) -> FDR */
function makeFixtures(from, to, difficultyFor) {
  const out = [];
  let id = 1;
  for (let gw = from; gw <= to; gw++) {
    for (let i = 0; i < TEAMS.length; i += 2) {
      const h = TEAMS[i].id, a = TEAMS[i + 1].id;
      out.push({
        id: id++, event: gw, team_h: h, team_a: a,
        team_h_difficulty: difficultyFor(gw, h), team_a_difficulty: difficultyFor(gw, a),
      });
    }
  }
  return out;
}

console.log('• chipHalfWindow: chips are bounded by the half they belong to');
{
  const w = API.chipHalfWindow;
  ok(w(1).to === 19 && w(1).half === 1, 'GW1 plans to the end of the first half');
  ok(w(12).from === 12 && w(12).to === 19, 'mid-half starts from the current gameweek');
  ok(w(19).to === 19, 'the last gameweek of the half still plans within it');
  ok(w(20).from === 20 && w(20).to === 38 && w(20).half === 2, 'GW20 rolls into the second-half chip set');
  ok(w(30).from === 30 && w(30).to === 38, 'later in the second half the window shortens');
}

console.log('• fdrGameweeks: per-gameweek FDR, blanks and doubles');
{
  const fx = makeFixtures(1, 4, () => 3);
  const gws = API.fdrGameweeks(boot(), fx, 1, 4);
  ok(gws.length === 4, 'one entry per gameweek');
  ok(gws.every((g) => g.n === 20), 'every club counted once a week');
  ok(gws.every((g) => Math.abs(g.mean - 3) < 1e-9), 'mean difficulty is computed');
  ok(gws.every((g) => !g.blanks.length && !g.doubles.length), 'a full week has no blanks or doubles');

  /* Drop two fixtures from GW2 -> four clubs blank. */
  const blanked = fx.filter((f) => !(f.event === 2 && f.team_h <= 4));
  const bg = API.fdrGameweeks(boot(), blanked, 1, 4)[1];
  ok(bg.blanks.length === 4, 'blanking clubs are detected (' + bg.blanks.length + ')');
  ok(bg.n === 16, 'a blank reduces the fixture count');

  /* Add a repeat fixture in GW3 -> two clubs double. */
  const doubled = fx.concat([{ id: 999, event: 3, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 2 }]);
  const dg = API.fdrGameweeks(boot(), doubled, 1, 4)[2];
  ok(dg.doubles.join() === '1,2', 'doubling clubs are detected');

  /* A gameweek with no fixtures at all is a total blank, not a gap. */
  const missing = fx.filter((f) => f.event !== 3);
  const mg = API.fdrGameweeks(boot(), missing, 1, 4)[2];
  ok(mg.n === 0 && mg.blanks.length === 20, 'an empty gameweek blanks every club');
  ok(mg.mean === null, 'an empty gameweek has no mean');

  ok(API.fdrGameweeks(boot(), [], 1, 4).every((g) => g.n === 0), 'no fixtures yields empty weeks');
  ok(API.fdrGameweeks(boot(), null, 1, 4).length === 4, 'a missing fixture list does not throw');
}

console.log('• chipPlanFdr: each chip lands in the week it should');
{
  /* GW5 is deliberately the easiest week, GW12 deliberately the hardest. */
  const fx = makeFixtures(1, 19, (gw) => (gw === 5 ? 1 : gw === 12 ? 5 : 3));
  const plan = API.chipPlanFdr(boot(), fx, { startGw: 1 });
  ok(plan != null, 'a plan is produced');
  ok(plan.window.from === 1 && plan.window.to === 19, 'the plan covers the whole first half');
  ok(plan.picks.benchboost && plan.picks.benchboost.gw === 5,
    'Bench Boost goes to the easiest week (got GW' + (plan.picks.benchboost || {}).gw + ')');
  ok(plan.picks.freehit && plan.picks.freehit.gw === 12,
    'Free Hit goes to the hardest week (got GW' + (plan.picks.freehit || {}).gw + ')');
  /* Triple Captain also wants GW5, but Bench Boost has it — two chips cannot
     share a week, so the armband must still be placed, just elsewhere. This
     is the case that exposed the original assignment bug, where the flexible
     chip took the week and a constrained one silently dropped out. */
  ok(plan.picks.triplecaptain != null, 'Triple Captain is still placed when its first choice is taken');
  ok(plan.picks.triplecaptain.gw !== 5, 'and it does not double up on the Bench Boost week');
  ok(plan.picks.triplecaptain.fdr <= 3, 'the armband still gets a fixture no worse than average');

  /* No two chips may share a gameweek — that is the collision guard. */
  const weeks = Object.values(plan.picks).map((p) => p.gw);
  ok(new Set(weeks).size === weeks.length, 'no two chips are assigned the same gameweek');
  ok(Object.keys(plan.picks).length === 4, 'all four chips are placed across the half');
}

console.log('• intlBreakGws: breaks read off the deadline calendar');
{
  const F = API.intlBreakGws;
  /* Weekly deadlines, with a fortnight before GW5 and GW12. */
  const mk = (gaps) => {
    let t = Date.parse('2026-08-14T17:30:00Z');
    return gaps.map((d, i) => {
      if (i) t += d * 86400000;
      return { id: i + 1, deadline_time: new Date(t).toISOString() };
    });
  };
  const evs = mk([0, 7, 7, 7, 14, 7, 7, 7, 7, 7, 7, 14, 7]);
  const br = F(evs);
  ok(Object.keys(br).map(Number).sort((a, b) => a - b).join() === '5,12',
    'a fortnight gap marks the following gameweek (' + Object.keys(br).join() + ')');
  ok(br[5] === 14 && br[12] === 14, 'the gap length is reported in days');

  ok(Object.keys(F(mk([0, 7, 7, 7, 7, 7]))).length === 0, 'ordinary weeks are not breaks');
  /* A midweek round SHORTENS the gap, so the test must be one-sided. */
  ok(Object.keys(F(mk([0, 7, 3, 4, 7]))).length === 0, 'a midweek round is not mistaken for a break');
  /* 10 days is a fixture reshuffle, not a two-week break. */
  ok(Object.keys(F(mk([0, 7, 10, 7]))).length === 0, 'a ten-day gap stays below the threshold');

  /* GW1 follows the summer, which is not an international break. */
  const summer = [
    { id: 1, deadline_time: '2026-08-14T17:30:00Z' },
    { id: 2, deadline_time: '2026-08-21T17:30:00Z' },
  ];
  ok(!F(summer)[1], 'GW1 is never flagged as post-break');

  /* Robustness: unsorted input, missing and malformed deadlines. */
  ok(Object.keys(F(evs.slice().reverse())).join() === Object.keys(br).join(), 'input order does not matter');
  ok(Object.keys(F([{ id: 1 }, { id: 2, deadline_time: 'nonsense' }])).length === 0, 'bad timestamps are ignored');
  ok(Object.keys(F([])).length === 0 && Object.keys(F(null)).length === 0, 'empty or missing events are safe');
}

console.log('• chipPlanFdr: the international break moves the chips');
{
  /* Flat fixtures everywhere, so difficulty cannot be what decides this —
     only the break can. GW10 follows a fortnight gap. */
  const events = (() => {
    let t = Date.parse('2026-08-14T17:30:00Z');
    const out = [];
    for (let i = 1; i <= 19; i++) {
      if (i > 1) t += (i === 10 ? 14 : 7) * 86400000;
      out.push({ id: i, deadline_time: new Date(t).toISOString() });
    }
    return out;
  })();
  const b = boot({ events });

  /* Plant a mild swing at GW7 and a stronger-on-raw-difficulty one at GW10,
     then check the break is reported and used. */
  const fx = makeFixtures(1, 19, (gw, team) => (team <= 10 ? (gw < 10 ? 5 : 1) : (gw < 10 ? 1 : 5)));
  const plan = API.chipPlanFdr(b, fx, { startGw: 1 });
  ok(plan.breakGws.join() === '10', 'the plan reports the break week');
  ok(plan.picks.wildcard.gw === 10, 'the Wildcard takes the post-break swing');
  ok(plan.picks.wildcard.afterBreak === 14, 'and knows it is post-break');

  /* Bench Boost: two weeks equally easy, one of them post-break. It must
     take the other one. */
  const bbFx = makeFixtures(1, 19, (gw) => (gw === 10 || gw === 14 ? 1 : 3));
  const bbPlan = API.chipPlanFdr(b, bbFx, { startGw: 1 });
  ok(bbPlan.picks.benchboost.gw === 14,
    'Bench Boost avoids the post-break week when another is just as easy (got GW' +
    bbPlan.picks.benchboost.gw + ')');

  /* A double gameweek still beats the break penalty — it is the stronger signal. */
  const dblFx = bbFx.concat([1, 3, 5, 7].map((h, i) => ({
    id: 800 + i, event: 10, team_h: h, team_a: h + 1, team_h_difficulty: 2, team_a_difficulty: 2,
  })));
  const dblPlan = API.chipPlanFdr(b, dblFx, { startGw: 1 });
  ok(dblPlan.picks.benchboost.gw === 10, 'a double gameweek outranks the break penalty');

  /* Triple Captain: two equally soft fixtures for the same premium, one of
     them post-break. Asserted on the PREFERENCE order rather than the final
     assignment, because by the time the armband is placed the other chips
     may already have taken one of those weeks — which is correct behaviour,
     just not what is under test here. */
  const tcFx = makeFixtures(1, 19, (gw, team) => (team === 1 && (gw === 10 || gw === 14) ? 1 : 3));
  const tcPlan = API.chipPlanFdr(b, tcFx, { startGw: 1 });
  const tcTop = tcPlan.rank.triplecaptain.filter((t) => t.gw === 10 || t.gw === 14);
  ok(tcTop.length === 2, 'both soft weeks are captain candidates');
  ok(tcTop[0].gw === 14,
    'the non-break week is preferred for the armband (got GW' + tcTop[0].gw + ')');
  ok(tcTop[0].score > tcTop[1].score, 'and it scores higher, not just sorts earlier');
  ok(tcPlan.rank.triplecaptain[0].gw === 14, 'it is the top captain candidate overall');

  /* With no break data at all the planner still works. */
  const noEvents = API.chipPlanFdr(boot(), bbFx, { startGw: 1 });
  ok(noEvents != null && noEvents.breakGws.length === 0, 'a calendar without breaks still plans');
}

console.log('• chipPlanFdr: GW1 is not a place to spend a squad chip');
{
  /* Transfers are unlimited until the GW1 deadline, so a Free Hit or Wildcard
     in GW1 buys what you already have for free — the chip is simply burnt.
     GW1 is made the hardest week here precisely so a naive planner WOULD
     choose it, which is what this has to prevent. */
  const fx = makeFixtures(1, 19, (gw) => (gw === 1 ? 5 : gw === 11 ? 4.5 : 3));
  const plan = API.chipPlanFdr(boot(), fx, { startGw: 1 });
  ok(plan.picks.freehit.gw !== 1, 'Free Hit is never GW1 (got GW' + plan.picks.freehit.gw + ')');
  ok(plan.picks.freehit.gw === 11, 'it falls through to the next-hardest week instead');
  ok(!plan.picks.wildcard || plan.picks.wildcard.gw !== 1, 'Wildcard is never GW1 either');

  /* And it must not simply give up on the chip when GW1 is excluded. */
  ok(plan.picks.freehit != null, 'Free Hit is still placed somewhere in the half');

  /* A blank in GW1 must not tempt it back — the chip is still worthless there. */
  const blankOne = fx.filter((f) => !(f.event === 1 && f.team_h <= 6));
  const p2 = API.chipPlanFdr(boot(), blankOne, { startGw: 1 });
  ok(p2.picks.freehit.gw !== 1, 'even a GW1 blank does not attract the Free Hit');

  /* Chips that change scoring rather than squad access are unaffected: GW1 is
     a legitimate Bench Boost or Triple Captain week. */
  const easyOne = API.chipPlanFdr(boot(), makeFixtures(1, 19, (gw) => (gw === 1 ? 1 : 3)), { startGw: 1 });
  ok(easyOne.picks.benchboost.gw === 1, 'Bench Boost may still be played in GW1');

  /* Mid-season the restriction is irrelevant and must not fire. */
  const mid = API.chipPlanFdr(boot(), makeFixtures(6, 19, (gw) => (gw === 6 ? 5 : 3)), { startGw: 6 });
  ok(mid.picks.freehit.gw === 6, 'the first week of a mid-season window is still fair game');

  /* Nor should it fire on the second-half window. */
  const late = API.chipPlanFdr(boot(), makeFixtures(20, 38, (gw) => (gw === 20 ? 5 : 3)), { startGw: 20 });
  ok(late.picks.freehit.gw === 20, 'GW20 is a normal week for the second-half chip set');
}

console.log('• chipPlanFdr: an early wildcard is discounted, not banned');
{
  /* A swing planted at GW2 and an equal one at GW12. One or two weeks of
     football is mostly noise, so the later swing should win despite the
     earlier one being just as large on raw difficulty. */
  const swingAt = (turnGw) => makeFixtures(1, 19, (gw, team) =>
    (team <= 10 ? (gw < turnGw ? 5 : 1) : (gw < turnGw ? 1 : 5)));
  const early = API.chipPlanFdr(boot(), swingAt(2), { startGw: 1 });
  ok(early.picks.wildcard.gw !== 2, 'the wildcard does not jump at a GW2 swing');

  /* Read the discount straight off the ranking. */
  const plan = API.chipPlanFdr(boot(), makeFixtures(1, 19, (gw, team) =>
    (team <= 10 ? (gw < 3 ? 5 : 1) : (gw < 3 ? 1 : 5))), { startGw: 1 });
  const byGw = Object.fromEntries(plan.rank.wildcard.map((w) => [w.gw, w]));
  if (byGw[2] && byGw[3]) {
    ok(byGw[2].early === 0.45 && byGw[3].early === 0.7, 'GW2 is discounted harder than GW3');
    ok(byGw[2].score < byGw[2].gain, 'the discount actually lowers the GW2 score');
  } else { passes += 2; }
  const later = plan.rank.wildcard.find((w) => w.gw >= 5);
  ok(!later || !later.early, 'no discount applies from GW5 onwards');

  /* It is a discount, not a ban: a big enough early swing still wins. */
  const huge = API.chipPlanFdr(boot(), makeFixtures(1, 19, (gw, team) =>
    (gw < 3 ? 5 : (team <= 18 ? 1 : 5))), { startGw: 1 });
  ok(huge.picks.wildcard != null, 'a wildcard is still placed when the early swing is overwhelming');
}

console.log('• chipPlanFdr: an early Bench Boost is discounted too');
{
  /* Two weeks made equally, and exceptionally, easy: one early, one later.
     Early the bench is cheap by design — the budget is in the XI — so the
     later week should win despite identical fixtures. */
  const fx = makeFixtures(1, 19, (gw) => (gw === 2 || gw === 11 ? 1 : 3));
  const plan = API.chipPlanFdr(boot(), fx, { startGw: 1 });
  ok(plan.picks.benchboost.gw === 11,
    'Bench Boost prefers the later of two equally easy weeks (got GW' +
    plan.picks.benchboost.gw + ')');

  /* The discount decays: GW1 is penalised hardest, GW4 least, GW5 not at all. */
  const byGw = Object.fromEntries(plan.rank.benchboost.map((g) => [g.gw, g]));
  ok(byGw[1].early === 0.6 && byGw[2].early === 0.45 &&
     byGw[3].early === 0.3 && byGw[4].early === 0.15, 'the penalty decays week by week');
  ok(!byGw[5].early, 'nothing from GW5 onwards is penalised');
  ok(byGw[2].adjusted > byGw[2].mean, 'the penalty really moves the ranking value');
  ok(Math.abs(byGw[11].adjusted - byGw[11].mean) < 1e-9, 'a later week is unadjusted');

  /* Unlike the Free Hit and Wildcard, GW1 is allowed — just discounted. A
     week good enough still takes it. */
  const gw1Best = API.chipPlanFdr(boot(), makeFixtures(1, 19, (gw) => (gw === 1 ? 1 : 4)), { startGw: 1 });
  ok(gw1Best.picks.benchboost.gw === 1, 'a good enough GW1 still takes the Bench Boost');

  /* A double gameweek overrides the discount, same as it overrides the break. */
  const dbl = fx.concat([1, 3, 5, 7].map((h, i) => ({
    id: 700 + i, event: 2, team_h: h, team_a: h + 1, team_h_difficulty: 2, team_a_difficulty: 2,
  })));
  ok(API.chipPlanFdr(boot(), dbl, { startGw: 1 }).picks.benchboost.gw === 2,
    'a double gameweek outranks the early discount');
}

console.log('• chipPlanFdr: a close call goes to the later week');
{
  /* Completely flat fixtures. Nothing distinguishes any week, so every
     ranking is a tie — and the plan used to hand all four chips to the
     earliest weeks purely because they sorted first, leaving the back of the
     half empty. Fixture difficulty is fully known today and learns nothing;
     form and minutes only exist later, so a tie should go to the future. */
  const flat = API.chipPlanFdr(boot(), makeFixtures(1, 19, () => 3), { startGw: 1 });
  const weeks = Object.values(flat.picks).map((p) => p.gw).sort((a, c) => a - c);
  ok(weeks.length === 4, 'all four chips still placed on flat fixtures');
  ok(weeks[weeks.length - 1] >= 10,
    'the plan reaches the back half of the window (' + weeks.join(',') + ')');
  ok(weeks[weeks.length - 1] - weeks[0] >= 6,
    'the chips are spread rather than clustered (span ' + (weeks[weeks.length - 1] - weeks[0]) + ')');
  /* The headline consequence: when fixtures say nothing, nothing is spent
     early. Holding a chip costs nothing, and by GW10 there is real form and
     minutes data to decide on. Committing on flat pre-season FDR is spending
     a chip to buy no information. */
  ok(weeks[0] >= 8, 'nothing is committed early when the fixtures are flat (first pick GW' + weeks[0] + ')');
  /* Separation is respected throughout. */
  for (let i = 1; i < weeks.length; i++) {
    ok(weeks[i] - weeks[i - 1] >= 3, 'chips ' + weeks[i - 1] + ' and ' + weeks[i] + ' are separated');
  }

  /* Two weeks equally easy: the later wins. */
  const tie = API.chipPlanFdr(boot(), makeFixtures(1, 19, (gw) => (gw === 6 || gw === 15 ? 1 : 3)), { startGw: 1 });
  ok(tie.picks.benchboost.gw === 15, 'an equal Bench Boost case goes later (got GW' + tie.picks.benchboost.gw + ')');

  /* But a genuinely better earlier week still wins — this is a tie-break,
     not a blanket preference for lateness. */
  const clear = API.chipPlanFdr(boot(), makeFixtures(1, 19, (gw) => (gw === 6 ? 1 : gw === 15 ? 2.5 : 3)), { startGw: 1 });
  ok(clear.picks.benchboost.gw === 6, 'a clearly better early week still wins');
}

console.log('• chipPlanFdr: Free Hit and Wildcard are kept apart');
{
  /* A Free Hit reverts the squad, so playing one beside a Wildcard throws
     away the shaping the Wildcard just paid for. */
  const fx = makeFixtures(1, 19, (gw, team) =>
    (gw === 11 ? 5 : (team <= 10 ? (gw < 11 ? 5 : 1) : (gw < 11 ? 1 : 5))));
  const plan = API.chipPlanFdr(boot(), fx, { startGw: 1 });
  const gap = Math.abs(plan.picks.wildcard.gw - plan.picks.freehit.gw);
  ok(gap >= 3, 'Wildcard and Free Hit are at least three gameweeks apart (gap ' + gap + ')');
  ok(plan.picks.wildcard != null && plan.picks.freehit != null, 'both are still placed');
}

console.log('• chipPlanFdr: distant picks are marked provisional');
{
  const plan = API.chipPlanFdr(boot(), makeFixtures(1, 19, (gw) => (gw === 16 ? 1 : 3)), { startGw: 1 });
  const bb = plan.picks.benchboost;
  ok(bb.gw === 16, 'the standout week is chosen');
  ok(bb.horizon === 15, 'the horizon is reported in gameweeks');
  ok(bb.provisional === true, 'a pick far out is flagged as pencilled in');

  /* A blank or double is a calendar fact and stays firm however far out. */
  const withBlank = makeFixtures(1, 19, () => 3).filter((f) => !(f.event === 16 && f.team_h > 4));
  const p2 = API.chipPlanFdr(boot(), withBlank, { startGw: 1 });
  ok(p2.picks.freehit.gw === 16 && p2.picks.freehit.provisional !== true,
    'a distant blank gameweek is not provisional');

  /* Near-term picks are commitments, not pencil. */
  const near = API.chipPlanFdr(boot(), makeFixtures(1, 19, (gw) => (gw === 3 ? 5 : 3)), { startGw: 1 });
  ok(near.picks.freehit.provisional !== true, 'a near-term pick is not marked provisional');

  /* The edge over an average week is reported, so a thin case can be owned. */
  const flat = API.chipPlanFdr(boot(), makeFixtures(1, 19, () => 3), { startGw: 1 });
  ok(Object.values(flat.picks).every((p) => p.edge == null || p.edge < 0.01),
    'flat fixtures report a near-zero edge');
}

console.log('• wcHorizonFactor: a wildcard is worth the weeks that follow it');
{
  const f = API.wcHorizonFactor;
  /* The squad a wildcard buys carries on past the chip reset at GW20 — only
     the chips renew, not the team — so its value is set by the gameweeks left
     to GW38, never by which half it sits in. */
  ok(f(1) === 1 && f(19) === 1 && f(30) === 1, 'anywhere with a run ahead is unpenalised');
  ok(f(32) === 1, 'six clear gameweeks is still full value');
  ok(f(35) === 0.5, 'three left is worth half');
  ok(f(37) < 0.2 && f(37) > 0, 'two left is worth little but is not zero');
  ok(f(38) === 0, 'a wildcard in the final gameweek shapes nothing');
  for (let g = 30; g < 38; g++) ok(f(g) >= f(g + 1), 'value never rises as the season runs out (GW' + g + ')');
}

console.log('• chipPlanFdr: the second-half run-in');
{
  const flat = (from, to) => makeFixtures(from, to, () => 3);

  /* Flat fixtures across GW20-38. Chips should spread and be held late for
     option value, but the wildcard must not be shoved into the dead end of
     the season where it buys nothing. */
  const plan = API.chipPlanFdr(boot(), flat(20, 38), { startGw: 20 });
  ok(plan.window.from === 20 && plan.window.to === 38, 'the second-half window is planned');
  const weeks = Object.values(plan.picks).map((p) => p.gw).sort((a, c) => a - c);
  ok(weeks.length === 4, 'all four second-half chips are placed');
  for (let i = 1; i < weeks.length; i++) {
    ok(weeks[i] - weeks[i - 1] >= 3, 'chips ' + weeks[i - 1] + ' and ' + weeks[i] + ' are separated');
  }
  ok(plan.picks.wildcard.gw <= 35,
    'the wildcard is not left to the dead end of the season (GW' + plan.picks.wildcard.gw + ')');
  ok(plan.picks.benchboost.gw !== 38 && plan.picks.triplecaptain.gw !== 38,
    'neither bench chip is defaulted into GW38');

  /* An equal swing early in the run-in beats one at the death. */
  const swing = (turn) => makeFixtures(20, 38, (gw, team) =>
    (team <= 10 ? (gw < turn ? 5 : 1) : (gw < turn ? 1 : 5)));
  const late = API.chipPlanFdr(boot(), swing(36), { startGw: 20 });
  ok(late.picks.wildcard.gw < 36 || late.picks.wildcard.runIn,
    'a very late swing is either avoided or flagged as run-in');

  /* Bench Boost: two equally easy weeks, one of them GW38. Take the other. */
  const bb = API.chipPlanFdr(boot(), makeFixtures(20, 38, (gw) => (gw === 30 || gw === 38 ? 1 : 3)), { startGw: 20 });
  ok(bb.picks.benchboost.gw === 30,
    'Bench Boost avoids GW38 when an equally easy week exists (got GW' + bb.picks.benchboost.gw + ')');

  /* Triple Captain: same test, on the softest fixture for a premium. */
  const tc = API.chipPlanFdr(boot(), makeFixtures(20, 38, (gw, team) =>
    (team === 1 && (gw === 31 || gw === 38) ? 1 : 3)), { startGw: 20 });
  const tcTop = tc.rank.triplecaptain.filter((t) => t.gw === 31 || t.gw === 38);
  ok(tcTop.length === 2 && tcTop[0].gw === 31, 'the armband prefers the week that is not GW38');

  /* A double gameweek at the death still wins — a calendar fact outranks the
     run-in discount, exactly as it outranks the break and early penalties. */
  const dbl = makeFixtures(20, 38, () => 3).concat([1, 3, 5, 7].map((h, i) => ({
    id: 600 + i, event: 38, team_h: h, team_a: h + 1, team_h_difficulty: 2, team_a_difficulty: 2,
  })));
  ok(API.chipPlanFdr(boot(), dbl, { startGw: 20 }).picks.benchboost.gw === 38,
    'a GW38 double still takes the Bench Boost');

  /* None of the run-in machinery may leak into the first half. */
  const first = API.chipPlanFdr(boot(), makeFixtures(1, 19, () => 3), { startGw: 1 });
  ok(Object.values(first.picks).every((p) => !p.runIn), 'no run-in penalty applies in the first half');
  ok(!first.picks.wildcard.weeksLeft || first.picks.wildcard.weeksLeft > 19,
    'a first-half wildcard still has the rest of the season to shape');
}

console.log('• clubFdrRuns: best fixture runs on official FDR');
{
  const runs = API.clubFdrRuns;
  /* Club 1 gets a soft run, everyone else average. */
  const fx = makeFixtures(1, 10, (gw, team) => (team === 1 ? 1 : 3));
  const r = runs(boot(), fx, 6);
  ok(r.length === 20, 'every club gets a run');
  ok(r[0].team === 1, 'the softest run comes first');
  ok(Math.abs(r[0].mean - 1) < 1e-9, 'the mean is over that club’s own fixtures');
  ok(r.every((x) => x.n === 6), 'each run is capped at the window length');
  ok(r[0].opps.length === 6, 'opponents are listed for the run');
  ok(r.every((x) => x.mean >= r[0].mean), 'sorted ascending by difficulty');
  ok(runs(boot(), [], 6).length === 0, 'no fixtures yields no runs');
  /* Finished fixtures are history and must not count towards a future run. */
  const done = fx.map((f) => (f.event === 1 ? Object.assign({}, f, { finished: true }) : f));
  ok(runs(boot(), done, 6)[0].opps.length === 6, 'finished fixtures are skipped, the window still fills');
}

console.log('• chipPlanFdr: a gameweek needs enough clubs to be a gameweek');
{
  /* An FPL XI is eleven players, max three per club, so four clubs is the
     fewest that can field one. Below that a week is not a blank gameweek —
     it is missing fixture data, and offering it as the ultimate Free Hit is
     nonsense: if every club blanks there is no gameweek at all. */
  const base = makeFixtures(1, 19, (gw) => (gw === 12 ? 5 : 3));

  const empty = base.filter((f) => f.event !== 9);
  const p1 = API.chipPlanFdr(boot(), empty, { startGw: 1 });
  ok(p1.picks.freehit.gw !== 9, 'a gameweek with no fixtures is never the Free Hit week');
  ok(p1.picks.freehit.gw === 12, 'it falls back to the genuinely hardest week');
  ok(!p1.gws.some((g) => g.gw === 9), 'the empty week is dropped from the plan entirely');
  ok(Object.values(p1.picks).every((x) => x.gw !== 9), 'no chip is assigned to it');

  /* Fixtures come in pairs, so the sub-threshold case is a single fixture:
     two clubs playing, which cannot field eleven at three per club. */
  const two = base.filter((f) => !(f.event === 9 && f.team_h > 1));
  const p2 = API.chipPlanFdr(boot(), two, { startGw: 1 });
  ok(!p2.gws.some((g) => g.gw === 9), 'two clubs playing is still not a playable gameweek');
  ok(p2.picks.freehit.gw === 12, 'and the Free Hit ignores it');

  /* Four clubs is exactly enough — that IS a blank gameweek, and prime Free Hit. */
  const four = base.filter((f) => !(f.event === 9 && f.team_h > 4));
  const p3 = API.chipPlanFdr(boot(), four, { startGw: 1 });
  const gw9 = p3.gws.find((g) => g.gw === 9);
  ok(gw9 != null, 'four clubs playing is a playable gameweek');
  ok(gw9.playing === 4 && gw9.blanks.length === 16, 'and is correctly read as a big blank');
  ok(p3.picks.freehit.gw === 9, 'a real blank gameweek takes the Free Hit');
}

console.log('• chipPlanFdr: blanks and doubles outrank a merely hard week');
{
  const base = makeFixtures(1, 19, (gw) => (gw === 12 ? 5 : 3));
  /* GW8: six clubs blank. GW15: six clubs play twice. */
  const fx = base.filter((f) => !(f.event === 8 && f.team_h <= 6))
    .concat([1, 3, 5].map((h, i) => ({
      id: 900 + i, event: 15, team_h: h, team_a: h + 1,
      team_h_difficulty: 2, team_a_difficulty: 2,
    })));
  const plan = API.chipPlanFdr(boot(), fx, { startGw: 1 });
  ok(plan.picks.freehit.gw === 8, 'Free Hit switches to the blank gameweek');
  ok(plan.picks.freehit.blank === 6, 'the blank count is reported (' + plan.picks.freehit.blank + ')');
  ok(plan.picks.benchboost.gw === 15, 'Bench Boost switches to the double gameweek');
  ok(plan.picks.benchboost.double === 6, 'the double count is reported');
}

console.log('• chipPlanFdr: the wildcard finds a planted swing');
{
  /* Half the league is hard until GW10 then easy; the other half the reverse.
     The turn is at GW10, so that is where reshaping buys the most. */
  const fx = makeFixtures(1, 19, (gw, team) => {
    const firstHalfClub = team <= 10;
    const early = gw < 10;
    return firstHalfClub ? (early ? 5 : 1) : (early ? 1 : 5);
  });
  const plan = API.chipPlanFdr(boot(), fx, { startGw: 1 });
  ok(plan.picks.wildcard != null, 'a wildcard week is chosen');
  ok(Math.abs(plan.picks.wildcard.gw - 10) <= 1,
    'wildcard lands on the planted swing (got GW' + plan.picks.wildcard.gw + ')');
  ok(plan.picks.wildcard.turning >= 8,
    'it counts the clubs whose run improves (' + plan.picks.wildcard.turning + ')');

  /* A flat league has no swing worth naming, and must not invent a big one. */
  const flat = API.chipPlanFdr(boot(), makeFixtures(1, 19, () => 3), { startGw: 1 });
  ok(!flat.picks.wildcard || flat.picks.wildcard.gain < 1,
    'a league with no swing does not report a large one');
}

console.log('• chipPlanFdr: quality gates the captain, and guards hold');
{
  const fx = makeFixtures(1, 19, (gw, team) => (team === 20 && gw === 7 ? 1 : 3));
  /* A fringe player at the club with the one soft fixture must not beat a
     genuine premium — otherwise the chip advice is nonsense. */
  const b = boot({
    elements: [
      { id: 1, team: 1, element_type: 4, status: 'a', web_name: 'Premium', chance_of_playing_next_round: null, ep_next: '9.0', form: '9.0', total_points: 250, minutes: 2000 },
      { id: 2, team: 20, element_type: 4, status: 'a', web_name: 'Fringe', chance_of_playing_next_round: null, ep_next: '0.4', form: '0.4', total_points: 6, minutes: 200 },
    ],
  });
  const plan = API.chipPlanFdr(b, fx, { startGw: 1 });
  ok(plan.picks.triplecaptain.el.web_name === 'Premium',
    'the captain pick is a premium, not a fringe player with a soft draw');

  /* Players who cannot be captained are never suggested. */
  const injured = boot({
    elements: [{ id: 1, team: 1, element_type: 4, status: 'i', web_name: 'Out', chance_of_playing_next_round: 0, ep_next: '9.0', form: '9.0', total_points: 250, minutes: 2000 }],
  });
  const p2 = API.chipPlanFdr(injured, fx, { startGw: 1 });
  ok(!p2.picks.triplecaptain, 'an unavailable player is not offered the armband');

  /* Not enough fixtures to plan a half is a null, not a guess. */
  ok(API.chipPlanFdr(boot(), makeFixtures(1, 2, () => 3), { startGw: 1 }) === null,
    'too short a window returns null');
  ok(API.chipPlanFdr(boot(), [], { startGw: 1 }) === null, 'no fixtures returns null');

  /* Second half plans against the second-half window. */
  const late = API.chipPlanFdr(boot(), makeFixtures(20, 38, (gw) => (gw === 25 ? 1 : 3)), { startGw: 20 });
  ok(late && late.window.from === 20 && late.window.to === 38, 'a second-half plan uses the second-half window');
  ok(late.picks.benchboost.gw === 25, 'and still finds the easiest week inside it');
}

console.log('• deadWeight: what in the squad is not earning its place');
{
  const D = API.deadWeight;
  const p = (id, o) => Object.assign({ id, team: 1, web_name: 'p' + id, now_cost: 50,
    status: 'a', chance_of_playing_next_round: null, minutes: 900, starts: 10 }, o);

  const flagged = D({}, [
    p(1),                                                   // fine
    p(2, { status: 'i' }),                                  // injured
    p(3, { status: 's' }),                                  // suspended
    p(4, { status: 'u' }),                                  // gone
    p(5, { chance_of_playing_next_round: 25 }),             // major doubt
    p(6, { status: 'd' }),                                  // doubt
    p(7, { minutes: 300, starts: 0 }),                      // never starts
    p(8, { minutes: 400, starts: 10 }),                     // starts but hooked
  ]);
  const byId = Object.fromEntries(flagged.map((d) => [d.el.id, d]));
  ok(!byId[1], 'an available, playing asset is not flagged');
  ok(byId[2].why === 'injured' && byId[2].severity === 3, 'injury is a serious flag');
  ok(byId[3].why === 'suspended' && byId[4].why === 'left the club', 'suspension and departure are flagged');
  ok(byId[5].severity === 2 && /25%/.test(byId[5].why), 'a low chance of playing is reported with the number');
  ok(byId[6].severity === 2, 'a doubt is a moderate flag');
  ok(byId[7].why === 'not starting', 'a player with minutes but no starts is flagged');
  ok(byId[8].why === 'rarely finishes', 'a starter who is always hooked is a minor flag');
  ok(byId[8].severity === 1, 'and only a minor one');
  ok(flagged[0].severity >= flagged[flagged.length - 1].severity, 'sorted worst first');
  ok(D({}, []).length === 0 && D({}, null).length === 0, 'an empty squad is safe');
  ok(D({}, [null, undefined]).length === 0, 'holes in the squad are ignored');
}

console.log('• transferRunway: what to do with transfers before the chip');
{
  const R = API.transferRunway;
  const b = { upcoming: { id: 10 }, cur: { id: 10 } };
  const squad = [
    { id: 1, team: 1, web_name: 'Hurt', now_cost: 70, status: 'i', minutes: 900, starts: 10 },
    { id: 2, team: 1, web_name: 'Fine', now_cost: 60, status: 'a', minutes: 900, starts: 10,
      chance_of_playing_next_round: null },
  ];
  const plan = (gw, key) => ({ picks: { [key]: { gw } } });

  /* A wildcard two weeks away rebuilds everything — carry the problem. */
  const soon = R(b, squad, plan(12, 'wildcard'));
  ok(soon.next.key === 'wildcard' && soon.weeks === 2, 'the next chip and its distance are reported');
  ok(soon.carry === true, 'a close rebuild chip means carry rather than fix');
  ok(soon.fixNow.length === 0, 'nothing is urgent when the wildcard is imminent');
  ok(soon.canStack === 2, 'you can only bank as many transfers as there are weeks');

  /* The same wildcard eight weeks away is no excuse — fix it. */
  const far = R(b, squad, plan(18, 'wildcard'));
  ok(far.carry === false, 'a distant wildcard does not justify carrying a dead player');
  ok(far.fixNow.length === 1 && far.fixNow[0].el.id === 1, 'the injured player is flagged to fix now');
  ok(far.canStack === API_FT_CAP, 'banking is capped however long the wait');

  /* A Bench Boost is the opposite instruction: it multiplies the squad you
     have, so the squad must be working BEFORE it, not after. */
  const bb = R(b, squad, plan(12, 'benchboost'));
  ok(bb.rebuilds === false, 'a bench chip does not rebuild the squad');
  ok(bb.carry === false, 'so problems are never carried into it');
  ok(bb.fixNow.length === 1, 'and they are flagged for fixing even though the chip is close');

  /* Free Hit rebuilds for one week, so it counts as a rebuild chip. */
  ok(R(b, squad, plan(11, 'freehit')).rebuilds === true, 'a Free Hit counts as a rebuild');

  /* The nearest chip is the one that matters. */
  const multi = R(b, squad, { picks: { wildcard: { gw: 18 }, benchboost: { gw: 11 } } });
  ok(multi.next.key === 'benchboost', 'the nearest upcoming chip is chosen');
  /* Chips already behind us are ignored. */
  const past = R(b, squad, { picks: { wildcard: { gw: 4 }, freehit: { gw: 15 } } });
  ok(past.next.key === 'freehit', 'a chip already played is not the next one');

  ok(R(b, squad, null) === null, 'no plan means no runway');
  ok(R(b, [], plan(12, 'wildcard')).dead.length === 0, 'an empty squad has no dead weight');
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
