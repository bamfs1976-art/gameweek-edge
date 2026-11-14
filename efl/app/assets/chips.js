/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — chip timing.

   Two chips, two different questions.

   MAX CAPTAIN (two a season, one in each half) gives the armband, after
   the round, to whichever of your seven scored most. It is worth most in a
   round where several strong players have big rounds available at once:
   doubles, and strong home fixtures. So a round's Max Captain value here
   is the mean modelled return of the five best captain options in it.

   ONE CLUB (one a season) lifts the two-per-club limit for a round. What
   it buys is the club's third and fourth best players that week, which you
   could not otherwise hold. So a round's One Club value is, for the best
   club in it, the modelled return of those two extra players.

   Both are read off the remaining fixture list with the same fixture
   ratings the ticker shows and the same scoring rates the player finder
   shows. Neither is a forecast: they rank rounds against each other, and
   the page prints them as an index where the best round in view is 100.

   Pure functions; dev/test-efl-chips.mjs runs them in Node.
   ═══════════════════════════════════════════════════════════ */

import { fixtureRun, playingShare, hasPlayedFootball } from './model.js';
import { playerRates, fixtureFactor } from './stats.js';

export const CHIPS = {
  maxCaptain: { name: 'Max Captain', perSeason: 2 },
  oneClub: { name: 'One Club', perSeason: 1 }
};
/* Captain options considered per round, and the playing share a player
   needs to count. */
export const CAPTAIN_POOL = 5;
export const MIN_SHARE = 0.5;
/* How many rounds ahead to read. The fixture list can run to the end of
   the season; the read stops here because ratings that far out lean on
   today's table more than they should. */
export const MAX_WINDOW = 20;

/** The last round in the season and the round the second half starts. */
export function seasonHalves(rounds) {
  const last = (rounds || []).reduce((m, r) => Math.max(m, r.round || 0), 0);
  return { last, secondHalfFrom: Math.floor(last / 2) + 1 };
}

const halfOf = (round, halves) => (round >= halves.secondHalfFrom ? 'second' : 'first');

/**
 * The value of each chip in each round ahead.
 * @returns {{halves:Object, rounds:Array<{round:number, half:'first'|'second',
 *   captain:{value:number, index:number, top:Array, doubles:number},
 *   oneClub:{value:number, index:number, clubId:string|null, players:Array, double:boolean}}>}}
 */
export function chipCalendar(ctx, opts = {}) {
  const halves = seasonHalves(opts.rounds || []);
  const last = halves.last || ctx.currentRound + MAX_WINDOW - 1;
  const n = Math.max(0, Math.min(opts.window || MAX_WINDOW, last - ctx.currentRound + 1));
  if (!n) return { halves, rounds: [] };

  /* Players who would plausibly start, with a scoring rate. */
  const started = hasPlayedFootball(ctx);
  const pool = ctx.players
    .filter((p) => p.availability.status === 'available' || p.availability.status === 'doubtful')
    .map((p) => ({ p, rate: playerRates(p).shrunkPerApp, share: playingShare(ctx, p).value }))
    .filter((x) => !started || x.share >= MIN_SHARE);

  const byClub = new Map();
  for (const x of pool) {
    if (!byClub.has(x.p.clubId)) byClub.set(x.p.clubId, []);
    byClub.get(x.p.clubId).push(x);
  }

  /* Each club's run, once. */
  const runs = new Map(ctx.clubs.map((c) => [c.id, fixtureRun(ctx, c.id, n)]));

  const rounds = [];
  for (let i = 0; i < n; i += 1) {
    const round = ctx.currentRound + i;
    const values = [];
    const clubRounds = [];
    for (const [clubId, list] of byClub) {
      const r = runs.get(clubId)[i];
      if (!r || r.blank) continue;
      const k = r.matches.reduce((s, m) => s + fixtureFactor(m.difficulty), 0);
      const scored = list.map((x) => ({ id: x.p.id, name: x.p.name, clubId, value: x.rate * k, double: r.double }))
        .sort((a, b) => b.value - a.value);
      values.push(...scored.slice(0, CAPTAIN_POOL));
      if (scored.length >= 4) {
        clubRounds.push({ clubId, value: scored[2].value + scored[3].value, players: scored.slice(0, 4), double: r.double });
      }
    }
    values.sort((a, b) => b.value - a.value);
    const top = values.slice(0, CAPTAIN_POOL);
    const captainValue = top.length ? top.reduce((s, v) => s + v.value, 0) / top.length : 0;
    clubRounds.sort((a, b) => b.value - a.value);
    const best = clubRounds[0] || null;
    rounds.push({
      round,
      half: halfOf(round, halves),
      captain: { value: captainValue, top, doubles: top.filter((t) => t.double).length },
      oneClub: best
        ? { value: best.value, clubId: best.clubId, players: best.players, double: best.double }
        : { value: 0, clubId: null, players: [], double: false }
    });
  }

  const maxC = Math.max(...rounds.map((r) => r.captain.value), 0) || 1;
  const maxO = Math.max(...rounds.map((r) => r.oneClub.value), 0) || 1;
  for (const r of rounds) {
    r.captain.index = Math.round((r.captain.value / maxC) * 100);
    r.oneClub.index = Math.round((r.oneClub.value / maxO) * 100);
  }
  return { halves, rounds };
}

/**
 * Where to play what is left, given what has been used.
 * @param {Object} calendar  chipCalendar()
 * @param {{mcFirst?:boolean, mcSecond?:boolean, oneClub?:boolean}} used
 */
export function chipAdvice(calendar, used = {}) {
  const pick = (list, key) => list.slice().sort((a, b) => b[key].value - a[key].value || a.round - b.round)[0] || null;
  const inHalf = (half) => calendar.rounds.filter((r) => r.half === half);
  const out = { maxCaptain: [], oneClub: null };

  for (const half of ['first', 'second']) {
    const isUsed = half === 'first' ? used.mcFirst : used.mcSecond;
    const list = inHalf(half);
    if (isUsed) { out.maxCaptain.push({ half, status: 'used' }); continue; }
    if (!list.length) {
      out.maxCaptain.push({ half, status: half === 'first' && calendar.rounds.length ? 'passed' : 'out-of-view' });
      continue;
    }
    const best = pick(list, 'captain');
    out.maxCaptain.push({ half, status: 'open', round: best, runnerUp: pick(list.filter((r) => r !== best), 'captain') });
  }

  if (used.oneClub) out.oneClub = { status: 'used' };
  else if (!calendar.rounds.length) out.oneClub = { status: 'out-of-view' };
  else {
    const best = pick(calendar.rounds, 'oneClub');
    out.oneClub = { status: 'open', round: best, runnerUp: pick(calendar.rounds.filter((r) => r !== best), 'oneClub') };
  }
  return out;
}

/* ── Storage: which chips the reader has used, per season ─── */

export const chipsKey = (season) => `ge-efl-chips-${season}`;

export function readChipsUsed(storage, season) {
  try {
    const raw = JSON.parse((storage && storage.getItem(chipsKey(season))) || '{}');
    return { mcFirst: raw.mcFirst === true, mcSecond: raw.mcSecond === true, oneClub: raw.oneClub === true };
  } catch (_) { return { mcFirst: false, mcSecond: false, oneClub: false }; }
}

export function writeChipsUsed(storage, season, used) {
  try { storage.setItem(chipsKey(season), JSON.stringify(used)); return true; } catch (_) { return false; }
}
