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

   ── VERIFY BEFORE TRUSTING THE NUMBERS ────────────────────────────────
   Run `npx netlify dev` and hit:
       /api/ucl/bootstrap-static
       /api/ucl/fixtures
   Then compare `_unmapped` in the response (a list of upstream keys this
   function did not recognise) against `MAP` below. Anything important
   sitting in `_unmapped` is a field to add. Until that pass is done, treat
   Euro Matchday Edge's projections as unvalidated.

   Sources: UEFA's public gaming feeds. If the host or path is wrong, FEEDS
   below is the only block to edit. */

const UA = 'Mozilla/5.0 (compatible; EuroMatchdayEdge/1.0; +https://euromatchdayedge.co.uk)';

/* Upstream feed templates. `{season}` and `{md}` are substituted per request.
   Kept as data so a path change is a one-line edit, not a code change. */
const FEEDS = {
  base: 'https://gaming.uefa.com/en/uclfantasy/services/feeds',
  players: '/players/players_{season}_{md}.json',
  fixtures: '/fixtures/fixtures_{season}.json',
  teams: '/teams/teams_{season}.json'
};

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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  const sub = (event.path || '')
    .replace(/^\/(\.netlify\/functions\/ucl|api\/ucl)\/?/, '')
    .replace(/\/+$/, '');
  const qs = new URLSearchParams(event.rawQuery || '');
  /* UEFA numbers its seasons; the caller may pin one, otherwise use the
     current default. Both are validated so neither can be used to reach a
     path outside the feeds above. */
  const season = /^\d{1,4}$/.test(qs.get('season') || '') ? qs.get('season') : '2026';
  const md = /^\d{1,2}$/.test(qs.get('md') || '') ? qs.get('md') : '1';

  const json = (status, body, cache) => ({
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json',
      'Cache-Control': cache || 'public, max-age=300, stale-while-revalidate=600' },
    body: JSON.stringify(body)
  });

  try {
    if (sub === 'bootstrap-static') {
      const [praw, traw] = await Promise.all([
        getJson(feed(FEEDS.players, season, md)),
        getJson(feed(FEEDS.teams, season, md)).catch(() => null)
      ]);
      const prows = rowsOf(praw), trows = traw ? rowsOf(traw) : [];
      const elements = prows.map(normPlayer).filter((e) => e.id != null && e.element_type != null);
      const teams = trows.map(normTeam).filter((t) => t.id != null);

      return json(200, {
        /* The engine reads squad rules from this block exactly as it does for
           FPL. UCL Fantasy is 15 players, 100.0m, max 3 per club — declared
           here so the app never hard-codes a second rulebook. */
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
        elements,
        teams,
        events: [],
        season,
        matchday: Number(md),
        /* Verification aids — see the header. */
        _counts: { players: prows.length, mapped: elements.length, teams: teams.length },
        _unmapped: { player: unmapped(prows, 'player'), team: unmapped(trows, 'team') }
      });
    }

    if (sub === 'fixtures') {
      const raw = await getJson(feed(FEEDS.fixtures, season, md));
      const rows = rowsOf(raw);
      const fixtures = rows.map(normFixture).filter((f) => f.team_h != null && f.team_a != null);
      return json(200, { fixtures, season,
        _counts: { upstream: rows.length, mapped: fixtures.length },
        _unmapped: { fixture: unmapped(rows, 'fixture') } });
    }

    if (sub === 'health') {
      /* A single call that says whether the mapping is working, for the
         verification pass described at the top of this file. */
      const raw = await getJson(feed(FEEDS.players, season, md));
      const rows = rowsOf(raw);
      const mapped = rows.map(normPlayer).filter((e) => e.id != null && e.element_type != null);
      return json(200, {
        ok: mapped.length > 0,
        upstream: rows.length,
        mapped: mapped.length,
        unmappedKeys: unmapped(rows, 'player'),
        sampleUpstream: rows[0] || null,
        sampleMapped: mapped[0] || null
      }, 'no-store');
    }

    return json(400, { error: 'Endpoint not allowed', endpoint: sub });
  } catch (e) {
    /* A 404 upstream before a competition starts is not an error — it is the
       correct answer in July. Say so rather than looking broken. */
    if (e && e.status === 404) {
      return json(200, { elements: [], teams: [], fixtures: [], events: [], season,
        note: 'No published feed for this season/matchday yet.' }, 'public, max-age=900');
    }
    return json(502, { error: 'Upstream fetch failed' }, 'no-store');
  }
};

/* Exposed for dev/test-ucl.mjs. The normalisers are the highest-risk code in
   this app — every downstream number depends on them and the upstream shape
   could not be observed while writing them — so they are unit-tested against
   synthetic payloads in several plausible UEFA shapes. Not part of the
   function's HTTP surface. */
exports._internal = { pick, toPos, rowsOf, normPlayer, normTeam, normFixture, unmapped, POS, FEEDS };
