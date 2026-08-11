/* Euro Matchday Edge — UEFA Champions League Fantasy proxy (Netlify Function).

   Same job as fpl.js, different game and a genuinely different shape. UCL
   Fantasy is not a mirror of the FPL API, so this function does two things
   fpl.js does not:

   1. It NORMALISES. The rest of Euro Matchday Edge — and, more importantly, the
      shared model engine lifted out of Gameweek Edge — expects the FPL
      vocabulary: elements, teams, element_types, events, fixtures. UEFA
      publishes its own field names. Translating once, here, is what lets the
      identical xP and match model run over both competitions instead of
      forking them.

   2. It is honest about not knowing. The upstream feeds could not be reached
      from the machine this was written on, so every field read below goes
      through `pick()`, which tries several plausible names and returns null
      rather than inventing a value. A field that does not resolve leaves its
      property null and the app degrades to what it can still compute — it
      does not silently substitute a zero and quietly poison a projection.

   ── WHAT WAS MEASURED, 11 AUGUST 2026 ─────────────────────────────────
   This function shipped unverified: gaming.uefa.com is refused by the
   sandbox it was written in, so its paths and field names were inferences.
   dev/probe-ucl.mjs finally asked, from a machine with open internet, and
   the answer reshaped this file:

     gaming.uefa.com fantasy feeds     403 — every path, every season, under
                                       a plain client, a client sending the
                                       game's own Referer, and a browser
                                       User-Agent alike.
     gamingapi.uefa.com                does not resolve.
     comp.uefa.com/v2/...              200 to a plain server-side client.
     match.uefa.com/v5/matches         200 — but only in the offset+order
                                       form below; without them it is a 404.

   Two conclusions follow, and both are load-bearing.

   1. THE FANTASY GAME'S OWN FEEDS ARE NOT READABLE FROM A SERVER. A 403
      that does not move under any ordinary header is the host declining,
      and a Netlify function is a datacentre client exactly as a GitHub
      runner is. So this function no longer pretends it might work: player
      prices, fantasy points, ownership and the fantasy availability flag
      are NOT AVAILABLE, `elements` comes back empty, and the reason is
      stated in the payload rather than looking like an outage. Inventing a
      squad list to fill the hole is not on the table.

   2. UEFA'S FOOTBALL DATA IS READABLE, and it is most of what the model
      actually needs: the real clubs, the real calendar, real kickoff times
      and real results, which is what the match model fits on. That is
      where this function now reads from.

   Re-run `node dev/probe-ucl.mjs` (or the "UCL feed probe" workflow) when
   anything here starts returning blanks. It reports what answers and what
   the records contain, which is the difference between a diagnosis and a
   guess. */

const UA = 'Mozilla/5.0 (compatible; EuroMatchdayEdge/1.0; +https://gameweekedge.co.uk/euro/)';

/* Upstream feed templates. `{season}` and `{md}` are substituted per request.
   Kept as data so a path change is a one-line edit, not a code change. */
const FEEDS = {
  base: 'https://gaming.uefa.com/en/uclfantasy/services/feeds',
  players: '/players/players_{season}_{md}.json',
  fixtures: '/fixtures/fixtures_{season}.json',
  teams: '/teams/teams_{season}.json'
};

/* ── The endpoints that actually answer ───────────────────────────────
   Kept as data for the same reason FEEDS is: a path change should be a
   one-line edit. `{cid}`, `{season}`, `{offset}` and `{limit}` substitute.

   The matches URL keeps `offset` and `order` because they are not optional
   — the same query without them returns 404, which is the kind of fact only
   asking can produce. */
const COMPETITION_ID = '1';               /* UEFA Champions League */
const SOURCES = {
  seasons: 'https://comp.uefa.com/v2/competitions/{cid}/seasons?limit=100',
  matches: 'https://match.uefa.com/v5/matches?competitionId={cid}&seasonYear={season}'
    + '&offset={offset}&limit={limit}&order=ASC'
};
const PAGE = 100;        /* the feed served 90 for a 500 request; page anyway */
const MAX_PAGES = 8;     /* a hard stop, so a paging bug cannot walk forever */

const fill = (tpl, vars) => Object.entries(vars)
  .reduce((u, [k, v]) => u.replace(`{${k}}`, encodeURIComponent(String(v))), tpl);

/* ── UEFA's football shapes → the FPL vocabulary ──────────────────────
   Different feed, different shapes, same destination: the shared engine
   reads elements/teams/fixtures and nothing else. */

/* A name in the caller's language, falling back through what UEFA sends. */
const enName = (obj, key) => (obj && obj.translations && obj.translations[key]
  && (obj.translations[key].EN || Object.values(obj.translations[key])[0])) || null;

function normMatchTeam(t) {
  if (!t) return null;
  return {
    id: pick(t, ['id'], 'num'),
    name: enName(t, 'displayName') || pick(t, ['internationalName'], null),
    short_name: pick(t, ['teamCode'], null)
      || (enName(t, 'displayName') || '').slice(0, 3).toUpperCase() || null,
    country: pick(t, ['countryCode'], null),
    /* Placeholders are real records in this feed — "Winner of qualifying
       path B" is a row with a team id. Marked rather than dropped, because
       the fixture is real even when the team is not yet known. */
    placeholder: t.isPlaceHolder === true,
    logo: pick(t, ['logoUrl', 'mediumLogoUrl', 'bigLogoUrl'], null)
  };
}

function normMatch(m) {
  const home = normMatchTeam(m && m.homeTeam);
  const away = normMatchTeam(m && m.awayTeam);
  const score = (m && m.score) || {};
  const total = score.total || score.regular || {};
  /* A score of 0-0 is a real result, so presence is tested rather than
     truthiness — the whole point of pick()'s null discipline. */
  const hs = total.home == null ? null : Number(total.home);
  const as = total.away == null ? null : Number(total.away);
  const md = (m && m.matchday) || {};
  return {
    id: pick(m, ['id'], 'num'),
    /* The engine's "event" is a gameweek number. UEFA's sequenceNumber
       counts matchdays inside a phase, which is the closest true thing. */
    event: pick(md, ['sequenceNumber'], 'num'),
    matchday_name: pick(md, ['name', 'longName'], null),
    phase: pick(m, ['competitionPhase'], null),
    team_h: home ? home.id : null,
    team_a: away ? away.id : null,
    team_h_score: hs,
    team_a_score: as,
    kickoff_time: (m && m.kickOffTime && (m.kickOffTime.dateTime || m.kickOffTime.date)) || null,
    /* UEFA states it, so believe the state rather than inferring it from
       two scores being present — a postponed match can carry neither. */
    finished: String(m && m.status).toUpperCase() === 'FINISHED',
    status: pick(m, ['status'], null)
  };
}

/* Teams come out of the matches, because no team endpoint answered. Every
   club in the competition appears in the calendar, so the calendar IS the
   team list — deduplicated, with placeholders left out of the squad-picking
   universe but kept in the fixtures they appear in. */
function teamsFromMatches(matches) {
  const byId = new Map();
  for (const m of matches || []) {
    for (const t of [normMatchTeam(m.homeTeam), normMatchTeam(m.awayTeam)]) {
      if (t && t.id != null && !t.placeholder && !byId.has(t.id)) byId.set(t.id, t);
    }
  }
  return [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept'
};

/* ── Defensive field access ──────────────────────────────────────────
   Try each candidate name in order; return the first that is present and
   not an empty string. Returns null — never 0, never '' — when nothing
   matches, so "absent" is always distinguishable from "genuinely zero". */
function pick(obj, names, cast) {
  if (!obj) return null;
  for (const n of names) {
    const v = obj[n];
    if (v === undefined || v === null || v === '') continue;
    if (cast === 'num') {
      const x = Number(v);
      if (Number.isFinite(x)) return x;
      continue;
    }
    return v;
  }
  return null;
}

/* UEFA position codes → FPL element_type. The shared engine's scoring,
   optimiser and squad rules are all keyed on 1=GK 2=DEF 3=MID 4=FWD, so this
   is the single most important mapping in the file: get it wrong and every
   projection is wrong in a way that still looks plausible. */
const POS = {
  1: 1, 2: 2, 3: 3, 4: 4,                       /* already FPL-ordered */
  GK: 1, GKP: 1, G: 1, GOALKEEPER: 1,
  DF: 2, DEF: 2, D: 2, DEFENDER: 2,
  MF: 3, MID: 3, M: 3, MIDFIELDER: 3,
  FW: 4, FWD: 4, F: 4, FORWARD: 4, ST: 4
};
function toPos(v) {
  if (v === undefined || v === null || v === '') return null;
  const k = typeof v === 'string' ? v.trim().toUpperCase() : Number(v);
  return POS[k] != null ? POS[k] : null;
}

/* Which upstream keys we understand, per record type. Anything outside this
   is reported back in `_unmapped` so the verification pass has something
   concrete to read rather than a diff of two large JSON blobs. */
const MAP = {
  player: ['id', 'playerId', 'pDId', 'pFName', 'pDName', 'pLName', 'name', 'displayName',
    'skill', 'position', 'pos', 'role',
    'teamId', 'tId', 'currentTeamId', 'clubId',
    'value', 'cost', 'price', 'currentValue',
    'totPoints', 'totalPoints', 'points', 'pts',
    'minsPlayed', 'minutes', 'mins',
    'gsScored', 'goals', 'goalsScored', 'assists', 'assist', 'gAssist',
    'cleanSheet', 'cs', 'saves', 'yellowCard', 'redCard',
    'selPercentage', 'selected', 'ownership',
    'avgPlayerPts', 'form', 'isActive', 'pStatus', 'injury'],
  team: ['id', 'teamId', 'tId', 'name', 'teamName', 'tName', 'shortName', 'tSCode', 'countryCode'],
  fixture: ['id', 'matchId', 'mId', 'matchdayId', 'mdId', 'gameweek', 'round',
    'homeTeamId', 'htId', 'awayTeamId', 'atId', 'homeScore', 'htScore', 'awayScore', 'atScore',
    'kickoff', 'matchDate', 'dateTime', 'status', 'matchStatus', 'played']
};
function unmapped(rows, kind) {
  const known = new Set(MAP[kind] || []);
  const seen = new Set();
  for (const r of (rows || []).slice(0, 40)) {
    for (const k of Object.keys(r || {})) if (!known.has(k)) seen.add(k);
  }
  return [...seen].sort();
}

/* ── Normalisers: UEFA shapes → the FPL vocabulary the engine speaks ── */
function normPlayer(p) {
  const first = pick(p, ['pFName', 'firstName'], null);
  const last = pick(p, ['pLName', 'lastName'], null);
  const display = pick(p, ['pDName', 'displayName', 'name', 'playerName'], null);
  return {
    id: pick(p, ['id', 'playerId', 'pDId'], 'num'),
    web_name: display || [first, last].filter(Boolean).join(' ') || null,
    first_name: first,
    second_name: last,
    element_type: toPos(pick(p, ['skill', 'position', 'pos', 'role'], null)),
    team: pick(p, ['teamId', 'tId', 'currentTeamId', 'clubId'], 'num'),
    /* FPL prices are tenths of a million and the app formats them that way.
       UEFA quotes whole millions, so scale — but only when a value actually
       resolved, so a missing price stays null rather than becoming 0.0. */
    now_cost: (() => {
      const v = pick(p, ['value', 'cost', 'price', 'currentValue'], 'num');
      return v == null ? null : Math.round(v * 10);
    })(),
    total_points: pick(p, ['totPoints', 'totalPoints', 'points', 'pts'], 'num'),
    minutes: pick(p, ['minsPlayed', 'minutes', 'mins'], 'num'),
    goals_scored: pick(p, ['gsScored', 'goals', 'goalsScored'], 'num'),
    assists: pick(p, ['assists', 'assist', 'gAssist'], 'num'),
    clean_sheets: pick(p, ['cleanSheet', 'cs'], 'num'),
    saves: pick(p, ['saves'], 'num'),
    yellow_cards: pick(p, ['yellowCard', 'yellowCards'], 'num'),
    red_cards: pick(p, ['redCard', 'redCards'], 'num'),
    selected_by_percent: pick(p, ['selPercentage', 'selected', 'ownership'], null),
    form: pick(p, ['avgPlayerPts', 'form'], null),
    /* FPL uses status 'a' for available and a chance-of-playing percentage.
       Map what we can; unknown availability must read as available rather
       than as injured, or every player would look doubtful. */
    status: (() => {
      const s = pick(p, ['pStatus', 'status'], null);
      if (s == null) return 'a';
      const t = String(s).toLowerCase();
      if (t === 'i' || t.includes('injur')) return 'i';
      if (t === 's' || t.includes('suspend')) return 's';
      if (t === 'u' || t.includes('unavail')) return 'u';
      return 'a';
    })(),
    chance_of_playing_next_round: null
  };
}

function normTeam(t) {
  return {
    id: pick(t, ['id', 'teamId', 'tId'], 'num'),
    name: pick(t, ['name', 'teamName', 'tName'], null),
    short_name: pick(t, ['shortName', 'tSCode', 'abbreviation'], null),
    country: pick(t, ['countryCode', 'country'], null)
  };
}

function normFixture(f) {
  const hs = pick(f, ['homeScore', 'htScore', 'homeGoals'], 'num');
  const as = pick(f, ['awayScore', 'atScore', 'awayGoals'], 'num');
  return {
    id: pick(f, ['id', 'matchId', 'mId'], 'num'),
    event: pick(f, ['matchdayId', 'mdId', 'gameweek', 'round', 'matchday'], 'num'),
    team_h: pick(f, ['homeTeamId', 'htId', 'homeTeam'], 'num'),
    team_a: pick(f, ['awayTeamId', 'atId', 'awayTeam'], 'num'),
    team_h_score: hs,
    team_a_score: as,
    kickoff_time: pick(f, ['kickoff', 'matchDate', 'dateTime', 'kickoffTime'], null),
    /* A fixture counts as finished only when both scores are present. The
       match model fits on finished fixtures, so a wrong answer here would
       either starve the fit or feed it unplayed games. */
    finished: hs != null && as != null
  };
}

/* Find the array of records inside a feed whose envelope we may not know. */
function rowsOf(json) {
  if (Array.isArray(json)) return json;
  for (const k of ['data', 'value', 'items', 'players', 'teams', 'fixtures', 'matches']) {
    const v = json && json[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      for (const k2 of ['value', 'data', 'playerList', 'items']) {
        if (Array.isArray(v[k2])) return v[k2];
      }
    }
  }
  return [];
}

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
  return r.json();
}

const feed = (tpl, season, md) =>
  FEEDS.base + tpl.replace('{season}', season).replace('{md}', md);

/* Which season is live, according to UEFA rather than according to us.
   The old code hard-coded a guess ("2026"); the seasons feed states it, and
   it states 2026/27 as seasonYear 2027 with status ACTIVE. Cached in module
   scope because a warm function should not re-ask a question whose answer
   changes once a year. */
let seasonCache = null;
async function resolveSeason(override) {
  if (override) return { season: override, source: 'query' };
  if (seasonCache && Date.now() - seasonCache.at < 6 * 3600 * 1000) return seasonCache.value;

  const rows = rowsOf(await getJson(fill(SOURCES.seasons, { cid: COMPETITION_ID })));
  const active = rows.find((r) => String(r.status).toUpperCase() === 'ACTIVE')
    /* If nothing is flagged active — between seasons — take the one whose
       window contains today, and failing that the latest published. */
    || rows.find((r) => Date.parse(r.startDate) <= Date.now() && Date.now() <= Date.parse(r.endDate))
    || rows.slice().sort((a, b) => Number(b.seasonYear) - Number(a.seasonYear))[0];
  if (!active) throw new Error('The seasons feed named no season for this competition.');

  const value = {
    season: String(active.seasonYear),
    name: active.name || null,
    startDate: active.startDate || null,
    endDate: active.endDate || null,
    source: 'comp.uefa.com'
  };
  seasonCache = { at: Date.now(), value };
  return value;
}

/* Every match in the season, paged. The feed caps a page well below the
   size of a Champions League calendar, so asking once and trusting the
   answer would silently lose the back half of the competition. */
async function allMatches(season) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = fill(SOURCES.matches, {
      cid: COMPETITION_ID, season, offset: page * PAGE, limit: PAGE
    });
    const rows = rowsOf(await getJson(url));
    out.push(...rows);
    if (rows.length < PAGE) return { matches: out, pages: page + 1, truncated: false };
  }
  return { matches: out, pages: MAX_PAGES, truncated: true };
}

/* Why `elements` is empty, said once, in the payload. The app renders this
   rather than showing a blank table that looks like a bug. */
const PLAYERS_UNAVAILABLE = {
  available: false,
  reason: 'UEFA\'s Fantasy feeds (gaming.uefa.com) refuse server-side clients — every path '
    + 'returns 403 to a datacentre address regardless of headers, and a serverless function is '
    + 'a datacentre address. Player prices, fantasy points, ownership and fantasy availability '
    + 'are therefore unavailable to this site, and nothing here invents them.',
  affects: ['player prices', 'fantasy points', 'ownership', 'fantasy availability', 'projected points'],
  unaffected: ['clubs', 'fixtures', 'kickoff times', 'results', 'the match model']
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  const sub = (event.path || '')
    .replace(/^\/(\.netlify\/functions\/ucl|api\/ucl)\/?/, '')
    .replace(/\/+$/, '');
  const qs = new URLSearchParams(event.rawQuery || '');
  const override = /^\d{4}$/.test(qs.get('season') || '') ? qs.get('season') : null;

  const json = (status, body, cache) => ({
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json',
      'Cache-Control': cache || 'public, max-age=300, stale-while-revalidate=600' },
    body: JSON.stringify(body)
  });

  try {
    if (sub === 'bootstrap-static' || sub === 'fixtures') {
      const season = await resolveSeason(override);
      const { matches, pages, truncated } = await allMatches(season.season);
      const fixtures = matches.map(normMatch).filter((f) => f.team_h != null && f.team_a != null);
      const teams = teamsFromMatches(matches);

      /* The matchday to show: the earliest with an unfinished fixture. */
      const upcoming = fixtures.filter((f) => !f.finished && f.event != null);
      const matchday = upcoming.length ? Math.min(...upcoming.map((f) => f.event)) : null;

      if (sub === 'fixtures') {
        return json(200, { fixtures, season: season.season,
          _counts: { upstream: matches.length, mapped: fixtures.length, pages, truncated } });
      }

      return json(200, {
        /* Unchanged: the squad rules are the game's, not the feed's, and
           the probe found nothing that contradicts them. */
        game_settings: {
          squad_squadsize: 15, squad_squadplay: 11, squad_team_limit: 3,
          squad_total_spend: 1000, ui_currency_multiplier: 10, transfers_sell_on_fee: 0
        },
        element_types: [
          { id: 1, singular_name_short: 'GKP', squad_select: 2, squad_min_play: 1, squad_max_play: 1 },
          { id: 2, singular_name_short: 'DEF', squad_select: 5, squad_min_play: 3, squad_max_play: 5 },
          { id: 3, singular_name_short: 'MID', squad_select: 5, squad_min_play: 2, squad_max_play: 5 },
          { id: 4, singular_name_short: 'FWD', squad_select: 3, squad_min_play: 1, squad_max_play: 3 }
        ],
        /* Empty, and explicitly so. See PLAYERS_UNAVAILABLE. */
        elements: [],
        players: PLAYERS_UNAVAILABLE,
        teams,
        fixtures,
        events: [],
        season: season.season,
        seasonName: season.name,
        matchday,
        note: `Real clubs, fixtures and results for ${season.name || season.season}. `
          + 'Player-level Fantasy data is not available to this site — see `players.reason`.',
        _counts: {
          matches: matches.length, fixtures: fixtures.length, teams: teams.length,
          pages, truncated, players: 0
        },
        _sources: { season: season.source, matches: 'match.uefa.com/v5' }
      });
    }

    if (sub === 'health') {
      const report = {};
      let ok = true;
      const season = await resolveSeason(override).catch((e) => {
        ok = false; report.seasons = { error: e.message }; return null;
      });
      if (season) report.seasons = { season: season.season, name: season.name };

      if (season) {
        try {
          const rows = rowsOf(await getJson(fill(SOURCES.matches, {
            cid: COMPETITION_ID, season: season.season, offset: 0, limit: 5
          })));
          const mapped = rows.map(normMatch).filter((f) => f.team_h != null);
          report.matches = { upstream: rows.length, mapped: mapped.length, sample: mapped[0] || null };
          if (!mapped.length) ok = false;
        } catch (e) {
          ok = false;
          report.matches = { error: e.message };
        }
      }

      /* The fantasy feed is checked too, and expected to fail. If it ever
         stops failing, that is worth knowing — it would mean player data
         became available and this function should grow it back. */
      try {
        const r = await fetch(feed(FEEDS.players, season ? season.season : '2027', 1),
          { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        report.fantasy = { status: r.status, readable: r.ok };
      } catch (e) {
        report.fantasy = { status: null, readable: false, error: e.message };
      }

      return json(ok ? 200 : 503, {
        ok,
        summary: ok
          ? 'UEFA\'s football data is answering. Fantasy player data remains unavailable by design.'
          : 'A source this app depends on did not answer as expected.',
        players: PLAYERS_UNAVAILABLE,
        documents: report,
        checkedAt: new Date().toISOString()
      }, 'no-store');
    }

    return json(400, { error: 'Endpoint not allowed', endpoint: sub });
  } catch (e) {
    if (e && e.status === 404) {
      return json(200, { elements: [], teams: [], fixtures: [], events: [],
        players: PLAYERS_UNAVAILABLE,
        note: 'No published data for this season yet.' }, 'public, max-age=900');
    }
    return json(502, {
      error: 'Upstream fetch failed',
      details: String(e && e.message ? e.message : e),
      players: PLAYERS_UNAVAILABLE
    }, 'no-store');
  }
};

/* Exposed for dev/test-ucl.mjs. The normalisers are the highest-risk code in
   this app — every downstream number depends on them and the upstream shape
   could not be observed while writing them — so they are unit-tested against
   synthetic payloads in several plausible UEFA shapes. Not part of the
   function's HTTP surface. */
exports._internal = { pick, toPos, rowsOf, normPlayer, normTeam, normFixture, unmapped, POS, FEEDS,
  normMatch, normMatchTeam, teamsFromMatches, enName, fill, SOURCES, PLAYERS_UNAVAILABLE };
