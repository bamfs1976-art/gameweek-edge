/*
 * Fit DECAY_BASE — the per-gameweek discount solvePlanMulti applies to future
 * expected points — against real seasons instead of borrowing a number.
 *
 * DECAY_BASE arrived from the public open-fpl-solver's `decay_base: 0.9`. That
 * is a reasonable prior but it is somebody else's default, fitted (if at all)
 * against a different projection model. This measures it on ours.
 *
 * METHOD — rolling-horizon simulation, paired across decay values.
 *
 *   For each season, and each of several starting squads:
 *     for gw = 1..38:
 *       build projections for gw..gw+H-1 from data STRICTLY BEFORE gw
 *       run the app's own solvePlanMulti at this decay
 *       apply only the gw action (transfers, bank, free transfers, hits)
 *       pick the XI by projection, score it on ACTUAL points, auto-sub
 *   total realised points over the season = the score for that decay
 *
 * The decay values see identical seasons, identical starting squads and
 * identical projections, so the comparison is PAIRED: the only thing that
 * differs is the discount. Paired differences cancel most of the variance
 * that would otherwise swamp a one-season sample.
 *
 * NO LOOKAHEAD. Projections use only finished gameweeks before the deadline
 * being solved: rolling minutes, shrunk points per 90, and team attack and
 * defence strengths accumulated from prior results. vaastav's own `xP` column
 * is never read — its README warns it is filled in post-match.
 *
 * Usage:
 *   node dev/fetch-vaastav.mjs 2023-24        # once per season, writes gitignored CSV
 *   node dev/fit-decay.mjs                    # all seasons found, default grid
 *   node dev/fit-decay.mjs --seeds 8 --horizon 5
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const SEEDS = parseInt(arg('seeds', '6'), 10);
const HORIZON = parseInt(arg('horizon', '4'), 10);
const GRID = (arg('grid', '0.5,0.6,0.7,0.8,0.85,0.9,0.95,1.0')).split(',').map(Number);

/* ── the app's real solver, on a projection we control ──────────────────── */
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
function extractBlock(src, startIdx) {
  let i = src.indexOf('{', startIdx), depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j], d = src[j + 1];
    if (c === '/' && d === '/') { while (j < src.length && src[j] !== '\n') j++; continue; }
    if (c === '/' && d === '*') { j += 2; while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) j++; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { const q = c; j++; while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; j++; } continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced');
}
const grabFn = (n) => extractBlock(html, html.indexOf('function ' + n + '('));
const grabConst = (n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); };

/* DECAY_BASE is a const in the app; the sweep needs it writable, so it is
   redeclared as a let and driven by a setter. Everything else — the beam, the
   free-transfer ladder, the bench discount, bestXI — is the shipped code. */
const API = new Function(
  grabConst('FT_CAP') + '\n' + grabConst('BENCH_W') + '\n' + grabConst('FT_LADDER') + '\n' +
  grabConst('RULES_FALLBACK') + '\nlet RULES=RULES_FALLBACK;\n' +
  grabFn('fplRules') + '\n' + grabFn('minClubsForXi') + '\n' +
  grabFn('bestXI') + '\n' + grabFn('ftValue') + '\n' + grabFn('benchValue') + '\n' +
  'let DECAY_BASE=0.9;\n' +
  /* The projection is injected: fx carries the number this harness computed. */
  'const fixtureXP=(b,el,fx)=>fx.xp;\n' +
  grabFn('solvePlanMulti') +
  '\nreturn {solvePlanMulti,bestXI,setDecay:(v)=>{DECAY_BASE=v;},getDecay:()=>DECAY_BASE};'
)();

/* ── CSV ────────────────────────────────────────────────────────────────── */
function parseCsv(text) {
  const rows = []; let i = 0, field = '', row = [], q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
    i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length)
    .map((r) => Object.fromEntries(head.map((h, k) => [h, r[k]])));
}
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const POS = { GK: 1, GKP: 1, DEF: 2, MID: 3, FWD: 4 };

/* ── deterministic RNG, so a run is reproducible ────────────────────────── */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* ── one season, loaded into the shape the simulation wants ─────────────── */
/* TEAM IDENTITY. merged_gw's `team` column is a NAME in recent seasons
   ("Sunderland") and absent entirely before 2020-21, while `opponent_team` is
   always a numeric FPL id. Keying team strength by one and looking it up by
   the other silently yields no match — which is exactly the bug that made the
   first version of this harness produce a projection with no fixture
   variation at all, and therefore nothing for the discount to act on.

   Both sides are now resolved to the same numeric id, derived from the data
   itself: within a fixture, the home rows' opponent_team IS the away side's
   id and vice versa, so pairing the two halves recovers every team id without
   needing a lookup table or a per-season special case. */
function teamIdsByFixture(rows) {
  const home = new Map(), away = new Map();
  for (const r of rows) {
    const f = r.fixture;
    if (!f) continue;
    if (String(r.was_home).toLowerCase() === 'true') away.set(f, num(r.opponent_team));
    else home.set(f, num(r.opponent_team));
  }
  return { home, away };
}

function loadSeason(path, rawPath) {
  const rows = parseCsv(readFileSync(path, 'utf8'));
  /* Pre-2020-21 merged_gw carries no position; players_raw does. */
  const raw = rawPath && existsSync(rawPath) ? parseCsv(readFileSync(rawPath, 'utf8')) : [];
  const rawPos = new Map(raw.map((r) => [num(r.id), num(r.element_type)]));

  const { home, away } = teamIdsByFixture(rows);
  const byGw = new Map();          /* gw -> element -> [row, ...] (2 rows in a double) */
  const meta = new Map();          /* element -> {name, element_type, team: numeric id} */
  let maxGw = 0, unresolved = 0;
  for (const r of rows) {
    const gw = num(r.GW), el = num(r.element);
    if (!gw || !el) continue;
    const type = POS[(r.position || '').toUpperCase()] || rawPos.get(el);
    if (!type) continue;
    const isHome = String(r.was_home).toLowerCase() === 'true';
    const tid = isHome ? home.get(r.fixture) : away.get(r.fixture);
    if (!tid) { unresolved++; continue; }
    r._team = tid;                 /* canonical, same space as opponent_team */
    maxGw = Math.max(maxGw, gw);
    if (!meta.has(el)) meta.set(el, { id: el, web_name: r.name, element_type: type, team: tid });
    if (!byGw.has(gw)) byGw.set(gw, new Map());
    const m = byGw.get(gw);
    if (!m.has(el)) m.set(el, []);
    m.get(el).push(r);
  }
  return { byGw, meta, maxGw, unresolved };
}

/* ── point-in-time state: everything known BEFORE gameweek `gw` ─────────── */
/* Rebuilt incrementally as the season advances, so no future row can leak in. */
function newState() {
  return { mins: new Map(), pts: new Map(), apps: new Map(),
    gf: new Map(), ga: new Map(), games: new Map(), matches: 0, goals: 0 };
}
function absorbGw(st, gwRows) {
  const seen = new Set();
  for (const [el, rs] of gwRows) {
    for (const r of rs) {
      const m = num(r.minutes);
      st.mins.set(el, (st.mins.get(el) || []).concat([m]));
      st.pts.set(el, (st.pts.get(el) || 0) + num(r.total_points));
      if (m > 0) st.apps.set(el, (st.apps.get(el) || 0) + 1);
      /* Team goals for/against, counted once per team-fixture. */
      const key = r._team + '|' + r.fixture;
      if (seen.has(key)) continue;
      seen.add(key);
      const home = String(r.was_home).toLowerCase() === 'true';
      const forGoals = home ? num(r.team_h_score) : num(r.team_a_score);
      const agGoals = home ? num(r.team_a_score) : num(r.team_h_score);
      st.gf.set(r._team, (st.gf.get(r._team) || 0) + forGoals);
      st.ga.set(r._team, (st.ga.get(r._team) || 0) + agGoals);
      st.games.set(r._team, (st.games.get(r._team) || 0) + 1);
      st.matches += 1; st.goals += forGoals;
    }
  }
}

/* THE HARNESS MUST PROVE IT HAS A FIXTURE SIGNAL.
   The first version keyed team strength by club NAME and looked it up by
   numeric id, so the opponent term never resolved and every future gameweek
   for a player projected identically. A discount applied to a flat forecast
   cannot change a decision, so the sweep dutifully reported "no effect" —
   a null produced by a bug, not by the data. Counted here and asserted after
   the run, because that failure is otherwise completely silent. */
const SIGNAL = { resolved: 0, unresolved: 0, varied: 0 };

const PRIOR_MIN = 270;      /* minutes at which a player's own rate carries half the weight */
const PRIOR_P90 = 3.2;      /* an unremarkable starter's points per 90 */

/* Projected points for one player in one fixture, from prior data only. */
function project(st, el, meta, oppTeam, home) {
  const mins = st.mins.get(el) || [];
  if (!mins.length) return 0;
  const recent = mins.slice(-4);
  const expMin = recent.reduce((a, b) => a + b, 0) / recent.length;
  if (expMin < 1) return 0;
  const total = mins.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const own = (st.pts.get(el) || 0) / (total / 90);
  const w = total / (total + PRIOR_MIN);
  const p90 = w * own + (1 - w) * PRIOR_P90;
  /* Fixture term: how leaky the opponent has been, tilted for venue. This is
     what makes GW+1 differ from GW+3 — without it every future week looks the
     same and the discount could not change a single decision. */
  const avgGa = st.matches ? st.goals / st.matches : 1.4;
  const oppGames = st.games.get(oppTeam) || 0;
  const oppLeak = oppGames >= 3 ? (st.ga.get(oppTeam) || 0) / oppGames / (avgGa || 1.4) : 1;
  if (oppGames >= 3) SIGNAL.resolved++; else SIGNAL.unresolved++;
  const mult = Math.max(0.6, Math.min(1.6, oppLeak * (home ? 1.08 : 0.92)));
  if (Math.abs(mult - 1) > 1e-9) SIGNAL.varied++;
  return p90 * (expMin / 90) * mult;
}

/* ── one simulated season at one decay ──────────────────────────────────── */
const BUDGET = 1000, CLUB_CAP = 3;
const SHAPE = { 1: 2, 2: 5, 3: 5, 4: 3 };

function startingSquad(season, gw1, rand) {
  const pool = [];
  for (const [el, rs] of gw1) {
    const m = season.meta.get(el);
    if (!m) continue;
    pool.push({ ...m, now_cost: num(rs[0].value) });
  }
  /* Random legal fifteen inside budget: shuffle, then greedily fill the shape
     under the club cap and the budget. Different seeds explore genuinely
     different decision paths rather than re-running one squad. */
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const need = { ...SHAPE }, club = {}, squad = [];
  let spend = 0;
  for (const p of pool) {
    if (!need[p.element_type]) continue;
    if ((club[p.team] || 0) >= CLUB_CAP) continue;
    const left = Object.values(need).reduce((a, b) => a + b, 0) - 1;
    if (spend + p.now_cost + left * 40 > BUDGET) continue;     /* leave 4.0 for each remaining slot */
    squad.push(p); spend += p.now_cost; need[p.element_type]--; club[p.team] = (club[p.team] || 0) + 1;
    if (!Object.values(need).some((n) => n > 0)) break;
  }
  if (Object.values(need).some((n) => n > 0)) return null;
  return { squad, bank: BUDGET - spend };
}

function simulate(season, seed, decay) {
  const rand = rng(seed);
  const gw1 = season.byGw.get(1);
  if (!gw1) return null;
  const start = startingSquad(season, gw1, rand);
  if (!start) return null;
  API.setDecay(decay);

  let squad = start.squad.slice(), bank = start.bank, ft = 1, total = 0, hits = 0, moves = 0;
  const st = newState();

  for (let gw = 1; gw <= season.maxGw; gw++) {
    const rows = season.byGw.get(gw);
    if (!rows) continue;
    /* Prices as at this deadline. */
    const priceOf = (el) => { const rs = rows.get(el); return rs ? num(rs[0].value) : null; };

    /* Fixture map for the horizon, from the future GWs' FIXTURE LISTS only —
       who plays whom and where, which is known before the deadline. The
       PROJECTION attached to each is built purely from `st`, which contains
       nothing past gw-1. */
    const gws = [];
    for (let g = gw; g < gw + HORIZON && g <= season.maxGw; g++) if (season.byGw.has(g)) gws.push(g);
    const universe = new Map();
    for (const [el, m] of season.meta) universe.set(el, m);
    const gwFx = {};
    for (const g of gws) {
      for (const [el, rs] of season.byGw.get(g)) {
        const m = season.meta.get(el);
        if (!m) continue;
        gwFx[m.team] = gwFx[m.team] || {};
        gwFx[m.team][g] = gwFx[m.team][g] || [];
      }
    }
    /* One entry per fixture per team, carrying a per-player projection. Team
       fixtures are shared, so the projection is attached per player below via
       a per-element view of gwFx. */
    const perEl = new Map();
    for (const g of gws) {
      for (const [el, rs] of season.byGw.get(g)) {
        const m = season.meta.get(el);
        if (!m) continue;
        const fxs = rs.map((r) => ({ xp: project(st, el, m, num(r.opponent_team),
          String(r.was_home).toLowerCase() === 'true') }));
        if (!perEl.has(el)) perEl.set(el, {});
        perEl.get(el)[g] = fxs;
      }
    }
    /* solvePlanMulti reads gwFx[team][gw]; give each player its own team key so
       projections stay per-player rather than per-club. */
    const elTeam = new Map();
    const gwFxEl = {};
    for (const [el, byG] of perEl) { elTeam.set(el, 'E' + el); gwFxEl['E' + el] = byG; }

    const pool = [];
    for (const [el, m] of universe) {
      const price = priceOf(el);
      if (price == null || !perEl.has(el)) continue;
      pool.push({ ...m, id: el, team: 'E' + el, club: m.team, now_cost: price,
        status: 'a', minutes: (st.mins.get(el) || []).reduce((a, b) => a + b, 0) });
    }
    const byId = new Map(pool.map((p) => [p.id, p]));
    const live = squad.map((p) => byId.get(p.id) || { ...p, team: 'E' + p.id, club: p.club || p.team });

    /* The solver's own club cap keys off `team`, which is now per-player, so
       the real three-per-club rule is enforced here instead. */
    const clubCount = {};
    live.forEach((p) => { clubCount[p.club] = (clubCount[p.club] || 0) + 1; });
    const legal = pool.filter((c) => {
      if (live.some((p) => p.id === c.id)) return true;
      return (clubCount[c.club] || 0) < CLUB_CAP;
    });

    let plan = null;
    if (gws.length >= 2) {
      try { plan = API.solvePlanMulti({ elements: legal }, gwFxEl, gws, live, bank, ft); } catch (_) { plan = null; }
    }
    const step = plan && plan.best && plan.best.plan[0];
    let made = 0;
    if (step && step.moves && step.moves.length) {
      for (const mv of step.moves) {
        const out = live.findIndex((p) => p.id === mv.o.id);
        if (out < 0) continue;
        const inc = byId.get(mv.c.id);
        if (!inc || live.some((p) => p.id === inc.id)) continue;
        const others = live.filter((p) => p.id !== mv.o.id);
        if (others.filter((p) => p.club === inc.club).length >= CLUB_CAP) continue;
        if (bank + live[out].now_cost - inc.now_cost < 0) continue;
        bank += live[out].now_cost - inc.now_cost;
        live[out] = inc; made++;
      }
    }
    const cost = Math.max(0, made - ft) * 4;
    hits += cost; total -= cost; moves += made;
    ft = Math.min(5, Math.max(0, ft - made) + 1);
    squad = live;

    /* XI by PROJECTION (no lookahead), scored on ACTUAL points. */
    const scored = squad.map((p) => {
      const fx = (perEl.get(p.id) || {})[gw] || [];
      return { el: p, p: fx.reduce((a, f) => a + f.xp, 0) };
    });
    const xi = API.bestXI(scored);
    if (!xi) continue;
    const actual = (el) => {
      const rs = rows.get(el);
      return rs ? rs.reduce((a, r) => a + num(r.total_points), 0) : 0;
    };
    const played = (el) => {
      const rs = rows.get(el);
      return rs ? rs.reduce((a, r) => a + num(r.minutes), 0) : 0;
    };
    const xiIds = new Set(xi.xi.map((s) => s.el.id));
    let week = 0;
    const blanks = [];
    for (const s of xi.xi) { if (played(s.el.id) > 0) week += actual(s.el.id); else blanks.push(s); }
    /* Auto-subs: the highest-projected bench player who actually featured,
       for each starter who did not, keeping the keeper swap like-for-like. */
    const bench = scored.filter((s) => !xiIds.has(s.el.id)).sort((a, b) => b.p - a.p);
    for (const miss of blanks) {
      const idx = bench.findIndex((s) => played(s.el.id) > 0 &&
        (miss.el.element_type === 1 ? s.el.element_type === 1 : s.el.element_type !== 1));
      if (idx < 0) continue;
      week += actual(bench[idx].el.id);
      bench.splice(idx, 1);
    }
    /* Captain: the best projection in the XI, doubled on actuals. */
    const cap = xi.xi.slice().sort((a, b) => b.p - a.p)[0];
    if (cap && played(cap.el.id) > 0) week += actual(cap.el.id);
    total += week;

    absorbGw(st, rows);
  }
  return { total, hits, moves };
}

/* ── sweep ──────────────────────────────────────────────────────────────── */
const dir = join(ROOT, 'dev', 'fixtures', 'vaastav');
const seasons = existsSync(dir)
  ? readdirSync(dir).filter((s) => existsSync(join(dir, s, 'merged_gw.csv'))).sort()
  : [];
if (!seasons.length) {
  console.error('No full season dumps found. Run: node dev/fetch-vaastav.mjs <season>');
  process.exit(1);
}
console.log(`Fitting DECAY_BASE — ${seasons.length} season(s), ${SEEDS} starting squads, horizon ${HORIZON}`);
console.log(`Grid: ${GRID.join(', ')}\n`);

const results = new Map(GRID.map((d) => [d, []]));
const pairs = [];
for (const s of seasons) {
  const season = loadSeason(join(dir, s, 'merged_gw.csv'), join(dir, s, 'players_raw.csv'));
  for (let seed = 1; seed <= SEEDS; seed++) {
    const row = { season: s, seed, by: new Map() };
    for (const d of GRID) {
      const r = simulate(season, seed * 7919, d);
      if (!r) continue;
      results.get(d).push(r.total);
      row.by.set(d, r);
    }
    if (row.by.size === GRID.length) pairs.push(row);
    process.stderr.write(`  ${s} seed ${seed} done\n`);
  }
}

const lookups = SIGNAL.resolved + SIGNAL.unresolved;
const resolvedPct = lookups ? 100 * SIGNAL.resolved / lookups : 0;
const variedPct = lookups ? 100 * SIGNAL.varied / lookups : 0;
console.log(`\nfixture signal: ${resolvedPct.toFixed(1)}% of opponent lookups resolved, ` +
  `${variedPct.toFixed(1)}% produced a non-neutral multiplier`);
if (resolvedPct < 80 || variedPct < 50) {
  console.error('\n✗ the projection has little or no fixture variation, so this sweep ' +
    'cannot measure a discount on future gameweeks. Fix the harness before reading the table.');
  process.exit(1);
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };

const flat = (d) => pairs.map((p) => p.by.get(d).total);
/* Undiscounted is the reference point: it is the behaviour before this
   parameter existed, so every row reads as "what the discount bought". */
const REF = GRID.includes(1.0) ? 1.0 : GRID[GRID.length - 1];
const base = flat(REF);

/* The raw per-run totals are written out before anything is formatted. The
   first full sweep was lost to a print-ordering slip after every simulation
   had already run; a results file makes the compute reusable. */
writeFileSync(join(ROOT, 'dev', 'decay-fit-h' + HORIZON + '.json'), JSON.stringify({
  seasons, seeds: SEEDS, horizon: HORIZON, grid: GRID,
  runs: pairs.map((p) => ({ season: p.season, seed: p.seed,
    by: Object.fromEntries([...p.by].map(([d, r]) => [d, r])) })),
}, null, 1));

console.log('\n── season points by decay (mean over ' + pairs.length + ' season-squad runs) ──');
console.log('decay   mean pts    sd    vs ' + REF + ' (paired)     hits   moves');
for (const d of GRID) {
  const v = flat(d);
  const diff = v.map((x, i) => x - base[i]);
  const md = mean(diff), sdd = sd(diff);
  const se = sdd / Math.sqrt(diff.length);
  const sig = Math.abs(md) > 2 * se && se > 0 ? '  *' : '';
  console.log(
    String(d).padEnd(7) +
    mean(v).toFixed(1).padStart(8) +
    sd(v).toFixed(1).padStart(8) +
    ((md >= 0 ? '+' : '') + md.toFixed(1)).padStart(9) + ' ± ' + (2 * se).toFixed(1).padEnd(6) + sig.padEnd(3) +
    mean(pairs.map((p) => p.by.get(d).hits)).toFixed(0).padStart(6) +
    mean(pairs.map((p) => p.by.get(d).moves)).toFixed(1).padStart(8));
}
console.log('\n* = paired difference from decay ' + REF + ' exceeds two standard errors.');
console.log('Paired: every decay sees the same seasons, squads and projections, so the');
console.log('difference column is far less noisy than the raw season totals beside it.');
