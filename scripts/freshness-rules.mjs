/*
 * Pure grading rules for the data-freshness check.
 *
 * Split from dev/freshness-check.mjs so the judgement can be tested without a
 * network call, the same way scripts/briefing-parse.mjs is split from the
 * checker that uses it. Every function here takes an already-parsed response
 * and decides what it MEANS. None of them fetch.
 *
 * Three verdicts, and the middle one is the reason this file exists:
 *
 *   ok    — answering, shaped right, describes now
 *   note  — a true observation that is not a fault TODAY, and which says
 *           when it would become one
 *   fail  — stale, misshapen, or gone
 *
 * `note` exists because /api/euro-fixtures correctly returns nothing until
 * the cups start. A checker that went red every morning until September
 * would be muted by the time it mattered, and this project already has form:
 * the site check emailed a failure for three days running, and then once more
 * for a single dropped packet, before anyone looked closely. A check is only
 * worth having while its red means something.
 */

export const DAY = 86400000;

/* Every grader returns this shape; the runner only formats it. */
const ok = (detail) => ({ verdict: 'ok', detail });
const note = (detail, why) => ({ verdict: 'note', detail, why });
const fail = (detail, why) => ({ verdict: 'fail', detail, why });

/* ── FPL bootstrap ────────────────────────────────────────────────────
   The test that catches a season rollover, which is the one moment this
   feed goes wrong in a way a route check cannot see: a stale bootstrap
   answers 200 with thousands of players and every deadline in the past. */
export function gradeBootstrap({ status, body }, now) {
  if (status !== 200 || !body) return fail(`HTTP ${status}`, 'the FPL app has no data without this');
  const players = (body.elements || []).length;
  const events = body.events || [];
  if (!players || !events.length) {
    return fail(`${players} players, ${events.length} gameweeks`,
      'shaped wrong — the fields the app reads are missing');
  }
  const next = events
    .filter((e) => Date.parse(e.deadline_time) > now)
    .sort((a, b) => Date.parse(a.deadline_time) - Date.parse(b.deadline_time))[0];
  if (!next) {
    return fail(`${players} players but every one of ${events.length} deadlines is in the past`,
      'this is what a feed stuck on last season looks like, and a route check cannot see it');
  }
  const days = (Date.parse(next.deadline_time) - now) / DAY;
  return ok(`${players} players · next deadline GW${next.id} in ${days.toFixed(1)}d`);
}

/* ── FPL fixtures ─────────────────────────────────────────────────────── */
export function gradeFixtures({ status, body }, now) {
  const list = Array.isArray(body) ? body : [];
  if (status !== 200 || !list.length) {
    return fail(`HTTP ${status}, ${list.length} fixtures`,
      'no fixture list means no difficulty, no chip plan, no projections');
  }
  const ahead = list.filter((f) => !f.finished).length;
  if (!ahead) {
    return fail(`${list.length} fixtures, none unplayed`,
      'a completed season — the same stale-feed signature as the bootstrap');
  }
  return ok(`${list.length} fixtures · ${ahead} still to play`);
}

/* ── Fantasy EFL ──────────────────────────────────────────────────────
   /api/efl/health already checks the three official documents for the
   fields this app reads and 503s when they move. Surfaced, not reinvented. */
export function gradeEfl({ status, body }) {
  const docs = (body && body.documents) || {};
  if (status === 200 && body && body.ok) {
    const counts = Object.entries(docs)
      .map(([n, d]) => `${n} ${d && d.count != null ? d.count : '?'}`).join(' · ');
    return ok(counts || 'answering in the expected shape');
  }
  const missing = Object.entries(docs)
    .filter(([, d]) => d && (d.fieldsMissing || []).length)
    .map(([n, d]) => `${n}: ${d.fieldsMissing.join(',')}`);
  return fail(`HTTP ${status}${missing.length ? ' · missing → ' + missing.join(' | ') : ''}`,
    'the EFL app shows an error rather than wrong numbers, but it shows nothing useful');
}

/* ── the congestion dataset ───────────────────────────────────────────
   The one that would rot in silence: a community GitHub dataset that 404s
   per gameweek until a competition starts. Before the cups begin, empty is
   CORRECT and must not be an alarm — so it is a note, and the note carries
   the date at which silence stops being innocent. */
export function gradeCongestion({ status, body }, cupsStarted = false) {
  const shaped = body && typeof body.season !== 'undefined' && Array.isArray(body.rows);
  if (status !== 200 || !shaped) {
    return fail(`HTTP ${status}, shape ${shaped ? 'ok' : 'wrong'}`,
      'European and cup midweeks vanish from rotation risk without it');
  }
  const rows = body.rows;
  if (!rows.length) {
    return cupsStarted
      ? fail('answering, but 0 rows with the cups under way',
        'the upstream dataset has stopped being updated')
      : note('answering, 0 rows',
        'correct until the cups start — the dataset 404s per gameweek until then. '
        + 'Once European matchdays are under way, zero here means the upstream has stopped');
  }
  const comps = [...new Set(rows.map((r) => r.comp))].join(', ');
  return ok(`${rows.length} extra matches · ${comps}`);
}

/* ── football-data ───────────────────────────────────────────────────── */
export function gradeFootballData({ status, body }, now) {
  const list = (body && body.matches) || [];
  if (status !== 200 || !list.length) {
    return fail(`HTTP ${status}${body && body.error ? ` — ${body.error}` : ''}`,
      'referees and one of two midweek sources. It had never worked in production until '
      + '13 Aug, so a failure here is a regression in something only just proven');
  }
  const ahead = list.filter((m) => Date.parse(m.utcDate) > now).length;
  if (!ahead) return fail(`${list.length} matches, none in the future`, 'stale season data');
  return ok(`${list.length} matches · ${ahead} still to come`);
}

/* ── files we publish ourselves ───────────────────────────────────────
   A scheduled job that quietly stops leaves a page that looks fine and is
   months out of date. Thresholds are loose on purpose: the ledger only moves
   when a round is graded, so a tight limit would cry wolf every off-week. */
export function gradePublished({ status, body }, { staleDays, why }, now) {
  if (status !== 200 || !body) return fail(`HTTP ${status}`, why);
  const stamp = body.generatedAt || body.built;
  const t = Date.parse(stamp);
  if (!stamp || !isFinite(t)) {
    return fail('no generatedAt/built timestamp', 'cannot tell how old it is');
  }
  const age = (now - t) / DAY;
  const shown = age < 1 ? `${Math.round(age * 24)}h old` : `${age.toFixed(1)}d old`;
  /* A timestamp in the future is not freshness, it is a broken clock or a
     bad build, and reporting it as "0h old" would hide that. */
  if (age < -0.5) return fail(`${shown} — dated in the FUTURE`, 'a clock or build problem');
  return age > staleDays ? fail(`${shown} (limit ${staleDays}d)`, why) : ok(shown);
}

/* The exit rule, in one place so it can be asserted: notes never fail a run.
   If this ever starts counting them, the check becomes the thing it was
   built to avoid. */
export function failures(results) {
  return results.filter((r) => r.verdict === 'fail');
}
