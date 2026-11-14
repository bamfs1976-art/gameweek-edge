/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — the availability hub's logic.

   One flag per player, merged from three layers, most trusted first:

     1. MANUAL   team news typed into efl/app/data/availability.json from
                 the admin page. Wins while it is active, because it is the
                 only layer a person has read a press conference for.
     2. FEED     the official game's own injury details, already mapped to
                 player.availability by provider.js.
     3. COMPUTED rotation risk, worked out from a player's share of his
                 club's football. Shown as modelled, every time.

   ── THE FILE IS THE CONTRACT, NOT THE ADMIN PAGE ────────────
   normaliseManualDoc() is the only reader of the manual document. An
   automated feed that returns the same shape (see AVAILABILITY_SCHEMA in
   types.js) replaces the hand-kept file by changing one URL in
   provider.js, and nothing on any page has to know.

   ── WHAT A MANUAL FLAG DOES TO THE MODEL ────────────────────
   Out, doubt and suspended rewrite player.availability.status, so the
   multipliers the model already applies (model.js) take effect: a player
   your own hub calls Out cannot be the model's pick on the same page.
   Rotation risk is a label only. The model already reads starts share,
   and counting it twice would mark the same player down for the same
   reason two times. "Fit" clears a feed injury the club has moved past.

   Everything here is pure: no DOM, no fetch, no clock unless one is
   passed. dev/test-efl-availability.mjs holds it to that.
   ═══════════════════════════════════════════════════════════ */

import { playingShare, hasPlayedFootball } from './model.js';

export const SCHEMA_VERSION = 1;

/** Statuses a manual entry may carry. */
export const MANUAL_STATUSES = ['out', 'doubt', 'suspended', 'rotation', 'fit'];

export const FLAG_LABELS = {
  out: 'Out',
  doubt: 'Doubt',
  suspended: 'Suspended',
  rotation: 'Rotation risk',
  fit: 'Cleared to play'
};

/** Most serious first. `fit` ranks below everything: it is good news. */
export const FLAG_RANK = { out: 4, suspended: 3, doubt: 2, rotation: 1, fit: 0 };

export const ORIGIN_LABELS = {
  manual: 'Team news',
  feed: 'Official game feed',
  computed: 'Modelled'
};

/** A manual flag older than this reads "may be out of date". */
export const STALE_HOURS = 72;
/** One line on a phone. */
export const NOTE_MAX = 90;
export const SOURCE_MAX = 140;
/** An entry saved without an expiry round lasts this long, then lapses. */
export const UNDATED_DAYS = 7;

/* Manual status → the model's status. Rotation is absent on purpose. */
const MANUAL_TO_STATUS = { out: 'injured', doubt: 'doubtful', suspended: 'suspended', fit: 'available' };
/* The model's status → a flag. */
const STATUS_TO_FLAG = { injured: 'out', unavailable: 'out', doubtful: 'doubt', suspended: 'suspended' };

/* Modelled rotation: a player who starts between these shares of his club's
   football. Below the floor he is a squad player, not a rotation risk; the
   same 0.35 gate roundPicks() uses. At or above the ceiling he is nailed;
   the same 0.70 the Max Captain read uses. */
export const ROTATION_SHARE = { min: 0.35, max: 0.7 };
/* And only for players worth picking: top quarter of his position, inside
   his own division, on points per appearance. Without this the hub would
   flag a fifth of the game and say nothing. */
export const ROTATION_TOP_SHARE = 0.25;
export const ROTATION_MIN_APPS = 3;

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/* ── Reading the manual document ─────────────────────────── */

const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const intOrNull = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 100 ? n : null;
};
const isoOrNull = (v) => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/**
 * One entry, validated. Returns null for anything that cannot be trusted:
 * no player, an unknown status or no timestamp. A flag nobody can date is
 * not a flag anyone should act on.
 */
export function normaliseEntry(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const playerId = text(src.playerId == null ? '' : String(src.playerId), 40);
  const status = MANUAL_STATUSES.includes(src.status) ? src.status : null;
  const checkedAt = isoOrNull(src.checkedAt);
  if (!playerId || !status || !checkedAt) return null;
  return {
    playerId,
    playerName: text(src.playerName, 80),
    clubId: text(src.clubId == null ? '' : String(src.clubId), 60),
    status,
    note: text(src.note, NOTE_MAX),
    returnRound: intOrNull(src.returnRound),
    expiresAfterRound: intOrNull(src.expiresAfterRound),
    checkedAt,
    sourceRef: text(src.sourceRef, SOURCE_MAX)
  };
}

/**
 * The whole document. Never throws: a broken file costs the manual layer,
 * never the page. Duplicate players keep the most recently checked entry.
 */
export function normaliseManualDoc(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(src.entries) ? src.entries : [];
  const byPlayer = new Map();
  let rejected = 0;
  for (const item of list) {
    const e = normaliseEntry(item);
    if (!e) { rejected += 1; continue; }
    const prev = byPlayer.get(e.playerId);
    if (!prev || prev.checkedAt < e.checkedAt) byPlayer.set(e.playerId, e);
    else rejected += 1;
  }
  const source = src.source && typeof src.source === 'object' ? src.source : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    source: {
      kind: text(source.kind, 20) || 'manual',
      updatedAt: isoOrNull(source.updatedAt)
    },
    entries: [...byPlayer.values()].sort((a, b) => a.playerId.localeCompare(b.playerId, 'en', { numeric: true })),
    rejected
  };
}

/** Serialise for the admin page's download. Stable key order, two spaces. */
export function serialiseManualDoc(doc, now) {
  const clean = normaliseManualDoc(doc);
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    source: { kind: clean.source.kind, updatedAt: new Date(now == null ? Date.now() : now).toISOString() },
    entries: clean.entries
  }, null, 2) + '\n';
}

/**
 * Is a manual entry still in force?
 * With an expiry round it lasts up to and including that round. Without
 * one it lasts UNDATED_DAYS from when it was checked.
 */
export function isActive(entry, currentRound, now) {
  if (!entry) return false;
  if (entry.expiresAfterRound != null) return (currentRound || 1) <= entry.expiresAfterRound;
  const at = now == null ? Date.now() : now;
  return at - Date.parse(entry.checkedAt) <= UNDATED_DAYS * DAY;
}

/* ── Applying it to a snapshot ───────────────────────────── */

/**
 * Lay the manual document over a snapshot. Returns a NEW snapshot; players
 * without an active entry are passed through untouched.
 *
 * @returns {{snapshot:Object, meta:{loaded:boolean, updatedAt:string|null,
 *   active:number, expired:number, unmatched:number, rejected:number}}}
 */
export function applyManualAvailability(snapshot, doc, opts = {}) {
  const now = opts.now == null ? Date.now() : opts.now;
  const clean = normaliseManualDoc(doc);
  const round = snapshot.currentRound || 1;
  const ids = new Set(snapshot.players.map((p) => p.id));
  const active = new Map();
  let expired = 0; let unmatched = 0;
  for (const e of clean.entries) {
    if (!ids.has(e.playerId)) { unmatched += 1; continue; }
    if (!isActive(e, round, now)) { expired += 1; continue; }
    active.set(e.playerId, e);
  }

  const players = snapshot.players.map((p) => {
    const e = active.get(p.id);
    if (!e) return p;
    const prev = p.availability || { status: 'available', note: '', chancePlaying: null };
    const mapped = MANUAL_TO_STATUS[e.status];
    const status = mapped || prev.status;
    const changed = status !== prev.status || e.status === 'fit';
    const chancePlaying = e.status === 'out' || e.status === 'suspended' ? 0
      : e.status === 'fit' ? 100
        : e.status === 'doubt' ? (prev.status === 'doubtful' ? prev.chancePlaying : null)
          : prev.chancePlaying;
    return {
      ...p,
      availability: {
        status,
        note: changed ? (e.note || prev.note) : prev.note,
        chancePlaying,
        manual: e,
        feedStatus: prev.status,
        feedNote: prev.note
      }
    };
  });

  return {
    snapshot: { ...snapshot, players },
    meta: {
      loaded: true,
      updatedAt: clean.source.updatedAt,
      active: active.size,
      expired,
      unmatched,
      rejected: clean.rejected
    }
  };
}

/* ── One flag per player ─────────────────────────────────── */

/**
 * The points-per-appearance bar for "worth picking", per division and
 * position. Normalised within division, like everything else in the model.
 */
export function rotationCuts(players) {
  const groups = {};
  for (const p of players) {
    if (p.appearances < ROTATION_MIN_APPS) continue;
    const k = p.division + '|' + p.position;
    (groups[k] || (groups[k] = [])).push(p.points / p.appearances);
  }
  const cuts = {};
  for (const [k, list] of Object.entries(groups)) {
    list.sort((a, b) => b - a);
    cuts[k] = list[Math.min(list.length - 1, Math.floor(list.length * ROTATION_TOP_SHARE))];
  }
  return cuts;
}

/** The modelled rotation flag, or null. */
export function rotationFlag(ctx, player, cuts) {
  if (!hasPlayedFootball(ctx)) return null;
  if (player.appearances < ROTATION_MIN_APPS) return null;
  const cut = cuts[player.division + '|' + player.position];
  if (cut == null || player.points / player.appearances < cut) return null;
  const share = playingShare(ctx, player);
  if (share.value < ROTATION_SHARE.min || share.value >= ROTATION_SHARE.max) return null;
  const played = ctx.playedByClub ? ctx.playedByClub[player.clubId] : null;
  /* The official feed counts appearances, not starts, so the sentence says
     which one it measured. */
  const what = share.hasMinutes ? 'Started' : 'Appeared in';
  const of = played ? `${player.starts} of ${played} league matches` : `${Math.round(share.value * 100)}% of matches`;
  return `${what} ${of}, so not a certain starter`;
}

/**
 * Every player's flag, as a Map of id → flag. Players with nothing to say
 * are absent from the map.
 *
 * @param {Object} ctx       buildContext() output
 * @param {Object} [opts]
 * @param {number} [opts.now]
 * @param {string} [opts.feedCheckedAt]  when the feed was read, ISO
 */
export function buildFlags(ctx, opts = {}) {
  const now = opts.now == null ? Date.now() : opts.now;
  const feedAt = isoOrNull(opts.feedCheckedAt) || new Date(now).toISOString();
  const cuts = rotationCuts(ctx.players);
  const flags = new Map();
  for (const p of ctx.players) {
    const f = flagFor(ctx, p, { now, feedAt, cuts });
    if (f) flags.set(p.id, f);
  }
  return flags;
}

function flagFor(ctx, p, { now, feedAt, cuts }) {
  const a = p.availability || { status: 'available' };
  const stale = (iso) => now - Date.parse(iso) > STALE_HOURS * HOUR;

  if (a.manual) {
    const e = a.manual;
    return {
      playerId: p.id,
      status: e.status,
      note: e.note || (e.status === 'rotation' ? '' : a.feedNote || ''),
      checkedAt: e.checkedAt,
      origin: 'manual',
      returnRound: e.returnRound,
      expiresAfterRound: e.expiresAfterRound,
      sourceRef: e.sourceRef,
      chancePlaying: a.chancePlaying,
      stale: stale(e.checkedAt)
    };
  }
  const fromFeed = STATUS_TO_FLAG[a.status];
  if (fromFeed) {
    return {
      playerId: p.id,
      status: fromFeed,
      note: a.note || '',
      checkedAt: feedAt,
      origin: 'feed',
      returnRound: null,
      expiresAfterRound: null,
      sourceRef: '',
      chancePlaying: a.chancePlaying == null ? null : a.chancePlaying,
      stale: false
    };
  }
  const rotation = rotationFlag(ctx, p, cuts);
  if (rotation) {
    return {
      playerId: p.id,
      status: 'rotation',
      note: rotation,
      checkedAt: feedAt,
      origin: 'computed',
      returnRound: null,
      expiresAfterRound: null,
      sourceRef: '',
      chancePlaying: null,
      stale: false
    };
  }
  return null;
}

/** A flag that means "think before picking him". `fit` is not one. */
export const isWarning = (flag) => Boolean(flag && flag.status !== 'fit');

/**
 * The flagged players in a saved seven, most serious first.
 * @returns {{player:Object, flag:Object}[]}
 */
export function squadWarnings(ctx, ids, flags) {
  const byId = new Map(ctx.players.map((p) => [p.id, p]));
  const out = [];
  for (const id of ids || []) {
    const player = byId.get(id);
    const flag = flags.get(id);
    if (player && isWarning(flag)) out.push({ player, flag });
  }
  return out.sort((a, b) => FLAG_RANK[b.flag.status] - FLAG_RANK[a.flag.status]
    || a.player.name.localeCompare(b.player.name));
}

/* ── Words ───────────────────────────────────────────────── */

/** "3 hours ago", in plain English. */
export function ago(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'at an unknown time';
  const diff = Math.max(0, (now == null ? Date.now() : now) - t);
  const mins = Math.round(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** One sentence for a flag, for a warning list or a screen reader. */
export function flagSentence(player, flag, now) {
  const parts = [`${player.name}: ${FLAG_LABELS[flag.status].toLowerCase()}`];
  if (flag.note) parts[0] += ` (${flag.note})`;
  if (flag.returnRound) parts.push(`expected back for round ${flag.returnRound}`);
  parts.push(`checked ${ago(flag.checkedAt, now)}`);
  return parts.join(', ') + '.';
}
