/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — the ledger's plumbing.

   Fetching the feed, finding the round, and reading and writing the record.
   Everything with a side effect lives here so that scripts/efl/metrics.mjs
   can stay pure and testable.

   ── THE RULE THIS FILE EXISTS TO ENFORCE ───────────────────
   A pick recorded after kick-off is not a prediction, it is a memory. The
   recorder therefore REFUSES to write an entry whose lockout has already
   passed, and refuses to overwrite an entry that exists. Both refusals are
   loud. Between them there is no code path in this repository that can
   produce a back-dated pick, which is the only reason the season table is
   worth reading at all.
   ═══════════════════════════════════════════════════════════ */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/* Overridable only so an end-to-end run can be pointed at a scratch
   directory. The scheduled job never sets it, and a round recorded
   elsewhere is not in the ledger — there is no import path. */
export const LEDGER_DIR = process.env.EFL_LEDGER_DIR || join(ROOT, 'efl', 'data', 'rounds');

/* The site's own proxy, not the upstream, and deliberately so: it is the
   exact path a visitor's browser takes, so the ledger measures the data the
   site actually serves. Overridable for a local run or a direct check. */
export const API_BASE = process.env.EFL_API_BASE || 'https://gameweekedge.co.uk/api/efl';

const DOCUMENTS = ['squads', 'players', 'rounds'];

export async function fetchDocuments(base = API_BASE, fetchImpl = fetch) {
  const out = {};
  for (const name of DOCUMENTS) {
    const res = await fetchImpl(`${base}/${name}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body && (body.error || body.details) ? ` — ${body.error || body.details}` : '';
      } catch (_) { /* not JSON; the status is the whole story */ }
      throw new Error(`${name} answered ${res.status}${detail}`);
    }
    out[name] = await res.json();
  }
  return out;
}

/* ── Rounds ───────────────────────────────────────────────
   The raw rounds document is kept alongside the mapped snapshot because it
   carries two things the snapshot drops and this job needs: the lockout
   time, and the scores. */

export const roundLockout = (round) => Date.parse(round && round.lockoutDate);

const SCORE_FIELDS = [['homeScore', 'awayScore'], ['homeGoals', 'awayGoals'], ['scoreHome', 'scoreAway']];

/** Scores, whichever of the plausible field names the feed actually uses. */
export function gameScore(game) {
  for (const [h, a] of SCORE_FIELDS) {
    if (game && game[h] != null && game[a] != null) {
      const home = Number(game[h]); const away = Number(game[a]);
      if (Number.isFinite(home) && Number.isFinite(away)) return { home, away };
    }
  }
  return null;
}

export const gameKickoff = (game, round) => Date.parse(
  (game && (game.kickoffDate || game.date)) || (round && round.lockoutDate)
);

/**
 * The round to record picks for: the earliest whose lockout is still ahead.
 * Returns null once the season has no open round left, which is a correct
 * answer and not an error.
 */
export function openRound(rounds, now = Date.now()) {
  const open = (rounds || [])
    .filter((r) => r && r.status !== 'completed' && Number.isFinite(roundLockout(r)) && roundLockout(r) > now)
    .sort((a, b) => roundLockout(a) - roundLockout(b));
  return open[0] || null;
}

/**
 * Has this round finished, and can its points be attributed to it alone?
 *
 * The feed publishes a player's SEASON total, not a per-round figure, so a
 * round is graded by the difference between the totals recorded at its
 * lockout and the totals now. That subtraction is only this round's points
 * if no other round has been played in between — so the window closes the
 * moment a later round's first ball is kicked.
 *
 * @returns {{settled:boolean, clean:boolean, lastKickoff:number|null,
 *            nextKickoff:number|null, played:number, total:number}}
 */
export function roundSettlement(rounds, roundNumber, now = Date.now()) {
  const round = (rounds || []).find((r) => Number(r.roundNumber) === Number(roundNumber));
  if (!round) return { settled: false, clean: false, lastKickoff: null, nextKickoff: null, played: 0, total: 0 };

  const games = round.games || [];
  const played = games.filter((g) => gameScore(g) != null).length;
  const kickoffs = games.map((g) => gameKickoff(g, round)).filter(Number.isFinite);
  const lastKickoff = kickoffs.length ? Math.max(...kickoffs) : null;

  /* Two hours after the last kick-off is full time plus stoppages plus the
     wait for the stats to land. A round is not settled the instant the
     whistle goes, and grading it then would report a half-scored week. */
  const finishedByClock = lastKickoff != null && now > lastKickoff + 2 * 60 * 60 * 1000;
  const settled = games.length > 0
    && (round.status === 'completed' || (played === games.length && finishedByClock));

  const laterKickoffs = (rounds || [])
    .filter((r) => Number(r.roundNumber) > Number(roundNumber))
    .flatMap((r) => (r.games || []).map((g) => gameKickoff(g, r)))
    .filter(Number.isFinite);
  const nextKickoff = laterKickoffs.length ? Math.min(...laterKickoffs) : null;

  return {
    settled,
    /* Clean means the subtraction can only contain this round. */
    clean: settled && (nextKickoff == null || now < nextKickoff),
    lastKickoff,
    nextKickoff,
    played,
    total: games.length
  };
}

/** Every club's result in one round, keyed by club id. */
export function clubResults(rounds, roundNumber) {
  const round = (rounds || []).find((r) => Number(r.roundNumber) === Number(roundNumber));
  const out = {};
  for (const game of (round && round.games) || []) {
    const score = gameScore(game);
    if (!score) continue;
    const home = String(game.homeId); const away = String(game.awayId);
    (out[home] = out[home] || []).push({ opponent: away, home: true, goalsFor: score.home, goalsAgainst: score.away });
    (out[away] = out[away] || []).push({ opponent: home, home: false, goalsFor: score.away, goalsAgainst: score.home });
  }
  return out;
}

/* ── Reading the feed's numbers ───────────────────────────
   Field names are the feed's, not ours, and it can rename them without
   telling anyone. Everything below therefore tries a list and reports which
   one it used, so a season graded on `totalPoints` can never be silently
   continued on something else. */

export const POINTS_FIELDS = ['totalPoints', 'points', 'seasonPoints'];

export function pickField(row, candidates) {
  for (const f of candidates) {
    if (row && row[f] != null && Number.isFinite(Number(row[f]))) return f;
  }
  return null;
}

/** The cumulative points column, decided once from the whole document. */
export function pointsFieldFor(rows, candidates = POINTS_FIELDS) {
  const counts = new Map();
  for (const row of (rows || []).slice(0, 200)) {
    const f = pickField(row, candidates);
    if (f) counts.set(f, (counts.get(f) || 0) + 1);
  }
  let best = null;
  for (const [field, n] of counts) if (!best || n > best.n) best = { field, n };
  return best ? best.field : null;
}

export function totalsById(rows, field) {
  const out = {};
  if (!field) return out;
  for (const row of rows || []) {
    const v = Number(row[field]);
    if (row && row.id != null && Number.isFinite(v)) out[String(row.id)] = v;
  }
  return out;
}

/* ── The ledger on disk ───────────────────────────────────
   One file per round. Per-round files rather than one big ledger because
   the diff of a round being recorded should be readable at a glance, and
   because two jobs touching different rounds can never conflict. */

export const roundPath = (round) => join(LEDGER_DIR, `round-${String(round).padStart(2, '0')}.json`);

export async function readRound(round) {
  try {
    return JSON.parse(await readFile(roundPath(round), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function readLedger() {
  let names = [];
  try { names = await readdir(LEDGER_DIR); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  const entries = [];
  for (const name of names.filter((n) => /^round-\d+\.json$/.test(n)).sort()) {
    entries.push(JSON.parse(await readFile(join(LEDGER_DIR, name), 'utf8')));
  }
  return entries.sort((a, b) => a.round - b.round);
}

export async function writeRound(entry) {
  await mkdir(LEDGER_DIR, { recursive: true });
  await writeFile(roundPath(entry.round), `${JSON.stringify(entry, null, 2)}\n`);
  return roundPath(entry.round);
}

/* ── Refusals ─────────────────────────────────────────────
   Stated as functions rather than inline `if`s so the tests can hold the
   rule directly, and so there is exactly one place where the meaning of
   "too late" is defined. */

export const RECORD_WINDOW_HOURS = 36;

/**
 * May picks for this round be written now?
 * @returns {{ok:boolean, reason:string, hoursBeforeLock:number|null}}
 */
export function canRecord({ round, existing, now = Date.now() }) {
  if (!round) return { ok: false, reason: 'no round is open — the season may be over', hoursBeforeLock: null };
  const lock = roundLockout(round);
  if (!Number.isFinite(lock)) {
    return { ok: false, reason: `round ${round.roundNumber} has no readable lockout time`, hoursBeforeLock: null };
  }
  const hours = (lock - now) / 3600000;
  if (existing) {
    return { ok: false, reason: `round ${round.roundNumber} was already recorded at ${existing.recordedAt} — the ledger is append-only`, hoursBeforeLock: hours };
  }
  if (hours <= 0) {
    return { ok: false, reason: `round ${round.roundNumber} locked ${Math.abs(hours).toFixed(1)}h ago — a pick recorded after the deadline is not a prediction`, hoursBeforeLock: hours };
  }
  if (hours > RECORD_WINDOW_HOURS) {
    return { ok: false, reason: `round ${round.roundNumber} locks in ${hours.toFixed(1)}h — too early, team news is still to come`, hoursBeforeLock: hours };
  }
  return { ok: true, reason: `round ${round.roundNumber} locks in ${hours.toFixed(1)}h`, hoursBeforeLock: hours };
}

/** Which recorded rounds are ready to be graded. */
export function gradable(entries, rounds, now = Date.now()) {
  return (entries || [])
    .filter((e) => e && !e.result)
    .map((e) => ({ entry: e, settlement: roundSettlement(rounds, e.round, now) }))
    .filter((r) => r.settlement.settled);
}
