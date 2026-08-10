/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — the data adapter. THIS IS THE ONLY FILE THAT
   KNOWS WHERE DATA COMES FROM.

   Everything else in this app — every page, every table, every scoring
   function — reads the shapes in types.js and nothing else. Swapping the
   sample dataset for a real Fantasy EFL feed is therefore a change to
   `normaliseSnapshot()` and a config value, not a rewrite of the views.
   That is the whole reason this file exists as a separate layer.

   ── HOW TO POINT THIS AT A REAL FEED ───────────────────────
   1. Publish a Netlify function that returns the normalised shape (or
      anything close to it) at a same-origin path — same pattern as
      `/api/fpl/*` and `/api/ucl/*` in netlify.toml. Same-origin matters
      twice over: the site's CSP only allows `connect-src 'self'`, and any
      upstream API key stays in the function's environment and never
      reaches the browser.
   2. Set the endpoint before this module loads:
          <script>window.EFL_CONFIG = { provider: 'remote',
                                        endpoint: '/api/efl/snapshot' };</script>
   3. Adjust `normaliseSnapshot()` if the upstream field names differ.
      It is deliberately defensive: unknown fields are dropped, missing
      numbers become 0 and missing availability becomes 'available' with an
      empty note. A feed that half-answers should degrade, not throw.

   There is no fallback from remote to sample. If a live provider is
   configured and fails, the page shows an error, because silently
   substituting invented data for a feed that went down is the one failure
   mode this whole design exists to prevent.
   ═══════════════════════════════════════════════════════════ */

import { buildSampleSnapshot } from './sample-data.js';

/** @typedef {import('./types.js')} */

const VALID_STATUSES = new Set(['available', 'doubtful', 'injured', 'suspended', 'unavailable']);
const VALID_POSITIONS = new Set(['GK', 'DEF', 'MID', 'FWD']);
const VALID_DIVISIONS = new Set(['championship', 'league-one', 'league-two']);

export const DEFAULT_CONFIG = {
  provider: 'sample',
  endpoint: '/api/efl/snapshot',
  /* Sample data is generated per page load; there is nothing to cache
     across a session that regenerating does not give back in ~10ms. A real
     provider will want this. */
  cacheMs: 5 * 60 * 1000
};

export function readConfig(win) {
  const w = win || (typeof window === 'undefined' ? {} : window);
  return { ...DEFAULT_CONFIG, ...(w.EFL_CONFIG || {}) };
}

/* ── Normalisation ────────────────────────────────────────
   Every value that reaches the app passes through here. The functions are
   exported so dev/test-efl.mjs can hold a malformed payload against them
   without a browser. */

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const str = (v, fallback = '') => (v == null ? fallback : String(v));

export function normaliseAvailability(raw) {
  const src = raw || {};
  const status = VALID_STATUSES.has(src.status) ? src.status : 'available';
  const chance = src.chancePlaying == null || src.chancePlaying === ''
    ? null : Math.max(0, Math.min(100, num(src.chancePlaying, 0)));
  return { status, note: str(src.note, status === 'available' ? 'No reported issue' : ''), chancePlaying: chance };
}

export function normaliseClub(raw) {
  const src = raw || {};
  const split = (s) => ({
    played: num(s && s.played), won: num(s && s.won), drawn: num(s && s.drawn),
    lost: num(s && s.lost), goalsFor: num(s && s.goalsFor), goalsAgainst: num(s && s.goalsAgainst)
  });
  const last5 = src.last5 || {};
  return {
    id: str(src.id),
    name: str(src.name, str(src.id)),
    short: str(src.short, str(src.name).slice(0, 3).toUpperCase()),
    division: VALID_DIVISIONS.has(src.division) ? src.division : 'championship',
    position: num(src.position),
    played: num(src.played),
    won: num(src.won),
    drawn: num(src.drawn),
    lost: num(src.lost),
    points: num(src.points),
    goalsFor: num(src.goalsFor),
    goalsAgainst: num(src.goalsAgainst),
    cleanSheets: num(src.cleanSheets),
    form: Array.isArray(src.form) ? src.form.filter((r) => r === 'W' || r === 'D' || r === 'L') : [],
    home: split(src.home),
    away: split(src.away),
    last5: {
      played: num(last5.played), points: num(last5.points), goalsFor: num(last5.goalsFor),
      goalsAgainst: num(last5.goalsAgainst), cleanSheets: num(last5.cleanSheets)
    }
  };
}

export function normalisePlayer(raw) {
  const src = raw || {};
  return {
    id: str(src.id),
    name: str(src.name, 'Unknown player'),
    clubId: str(src.clubId),
    division: VALID_DIVISIONS.has(src.division) ? src.division : 'championship',
    position: VALID_POSITIONS.has(src.position) ? src.position : 'MID',
    appearances: num(src.appearances),
    starts: num(src.starts),
    minutes: num(src.minutes),
    goals: num(src.goals),
    assists: num(src.assists),
    cleanSheets: num(src.cleanSheets),
    points: num(src.points),
    last5: Array.isArray(src.last5) ? src.last5.map((m) => ({
      round: num(m && m.round),
      minutes: num(m && m.minutes),
      started: Boolean(m && m.started),
      goals: num(m && m.goals),
      assists: num(m && m.assists),
      cleanSheet: Boolean(m && m.cleanSheet),
      points: num(m && m.points)
    })) : [],
    availability: normaliseAvailability(src.availability),
    /* Absent by default and on purpose. If a provider ever does publish
       ownership, this is the one line that turns the column back on. */
    ownership: src.ownership == null || src.ownership === '' ? null : num(src.ownership)
  };
}

export function normaliseFixture(raw) {
  const src = raw || {};
  return {
    id: str(src.id),
    division: VALID_DIVISIONS.has(src.division) ? src.division : 'championship',
    round: num(src.round),
    homeId: str(src.homeId),
    awayId: str(src.awayId),
    kickoff: str(src.kickoff),
    finished: Boolean(src.finished),
    status: src.status === 'postponed' ? 'postponed' : 'scheduled'
  };
}

/**
 * Turn any provider payload into an EflSnapshot. Throws only when the
 * payload is unusable — an empty club list means every page would render
 * blank, and an error state explains that far better than a blank page does.
 *
 * @param {Object} payload
 * @param {Object} [sourceOverride]
 * @returns {import('./types.js').EflSnapshot}
 */
export function normaliseSnapshot(payload, sourceOverride) {
  const src = payload || {};
  const clubs = (Array.isArray(src.clubs) ? src.clubs : []).map(normaliseClub).filter((c) => c.id);
  const players = (Array.isArray(src.players) ? src.players : []).map(normalisePlayer)
    .filter((p) => p.id && p.clubId);
  const fixtures = (Array.isArray(src.fixtures) ? src.fixtures : []).map(normaliseFixture)
    .filter((f) => f.homeId && f.awayId);
  if (!clubs.length) throw new Error('EFL data contained no clubs');

  const knownClubs = new Set(clubs.map((c) => c.id));
  const source = sourceOverride || src.source || {};
  return {
    source: {
      id: str(source.id, 'unknown'),
      live: Boolean(source.live),
      label: str(source.label, 'Unknown source'),
      description: str(source.description, ''),
      generatedAt: str(source.generatedAt, new Date().toISOString())
    },
    clubs,
    /* Orphans are dropped rather than rendered as "—": a player whose club
       is not in the feed cannot be given a fixture, a rating or a score, and
       a row of dashes in a ranked table reads as a bug in the model. */
    players: players.filter((p) => knownClubs.has(p.clubId)),
    fixtures: fixtures.filter((f) => knownClubs.has(f.homeId) && knownClubs.has(f.awayId)),
    currentRound: num(src.currentRound, 1)
  };
}

/* ── Providers ────────────────────────────────────────── */

/** Generated locally. Never live, and says so in `source`. */
export function sampleProvider(opts = {}) {
  return {
    id: 'sample',
    async load() {
      const snap = buildSampleSnapshot(opts);
      return normaliseSnapshot(snap, snap.source);
    }
  };
}

/**
 * A same-origin JSON endpoint. Not wired to anything yet — no free feed
 * covering all three EFL divisions is configured in this project — but this
 * is the seam a real one plugs into, and it is tested against a fake payload
 * so it cannot rot silently.
 */
export function remoteProvider(config, fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  return {
    id: 'remote',
    async load() {
      if (!doFetch) throw new Error('No fetch available for the remote EFL provider');
      const res = await doFetch(config.endpoint, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        throw Object.assign(new Error(`EFL feed responded ${res.status}`), { status: res.status });
      }
      const payload = await res.json();
      return normaliseSnapshot(payload, payload.source || {
        id: 'remote', live: true, label: 'Live feed',
        description: `Served by ${config.endpoint}.`,
        generatedAt: new Date().toISOString()
      });
    }
  };
}

export function createProvider(config, deps = {}) {
  const cfg = config || DEFAULT_CONFIG;
  if (cfg.provider === 'remote') return remoteProvider(cfg, deps.fetch);
  if (cfg.provider && deps.providers && deps.providers[cfg.provider]) {
    return deps.providers[cfg.provider](cfg);
  }
  return sampleProvider(cfg.sample || {});
}

/* One snapshot per page load, shared by every view on that page. */
let inflight = null;

/**
 * The single entry point every page calls.
 * @returns {Promise<import('./types.js').EflSnapshot>}
 */
export function loadSnapshot(opts = {}) {
  if (inflight && !opts.force) return inflight;
  const cfg = readConfig(opts.window);
  const provider = createProvider(cfg, opts);
  inflight = provider.load().catch((err) => {
    inflight = null;   // a failure must not be cached as the answer
    throw err;
  });
  return inflight;
}

export function resetSnapshotCache() { inflight = null; }
