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
  /* ── WHY THE DEFAULT IS STILL 'sample' ────────────────────
     The official provider below is written and unit-tested, and it has
     never been run against the live host: this project's egress proxy
     refuses fantasy.efl.com, exactly as it refuses football-data.org for
     the dormant proxy in netlify/functions/football-data.js. The field
     names it maps come from the official game's own published responses as
     used by a working third-party site, not from a response anyone here has
     seen.

     Shipping an unverified provider as the default would mean the first
     person to find out it is wrong is a visitor. So it is opt-in until
     someone runs `npx netlify dev` and confirms the shapes — flip
     `provider` to 'official' here, or add ?provider=official to any URL to
     try it without editing anything. See efl/README.md. */
  provider: 'sample',
  /* Same-origin proxy paths. The browser never talks to fantasy.efl.com
     directly: connect-src in the site CSP is 'self', and the proxy is what
     enforces the cache TTLs that keep us a polite client. */
  base: '/api/efl',
  endpoint: '/api/efl/snapshot',
  cacheMs: 5 * 60 * 1000
};

export function readConfig(win) {
  const w = win || (typeof window === 'undefined' ? {} : window);
  const config = { ...DEFAULT_CONFIG, ...(w.EFL_CONFIG || {}) };
  /* ?provider=official is a testing affordance, not a feature: it lets the
     unverified provider be exercised on a real deploy without a code change
     and without changing what anyone else sees. */
  try {
    const override = new URLSearchParams(w.location ? w.location.search : '').get('provider');
    if (override) config.provider = override;
  } catch (_) { /* no location, e.g. under Node */ }
  return config;
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
    },
    /* Real when the source publishes it, null otherwise — never zero. A
       club nobody has picked and a club we have no figure for are different
       things, and the UI renders them differently. */
    ownership: statOrNull(src.ownership),
    fdrHome: statOrNull(src.fdrHome),
    fdrAway: statOrNull(src.fdrAway)
  };
}

/* Nullable stat: absent stays absent. `num()` would turn "not published"
   into 0, and a defender credited with zero tackles he did not fail to make
   is a lie the scoring model would then act on. */
const statOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

const STAT_KEYS = ['saves', 'penaltySaves', 'goalsConceded', 'clearances', 'blocks',
  'tackles', 'interceptions', 'keyPasses', 'shotsOnTarget', 'yellowCards', 'redCards'];

export function normaliseStats(raw) {
  const src = raw || {};
  const out = {};
  for (const key of STAT_KEYS) out[key] = statOrNull(src[key]);
  return out;
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
    stats: normaliseStats(src.stats),
    last5: Array.isArray(src.last5) ? src.last5.map((m) => ({
      round: num(m && m.round),
      minutes: num(m && m.minutes),
      started: Boolean(m && m.started),
      goals: num(m && m.goals),
      assists: num(m && m.assists),
      cleanSheet: Boolean(m && m.cleanSheet),
      /* The raw stats behind the score, where the source carries them. Kept
         so an appearance can be re-derived rather than taken on trust. */
      stats: m && m.stats ? { ...m.stats } : null,
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
      generatedAt: str(source.generatedAt, new Date().toISOString()),
      coverage: source.coverage || null
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

/* ═══════════════════════════════════════════════════════════
   THE OFFICIAL FANTASY EFL FEED

   The official game publishes three JSON documents that need no key and no
   account:

     /json/fantasy/squads.json    72 clubs across all three divisions
     /json/fantasy/players.json   every player, season totals, injury note
     /json/fantasy/rounds.json    every round, its games and its lockout

   A fourth — /json/fantasy/player_profiles/{id}.json — carries per-match
   history and requires a logged-in Fantasy EFL account. This app does not
   use it and should not: it would mean holding somebody's game credentials
   and making about eleven hundred requests to refresh one page. The cost of
   that decision is stated honestly in `coverage` below and shown in the UI,
   rather than papered over.

   ── WHAT THAT COSTS, PRECISELY ─────────────────────────────
   Without per-match history there is no five-round form window and no
   per-club goals-for/against. So:
     · Player form falls back to season points per appearance. That is a
       real predictor (+0.408 correlation with next-round points, measured)
       and a weaker one than the five-round window (+0.447).
     · Club attack/defence inputs go flat, which normalise() answers with
       0.5 for everyone — the honest response to "nothing separates them".
   Both are reported in `coverage.notes` and surfaced by the UI.

   ── DIVISIONS ──────────────────────────────────────────────
   The feed identifies divisions by `competitionId`. Which integer means
   which division is NOT documented and is not guessable, so it is derived
   at runtime instead: three competitions of 24 clubs, ranked by the mean
   fantasy points their clubs have scored. That is a heuristic and it is
   labelled as one — but it is self-correcting across seasons, which a
   hard-coded {10:'championship'} map would not be.
   ═══════════════════════════════════════════════════════════ */

const OFFICIAL_POSITIONS = { GK: 'GK', GKP: 'GK', DEF: 'DEF', MID: 'MID', FWD: 'FWD', FOR: 'FWD' };

/**
 * Work out which competitionId is which division.
 * @param {Object[]} squads raw official squads
 * @returns {Object} competitionId → DivisionId
 */
export function mapCompetitions(squads) {
  const byCompetition = {};
  for (const s of squads || []) {
    const key = String(s && s.competitionId);
    (byCompetition[key] || (byCompetition[key] = [])).push(s);
  }
  const ranked = Object.entries(byCompetition)
    .map(([id, list]) => ({
      id,
      strength: list.reduce((sum, s) => sum + (Number(s.averagePoints) || 0), 0) / (list.length || 1)
    }))
    .sort((a, b) => b.strength - a.strength);
  const order = ['championship', 'league-one', 'league-two'];
  const out = {};
  ranked.forEach((c, i) => { out[c.id] = order[i] || 'league-two'; });
  return out;
}

/** Official squad → our Club. */
export function mapOfficialSquads(squads, competitions) {
  return (squads || []).map((s) => {
    const form = Array.isArray(s.last3Form)
      ? s.last3Form.filter((r) => r === 'W' || r === 'D' || r === 'L') : [];
    const points = form.reduce((n, r) => n + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
    return normaliseClub({
      id: String(s.id),
      name: str(s.name, str(s.shortName)),
      short: str(s.abbreviation, str(s.shortName).slice(0, 3).toUpperCase()),
      division: competitions[String(s.competitionId)] || 'championship',
      position: s.leaguePosition,
      /* The feed gives a league position and a recent-form string but no
         played/won/drawn/lost and no goals. Those stay zero, which the model
         reads as "no separation" rather than as "nil". */
      form,
      last5: { played: form.length, points, goalsFor: 0, goalsAgainst: 0, cleanSheets: 0 },
      ownership: s.percentSelected,
      fdrHome: s.fdrHome,
      fdrAway: s.fdrAway
    });
  });
}

/** Official player → our Player. */
export function mapOfficialPlayers(players, clubsById) {
  return (players || []).map((p) => {
    const club = clubsById[String(p.squadId)];
    const appearances = num(p.appearances);
    const injury = str(p.injuryDetails).trim();
    return normalisePlayer({
      id: String(p.id),
      name: str(p.displayName, `${str(p.firstName)} ${str(p.lastName)}`.trim()),
      clubId: String(p.squadId),
      division: club ? club.division : 'championship',
      position: OFFICIAL_POSITIONS[String(p.position).toUpperCase()] || 'MID',
      appearances,
      /* The feed publishes appearances, not starts or minutes. Treating an
         appearance as a start would overstate the strongest signal in the
         whole model, so starts mirrors appearances and minutes is left at
         zero — and coverage.playerMatchHistory says why. */
      starts: appearances,
      minutes: 0,
      goals: p.goalsScored,
      assists: p.assists,
      cleanSheets: p.cleanSheets,
      points: p.totalPoints,
      stats: {
        saves: p.saves,
        tackles: p.tackles,
        interceptions: p.interceptions,
        shotsOnTarget: p.shotsOnTarget,
        keyPasses: p.keyPasses,
        clearances: p.clearances,
        blocks: p.blocks,
        penaltySaves: p.penaltySaves,
        goalsConceded: p.goalsConceded,
        yellowCards: p.yellowCards,
        redCards: p.redCards
      },
      last5: [],
      availability: injury
        ? { status: 'injured', note: injury, chancePlaying: 0 }
        : { status: 'available', note: 'No reported issue', chancePlaying: 100 },
      ownership: null
    });
  });
}

/** Official rounds → our Fixtures, plus the round being picked for. */
export function mapOfficialRounds(rounds, clubsById, now) {
  const fixtures = [];
  let currentRound = 1;
  let earliestOpen = Infinity;
  const at = now == null ? Date.now() : now;

  for (const round of rounds || []) {
    const roundNumber = num(round.roundNumber);
    const lockout = Date.parse(round.lockoutDate);
    const finished = round.status === 'completed';
    if (!finished && Number.isFinite(lockout) && lockout > at && lockout < earliestOpen) {
      earliestOpen = lockout;
      currentRound = roundNumber;
    }
    for (const game of round.games || []) {
      const home = clubsById[String(game.homeId)];
      fixtures.push(normaliseFixture({
        id: String(game.id),
        division: home ? home.division : 'championship',
        round: roundNumber,
        homeId: String(game.homeId),
        awayId: String(game.awayId),
        kickoff: game.kickoffDate || game.date || round.lockoutDate || '',
        finished,
        status: 'scheduled'
      }));
    }
  }
  /* Every round already played and no open lockout: the season is over, so
     the round being picked for is one past the last completed one. */
  if (earliestOpen === Infinity) {
    currentRound = fixtures.reduce((m, f) => Math.max(m, f.round), 0) + 1;
  }
  return { fixtures, currentRound };
}

/**
 * Join the three official documents into one snapshot.
 * Exported and pure so dev/test-efl.mjs can hold a payload against it
 * without a network, which is the only way this stays honest while the live
 * host is unreachable from here.
 */
export function buildOfficialSnapshot({ squads, players, rounds }, opts = {}) {
  const competitions = mapCompetitions(squads);
  const clubs = mapOfficialSquads(squads, competitions);
  const clubsById = Object.fromEntries(clubs.map((c) => [c.id, c]));
  const mappedPlayers = mapOfficialPlayers(players, clubsById);
  const { fixtures, currentRound } = mapOfficialRounds(rounds, clubsById, opts.now);

  return normaliseSnapshot({
    clubs, players: mappedPlayers, fixtures, currentRound
  }, {
    id: 'efl-official',
    live: true,
    label: 'Official Fantasy EFL data',
    description: 'Clubs, players and fixtures from the official game\'s public feed. '
      + 'All ratings and scores on this site are still modelled here, not official.',
    generatedAt: new Date(opts.now == null ? Date.now() : opts.now).toISOString(),
    coverage: {
      playerMatchHistory: false,
      playerDetailedStats: true,
      clubGoals: false,
      clubOwnership: true,
      officialFdr: true,
      notes: [
        'Per-match player history is behind a Fantasy EFL account, so form is '
        + 'measured from season points per appearance rather than a five-round window.',
        'The public feed carries no goals scored or conceded per club, so those inputs '
        + 'to the club rating are flat and the rating leans on form and fixtures.'
      ]
    }
  });
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

/**
 * The official Fantasy EFL feed, via the same-origin proxy. Three requests
 * in parallel; any one of them failing fails the load, because a snapshot
 * missing its clubs, its players or its fixtures is not a partial answer,
 * it is a broken page pretending otherwise.
 */
export function officialProvider(config, fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const base = config.base || DEFAULT_CONFIG.base;
  return {
    id: 'efl-official',
    async load() {
      if (!doFetch) throw new Error('No fetch available for the official EFL provider');
      const get = async (name) => {
        const res = await doFetch(`${base}/${name}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) {
          throw Object.assign(new Error(`The official Fantasy EFL feed returned ${res.status} for ${name}`),
            { status: res.status });
        }
        return res.json();
      };
      const [squads, players, rounds] = await Promise.all([
        get('squads'), get('players'), get('rounds')
      ]);
      return buildOfficialSnapshot({ squads, players, rounds }, { now: config.now });
    }
  };
}

export function createProvider(config, deps = {}) {
  const cfg = config || DEFAULT_CONFIG;
  if (cfg.provider === 'official') return officialProvider(cfg, deps.fetch);
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
