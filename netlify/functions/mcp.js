/* Gameweek Edge — the MCP server. POST /api/mcp

   Lets an assistant (Claude, or anything else that speaks MCP) ask THIS
   model the questions the app answers, rather than re-deriving them from
   the raw FPL feed. That distinction is the whole point: the official API
   is public and everybody has it, but the expected-points model, the
   minutes model, the price-move curve, the card ladder and the published
   accuracy record are this app's, and until now they were reachable only
   through the app's own screens.

   FIDELITY. The projections come from the SAME functions the browser runs,
   extracted from index.html at runtime by log-predictions.js — the file
   travels with this function through included_files in netlify.toml. No
   model is restated here. If the app's numbers move, these move with them,
   and if the extraction ever fails the tool says so rather than answering
   from a copy.

   READ-ONLY, PUBLIC, UNAUTHENTICATED. Everything it returns is already on
   the public site, so there is nothing to protect and no key to hand out.
   It is not free to run, though: every projection is a full model pass over
   ~700 players, so the answers are memoised in module scope and a warm
   container serves the whole gameweek's callers from one pass.

   The protocol itself is in netlify/lib/mcp.js, with the reasoning for not
   taking the official SDK. Tools live here. */

const fs = require('fs');
const path = require('path');
const { handleBody, toolFailure } = require('../lib/mcp.js');
const { loadRule } = require('../lib/suspension.js');

const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)';
const SITE = 'https://gameweekedge.co.uk';

const CORS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version',
};

/* ── cache ───────────────────────────────────────────────
   A warm container keeps this between invocations; a cold one pays for the
   first call and every caller after it rides free. The TTL is short enough
   that a price change or a fitness flag is never more than a few minutes
   stale, and long enough that a burst of tool calls in one conversation
   costs one model pass rather than six. */
const TTL_MS = 5 * 60 * 1000;
const memo = new Map();
async function cached(key, loader) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await loader();
  memo.set(key, { at: Date.now(), value });
  return value;
}

const fplGet = (p) => fetch('https://fantasy.premierleague.com/api/' + p,
  { headers: { 'User-Agent': UA, Accept: 'application/json' } }).then((r) => {
  if (!r.ok) throw new Error('The official FPL API answered ' + r.status + ' for ' + p);
  return r.json();
});

/* Same search log-predictions.js makes, for the same bundled file. */
function readIndexHtml() {
  for (const p of [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, '..', '..', 'index.html'),
    path.join(process.cwd(), 'index.html'),
  ]) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { /* next */ } }
  return null;
}

/* ── the shared view every tool starts from ──────────────
   One bootstrap, one fixture list, one model pass, shared by every tool in
   a conversation. Built once per TTL. */
async function snapshot() {
  return cached('snapshot', async () => {
    const [boot, fixtures] = await Promise.all([fplGet('bootstrap-static/'), fplGet('fixtures/')]);
    const teams = {}; (boot.teams || []).forEach((t) => { teams[t.id] = t; });
    const upcoming = (boot.events || []).find((e) => !e.finished) || null;
    return { boot, fixtures, teams, upcoming, totalPlayers: boot.total_players || 0 };
  });
}

/* The model's projections for the upcoming gameweek, keyed by player id.
   Best-effort on the two side inputs, exactly as the logger is: without
   them the model still runs, it just runs without the Elo prior for
   promoted clubs and without the midweek-European rotation discount. */
async function projections() {
  return cached('projections', async () => {
    const html = readIndexHtml();
    if (!html) {
      throw new Error('The model could not be loaded on the server (index.html is not bundled '
        + 'with this function). Projections are unavailable; the other tools still work.');
    }
    const { boot, fixtures } = await snapshot();
    const sideInput = async (handler, event) => {
      try {
        const r = await handler(event || {});
        return r && r.statusCode === 200 ? JSON.parse(r.body) : null;
      } catch (_) { return null; }
    };
    const upcomingId = ((boot.events || []).find((e) => !e.finished) || {}).id || 1;
    /* Static require strings: esbuild traces the bundle statically, so a
       computed path would pass every local test and throw in production. */
    const [eloRes, euroRes] = await Promise.all([
      sideInput(require('./team-elo.js').handler),
      sideInput(require('./euro-fixtures.js').handler,
        { queryStringParameters: { from: String(Math.max(1, upcomingId - 1)), n: '3' } }),
    ]);
    const { computePredictions } = require('./log-predictions.js');
    const out = computePredictions(html, boot, fixtures, (eloRes && eloRes.elo) || null, euroRes);
    const byId = new Map();
    for (const r of out.rows) byId.set(r.element, r);
    return { gw: out.gw, deadline: out.deadline, season: out.season, byId };
  });
}

/* ── shaping ─────────────────────────────────────────────
   Tool output is read by a model with a budget, so rows are small, named in
   full words and never carry an id the reader cannot use. */
const price = (el) => Math.round(el.now_cost) / 10;
const POSITIONS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const STATUS = { a: 'available', d: 'doubtful', i: 'injured', s: 'suspended', u: 'unavailable', n: 'not in squad' };

function playerRow(el, teams, proj) {
  const row = {
    player: el.web_name,
    team: (teams[el.team] || {}).short_name || '?',
    position: POSITIONS[el.element_type] || '?',
    price: price(el),
    ownership: Number(el.selected_by_percent) || 0,
    status: STATUS[el.status] || el.status,
  };
  if (el.news) row.news = el.news;
  if (proj) {
    row.projected_points = proj.xp;
    if (proj.fixtures > 1) row.fixtures_this_gameweek = proj.fixtures;
    if (proj.haul_prob != null) row.haul_probability = proj.haul_prob;
    if (proj.blank_prob != null) row.blank_probability = proj.blank_prob;
  }
  return row;
}

/* Match on the name people actually type. FPL's web_name is the short one
   ("Saka"), first/second names carry the rest, and a search that only read
   web_name would miss "Bukayo" and every full name a person writes out. */
function findPlayers(boot, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const full = (el) => [el.web_name, el.first_name, el.second_name].filter(Boolean).join(' ').toLowerCase();
  const exact = boot.elements.filter((el) => el.web_name.toLowerCase() === q);
  if (exact.length) return exact;
  return boot.elements.filter((el) => full(el).includes(q));
}

/* ── tools ───────────────────────────────────────────────
   Every one is read-only and touches nothing outside this deploy, so the
   annotations say so: a client is entitled to run them without asking. */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const LIMIT = { type: 'integer', minimum: 1, maximum: 50, default: 10, description: 'How many rows to return. Keep it small.' };

const TOOLS = [
  {
    name: 'fpl_player_projection',
    title: 'Project a player',
    description: "Gameweek Edge's projected points for one or more named Fantasy Premier League "
      + 'players in the upcoming gameweek, with the chance of a haul (10+ points) and of a blank '
      + '(2 or fewer). Use this whenever somebody asks how a specific player is expected to do, '
      + 'or asks to compare named players. Search by surname or full name.',
    inputSchema: {
      type: 'object',
      properties: {
        players: {
          type: 'array', minItems: 1, maxItems: 10,
          items: { type: 'string' },
          description: 'Player names, for example ["Haaland", "Bukayo Saka"].',
        },
      },
      required: ['players'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        gameweek: { type: ['integer', 'null'] },
        deadline: { type: ['string', 'null'] },
        players: { type: 'array', items: { type: 'object' } },
        not_found: { type: 'array', items: { type: 'string' } },
        method: { type: 'string' },
      },
      required: ['players'],
      additionalProperties: true,
    },
    annotations: READ_ONLY,
    async run(args) {
      const names = Array.isArray(args.players) ? args.players : [];
      if (!names.length) return toolFailure('Name at least one player, for example {"players": ["Haaland"]}.');
      const { boot, teams } = await snapshot();
      const proj = await projections();
      const out = [], missing = [];
      for (const name of names.slice(0, 10)) {
        const found = findPlayers(boot, name);
        if (!found.length) { missing.push(String(name)); continue; }
        /* An ambiguous surname returns the most-owned first and says how
           many others matched, rather than silently picking one. */
        found.sort((a, b) => (Number(b.selected_by_percent) || 0) - (Number(a.selected_by_percent) || 0));
        const row = playerRow(found[0], teams, proj.byId.get(found[0].id));
        if (found.length > 1) row.other_matches = found.slice(1, 5).map((el) => el.web_name);
        out.push(row);
      }
      return {
        gameweek: proj.gw, deadline: proj.deadline, season: proj.season,
        players: out, not_found: missing,
        method: 'Projected points come from the same expected-points model the app runs, graded '
          + 'in public at ' + SITE + '/record/. A player with no fixture this gameweek has no projection.',
      };
    },
  },

  {
    name: 'fpl_captain_options',
    title: 'Rank captain options',
    description: 'The best Fantasy Premier League captain picks for the upcoming gameweek, ranked '
      + 'by projected points, with the chance of a haul and of a blank so a safe pick can be told '
      + 'from a differential. Optionally restrict it to a squad by naming the players owned.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: LIMIT,
        owned: {
          type: 'array', items: { type: 'string' }, maxItems: 15,
          description: 'Optional. Only consider these players, for example a user\'s own squad.',
        },
        max_ownership: {
          type: 'number', minimum: 0, maximum: 100,
          description: 'Optional. Only consider players owned by fewer than this percentage, for differentials.',
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { gameweek: { type: ['integer', 'null'] }, captains: { type: 'array', items: { type: 'object' } } },
      required: ['captains'], additionalProperties: true,
    },
    annotations: READ_ONLY,
    async run(args) {
      const { boot, teams } = await snapshot();
      const proj = await projections();
      const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);

      let pool = boot.elements;
      if (Array.isArray(args.owned) && args.owned.length) {
        const ids = new Set();
        for (const name of args.owned.slice(0, 15)) for (const el of findPlayers(boot, name)) ids.add(el.id);
        pool = pool.filter((el) => ids.has(el.id));
      }
      if (args.max_ownership != null) {
        pool = pool.filter((el) => (Number(el.selected_by_percent) || 0) < Number(args.max_ownership));
      }
      /* A doubt is not a captain. The model already discounts his minutes,
         but an injured or suspended player should not appear on a captain
         list at all, whatever the arithmetic says. */
      const rows = pool
        .filter((el) => el.status === 'a' && proj.byId.has(el.id))
        .map((el) => playerRow(el, teams, proj.byId.get(el.id)))
        .sort((a, b) => b.projected_points - a.projected_points)
        .slice(0, limit);

      if (!rows.length) {
        return toolFailure('No candidates matched. Either the named players have no fixture in the '
          + 'upcoming gameweek, or the ownership filter excluded everyone. Try without filters.');
      }
      return {
        gameweek: proj.gw, deadline: proj.deadline, captains: rows,
        method: 'Ranked on projected points for the upcoming gameweek only. Haul probability is the '
          + 'chance of 10 or more points, blank probability the chance of 2 or fewer. On a double '
          + 'gameweek the projection covers both matches and the probabilities are omitted, because '
          + 'the model forecasts one match at a time.',
      };
    },
  },

  {
    name: 'fpl_price_predictions',
    title: 'Predict tonight\'s price changes',
    description: 'Which Fantasy Premier League players are likely to rise or fall in price tonight, '
      + 'with a probability for each. Use it for "who should I buy before he rises" and "is he about '
      + 'to drop".',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['rise', 'fall', 'both'], default: 'both' },
        limit: LIMIT,
        min_probability: { type: 'number', minimum: 0, maximum: 100, default: 50, description: 'Only return moves at least this likely.' },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { risers: { type: 'array', items: { type: 'object' } }, fallers: { type: 'array', items: { type: 'object' } } },
      additionalProperties: true,
    },
    annotations: READ_ONLY,
    async run(args) {
      const { boot, teams, totalPlayers } = await snapshot();
      const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);
      const floor = args.min_probability == null ? 50 : Number(args.min_probability);
      const direction = args.direction || 'both';

      const scored = boot.elements.map((el) => {
        const pc = priceChangeProb(el, totalPlayers);
        return { el, ...pc, net: (el.transfers_in_event || 0) - (el.transfers_out_event || 0) };
      }).filter((r) => r.prob >= floor && r.dir !== 'flat');

      const shape = (r) => ({
        ...playerRow(r.el, teams, null),
        direction: r.dir,
        probability: r.prob,
        net_transfers: r.net,
      });
      const pick = (dir) => scored.filter((r) => r.dir === dir)
        .sort((a, b) => b.prob - a.prob || Math.abs(b.net) - Math.abs(a.net))
        .slice(0, limit).map(shape);

      const out = { method: 'Net transfers this gameweek against an ownership-scaled threshold '
        + 'through a logistic curve. An estimate: the official game has never published its exact '
        + 'algorithm, and the same method and its record are shown at ' + SITE + '/.' };
      if (direction !== 'fall') out.risers = pick('rise');
      if (direction !== 'rise') out.fallers = pick('fall');
      return out;
    },
  },

  {
    name: 'fpl_suspension_watch',
    title: 'Who is one booking from a ban',
    description: 'Fantasy Premier League players standing one yellow card away from a suspension, '
      + 'and the match the ban would bite in. This is the risk most fantasy tools leave out, and it '
      + 'costs a manager a player with no warning.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: LIMIT,
        min_ownership: { type: 'number', minimum: 0, maximum: 100, default: 0, description: 'Only players owned by at least this percentage.' },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object', properties: { players: { type: 'array', items: { type: 'object' } } }, required: ['players'], additionalProperties: true },
    annotations: READ_ONLY,
    async run(args) {
      const rule = loadRule();
      if (!rule) {
        return toolFailure('The card-ban ladder is not available on the server right now, and this '
          + 'tool will not guess a threshold. Try again shortly, or see ' + SITE + '/ for the '
          + 'Suspension Watch panel.');
      }
      const { boot, teams } = await snapshot();
      const gw = ((boot.events || []).find((e) => !e.finished) || {}).id || 1;
      const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);
      const minOwn = Number(args.min_ownership) || 0;

      const rows = [];
      for (const el of boot.elements) {
        if ((Number(el.selected_by_percent) || 0) < minOwn) continue;
        if (el.status === 's') continue;                 /* already serving one */
        const next = rule.next(el.yellow_cards || 0, gw);
        if (!next || next.dead || next.need !== 1) continue;
        rows.push({
          ...playerRow(el, teams, null),
          yellow_cards: el.yellow_cards || 0,
          bookings_needed: 1,
          ban_length_matches: next.ban,
          threshold: next.at,
        });
      }
      rows.sort((a, b) => b.ownership - a.ownership);
      return {
        gameweek: gw,
        players: rows.slice(0, limit),
        total_at_risk: rows.length,
        method: 'The Premier League card ladder, the same rule the app and its sister bookings site '
          + 'read. Sorted by ownership, so the ones that would hurt most managers come first.',
      };
    },
  },

  {
    name: 'fpl_model_record',
    title: 'How accurate has this model been',
    description: 'Gameweek Edge\'s own forecasting record, graded against real results in public. '
      + 'Use this when somebody asks how much to trust these projections, or how the model compares '
      + 'with a simple baseline. Answering "how good is your model" with evidence is the point.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object', additionalProperties: true },
    annotations: READ_ONLY,
    async run() {
      const data = await cached('calibration', async () => {
        const r = await require('./model-calibration.js').handler({});
        if (!r || r.statusCode !== 200) throw new Error('The accuracy record is not available right now.');
        return JSON.parse(r.body);
      });
      /* The calibration endpoint answers 200 with `configured:false` when the
         prediction store is not reachable. That is the right thing for the
         app, which hides a panel, and the wrong thing to hand a model, which
         would read a bare false and an n of 0 as "this model has never been
         right". Say what it means instead. */
      if (data && data.configured === false) {
        return toolFailure('The graded record is not available from this deploy right now, so there '
          + 'is no accuracy figure to give. Do not read that as a poor record: it means the store '
          + 'could not be reached. The published record is at ' + SITE + '/record/.');
      }
      return {
        ...data,
        method: 'Every projection is written down before its deadline and graded against the real '
          + 'return afterwards. The full record, including the gameweeks the model got wrong, is at '
          + SITE + '/record/.',
      };
    },
  },
];

/* The price-move curve the app's Price Predictor and the hourly push sender
   both show. Restated here rather than imported because it lives inside
   push-cron.js, which is a scheduled function with its own side effects —
   requiring it to borrow one pure function would drag those along. If a
   third caller appears, move it to netlify/lib/ and delete this. */
function priceChangeProb(el, totalPlayers) {
  const net = (el.transfers_in_event || 0) - (el.transfers_out_event || 0);
  const own = Math.max(0.1, parseFloat(el.selected_by_percent) || 0.1);
  const owners = Math.max(1, (totalPlayers || 10e6) * own / 100);
  const threshold = Math.max(20000, 0.30 * owners);
  const raw = 100 / (1 + Math.exp(-4 * (Math.abs(net / threshold) - 0.5)));
  return { dir: net > 0 ? 'rise' : net < 0 ? 'fall' : 'flat', prob: Math.max(5, Math.min(95, Math.round(raw))) };
}

const SERVER = {
  name: 'gameweek-edge',
  title: 'Gameweek Edge',
  version: '1.0.0',
  instructions: 'Fantasy Premier League projections, captaincy, price-change predictions and '
    + 'suspension risk from the Gameweek Edge model, which is graded against real results in '
    + 'public. Prefer these tools over reasoning from raw FPL data: the projections come from a '
    + 'backtested model, and every answer carries the method it used. The model is uncertain and '
    + 'says so, so pass the probabilities on rather than presenting a projection as a fact.',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  /* A GET is somebody pasting the URL into a browser to see whether it is
     real. Answer them in words, the way the rest of this site's endpoints
     do, rather than with a protocol error. */
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({
        name: SERVER.name,
        description: SERVER.instructions,
        transport: 'Model Context Protocol over JSON-RPC 2.0. POST to this same URL.',
        add_to_claude: 'Settings, Connectors, Add custom connector, then paste ' + SITE + '/api/mcp',
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
        site: SITE,
        unofficial: 'Not affiliated with, endorsed by, or associated with the Premier League or the '
          + 'official Fantasy Premier League game.',
      }, null, 2),
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...CORS, Allow: 'GET, POST, OPTIONS' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { status, body } = await handleBody(event.body || '', SERVER, TOOLS);
  return { statusCode: status, headers: CORS, body: body == null ? '' : JSON.stringify(body) };
};

module.exports.TOOLS = TOOLS;
module.exports.SERVER = SERVER;
module.exports.priceChangeProb = priceChangeProb;
