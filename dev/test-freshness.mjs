/*
 * The freshness graders, tested without a network.
 *
 * The rule worth defending is the middle verdict. A checker that goes red for
 * something correct gets muted, and a muted checker is worse than none —
 * this project already emailed a failure for three mornings running and then
 * once more for a dropped packet. So the tests below spend most of their
 * effort on ONE question: does an empty-but-correct answer stay out of the
 * failure count, and does an empty-and-wrong answer get into it?
 */
import {
  gradeBootstrap, gradeFixtures, gradeEfl, gradeCongestion,
  gradeFootballData, gradePublished, failures, DAY
} from '../scripts/freshness-rules.mjs';

let passes = 0, fails = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.log('  ✗ ' + msg); } };

const NOW = Date.parse('2026-08-13T12:00:00Z');
const iso = (days) => new Date(NOW + days * DAY).toISOString();

/* ── the season-rollover trap ─────────────────────────────────────────
   A stale bootstrap does not look broken. It answers 200 with a full squad
   list and a full fixture calendar, all of it last season's. This is the
   case a route check cannot see, and the reason the file exists. */
console.log('\n• freshness: a stale FPL feed is caught, not waved through');
{
  const healthy = { status: 200, body: {
    elements: new Array(700).fill({}),
    events: [{ id: 1, deadline_time: iso(8) }, { id: 2, deadline_time: iso(15) }]
  } };
  ok(gradeBootstrap(healthy, NOW).verdict === 'ok', 'a live pre-season feed passes');

  const lastSeason = { status: 200, body: {
    elements: new Array(700).fill({}),
    events: [{ id: 37, deadline_time: iso(-40) }, { id: 38, deadline_time: iso(-33) }]
  } };
  const g = gradeBootstrap(lastSeason, NOW);
  ok(g.verdict === 'fail', 'every deadline in the past fails (' + g.verdict + ')');
  ok(/past/.test(g.detail), 'and the detail says why, rather than just "stale"');

  ok(gradeBootstrap({ status: 200, body: { elements: [], events: [] } }, NOW).verdict === 'fail',
    'an empty bootstrap fails');
  ok(gradeBootstrap({ status: 503, body: null }, NOW).verdict === 'fail', 'a 503 fails');

  /* One unplayed fixture is enough; a season in progress is not stale. */
  ok(gradeFixtures({ status: 200, body: [{ finished: true }, { finished: false }] }, NOW)
    .verdict === 'ok', 'fixtures with one still to play pass');
  ok(gradeFixtures({ status: 200, body: [{ finished: true }] }, NOW).verdict === 'fail',
    'a fully completed season fails');
}

/* ── the rule that keeps the check trustworthy ───────────────────────── */
console.log('\n• freshness: empty-but-correct is a note, empty-and-wrong is a failure');
{
  const empty = { status: 200, body: { season: '2026-27', rows: [] } };

  const before = gradeCongestion(empty, false);
  ok(before.verdict === 'note', 'no cup rows before the cups start is a NOTE (' + before.verdict + ')');
  ok(/once european/i.test(before.why || ''),
    'and the note says when silence stops being innocent');

  const after = gradeCongestion(empty, true);
  ok(after.verdict === 'fail', 'the same empty answer WITH the cups running fails');

  /* The exit rule itself, asserted rather than assumed — this is the line
     that would quietly turn the check into a wolf-crier. */
  const mixed = [{ verdict: 'ok' }, before, { verdict: 'ok' }];
  ok(failures(mixed).length === 0, 'a run of ok + note has no failures');
  ok(failures([...mixed, after]).length === 1, 'and one real failure counts exactly once');

  /* Shape errors are never excused by the seasonal argument. */
  ok(gradeCongestion({ status: 200, body: { rows: 'nope' } }, false).verdict === 'fail',
    'a misshapen payload fails even before the cups start');
  ok(gradeCongestion({ status: 500, body: null }, false).verdict === 'fail', 'a 500 fails');
}

/* ── the EFL feed grades itself; we only surface it ──────────────────── */
console.log('\n• freshness: the EFL health verdict is surfaced, not second-guessed');
{
  ok(gradeEfl({ status: 200, body: { ok: true, documents: { clubs: { count: 72 } } } })
    .verdict === 'ok', 'ok:true passes');
  const bad = gradeEfl({ status: 503, body: {
    ok: false, documents: { players: { fieldsMissing: ['points', 'position'] } }
  } });
  ok(bad.verdict === 'fail', 'ok:false fails');
  ok(/points/.test(bad.detail), 'and names the fields that went missing, since that is the repair');
}

/* ── a healthy feed that is quietly mis-scoring ───────────────────────
   The case this pair of tests exists for: every structural check passes,
   the feed answers 200 with ok:true, and it has started sending a position
   label provider.js does not recognise. Those players silently become
   midfielders, and midfielders are the only position paid +2 for an
   interception. A response can be perfectly well-formed and still be
   wrong about the thing the app is for. */
console.log('\n• freshness: an unrecognised position is surfaced without crying wolf');
{
  const healthy = { status: 200, body: { ok: true, documents: {
    clubs: { count: 72 },
    players: { count: 1008, unknownPositions: { count: 0, labels: [] } }
  } } };
  ok(gradeEfl(healthy).verdict === 'ok', 'no unknown positions stays ok');

  const drifted = { status: 200, body: { ok: true, documents: {
    clubs: { count: 72 },
    players: { count: 1008, unknownPositions: {
      count: 37, labels: [{ label: 'ST', n: 30 }, { label: 'AM', n: 7 }]
    } }
  } } };
  const g = gradeEfl(drifted);
  ok(g.verdict === 'note', 'unknown positions is a NOTE, not a failure (' + g.verdict + ')');
  ok(failures([g]).length === 0, 'so it never takes the EFL app down over one odd label');
  ok(/37/.test(g.detail), 'the detail carries how many players are affected');
  ok(/ST/.test(g.why) && /AM/.test(g.why), 'and the why names the labels, since that is the repair');
  ok(/interception/i.test(g.why), 'and says what it costs, rather than just that it happened');

  /* A broken feed is still a failure — the note must not swallow it. */
  ok(gradeEfl({ status: 503, body: { ok: false, documents: {} } }).verdict === 'fail',
    'and a genuinely broken feed still fails');
}

/* ── football-data, newly proven and therefore worth distrusting ─────── */
console.log('\n• freshness: football-data');
{
  ok(gradeFootballData({ status: 200, body: { matches: [{ utcDate: iso(3) }] } }, NOW)
    .verdict === 'ok', 'future matches pass');
  ok(gradeFootballData({ status: 200, body: { matches: [{ utcDate: iso(-3) }] } }, NOW)
    .verdict === 'fail', 'only past matches fails');
  const keyGone = gradeFootballData({ status: 503, body: { error: 'FOOTBALL_DATA_KEY is not visible' } }, NOW);
  ok(keyGone.verdict === 'fail' && /KEY/.test(keyGone.detail),
    'and a lost key is reported with the upstream message, not as a generic 503');
}

/* ── our own published files ─────────────────────────────────────────── */
console.log('\n• freshness: files we publish ourselves');
{
  const spec = { staleDays: 21, why: 'the job stopped' };

  /* The defect this argument exists to prevent. record.json is rebuilt on
     every site deploy, so its generatedAt is always minutes old regardless of
     whether the ledger has moved — watching it reported a check as healthy
     when it was measuring nothing. A caller must be able to name the field
     that tracks the thing, and a missing value must FAIL rather than fall
     back to the one that always looks fresh. */
  const justDeployed = { status: 200, body: {
    generatedAt: iso(-0.01), ledgerUpdatedAt: iso(-40)
  } };
  ok(gradePublished(justDeployed, { ...spec, stampKeys: ['ledgerUpdatedAt'] }, NOW).verdict === 'fail',
    'a freshly-built file whose LEDGER is 40 days stale fails');
  ok(gradePublished(justDeployed, spec, NOW).verdict === 'ok',
    'and watching the build stamp instead would have called it healthy — the bug, pinned');
  ok(gradePublished({ status: 200, body: { generatedAt: iso(-0.01) } },
    { ...spec, stampKeys: ['ledgerUpdatedAt'] }, NOW).verdict === 'fail',
    'a null ledger timestamp fails rather than falling back to the build stamp');
  ok(gradePublished({ status: 200, body: { generatedAt: iso(-2) } }, spec, NOW).verdict === 'ok',
    'two days old is fine');
  ok(gradePublished({ status: 200, body: { generatedAt: iso(-30) } }, spec, NOW).verdict === 'fail',
    'thirty days old fails a 21-day limit');
  ok(gradePublished({ status: 200, body: { built: '2026-08-11' } }, spec, NOW).verdict === 'ok',
    'the "built" key is accepted as well as "generatedAt"');
  ok(gradePublished({ status: 200, body: {} }, spec, NOW).verdict === 'fail',
    'no timestamp at all fails — unknown age is not young');

  /* A future timestamp is a broken clock, and reporting it as "0h old" would
     hide exactly the kind of build fault this check is for. */
  const future = gradePublished({ status: 200, body: { generatedAt: iso(5) } }, spec, NOW);
  ok(future.verdict === 'fail' && /FUTURE/.test(future.detail),
    'a timestamp in the future fails rather than reading as brand new');
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
