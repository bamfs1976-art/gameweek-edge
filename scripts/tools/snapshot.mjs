/* Gameweek Edge — the tool pages' data, reduced from the official feed.

   The public tool pages (scripts/tools/pages.mjs) are generated, never
   hand-maintained: scripts/tools/fetch.mjs reads the official FPL API on
   a schedule and writes data/tool-pages.json, and the build renders the
   pages from that file. This module is the reduction from the raw feed to
   that file, pure so dev/test-tool-pages.mjs can feed it a small boot. */

export const TOP_N = 200;        /* player pages: the top 200 by points */
export const HORIZON = 6;        /* fixtures shown per team */
export const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
export const POS_LONG = { 1: 'Goalkeeper', 2: 'Defender', 3: 'Midfielder', 4: 'Forward' };
export const STATUS = { a: 'Available', i: 'Injured', d: 'Doubtful', s: 'Suspended', u: 'Unavailable', n: 'Not available' };

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

/* A URL segment from a name: ASCII, lower case, hyphens. Ø, ł and ß do
   not decompose, so they are folded by hand, the same way the app folds
   them for search. */
export function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[øØ]/g, 'o').replace(/[łŁ]/g, 'l').replace(/[đĐ]/g, 'd').replace(/ß/g, 'ss')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function buildSnapshot(boot, fixtures, feed, now) {
  const built = (now ? new Date(now) : new Date()).toISOString();
  const events = boot.events || [];
  const cur = events.find((e) => e.is_current) || null;
  const next = events.find((e) => e.is_next) || events.find((e) => !e.finished) || null;
  const teams = (boot.teams || []).map((t) => ({ id: t.id, name: t.name, short: t.short_name, code: t.code, slug: slugify(t.name) }));
  const byTeam = {}; teams.forEach((t) => { byTeam[t.id] = t; });

  /* Fixtures still to be played, the next HORIZON gameweeks from the next
     deadline, with FPL's own difficulty for each side. */
  const fromGw = next ? next.id : (cur ? cur.id : 1);
  const fx = (fixtures || []).filter((f) => f.event != null && !f.finished && f.event >= fromGw && f.event < fromGw + HORIZON)
    .map((f) => ({ gw: f.event, h: f.team_h, a: f.team_a, dh: f.team_h_difficulty || 3, da: f.team_a_difficulty || 3, kick: f.kickoff_time || null }))
    .sort((x, y) => x.gw - y.gw || String(x.kick).localeCompare(String(y.kick)));

  const players = (boot.elements || []).map((e) => ({
    id: e.id, code: e.code, web: e.web_name, first: e.first_name || '', second: e.second_name || '',
    team: e.team, pos: e.element_type, cost: e.now_cost, own: num(e.selected_by_percent), pts: e.total_points || 0,
    form: num(e.form), ppg: num(e.points_per_game), min: e.minutes || 0, g: e.goals_scored || 0, a: e.assists || 0,
    cs: e.clean_sheets || 0, bonus: e.bonus || 0, xg: num(e.expected_goals), xa: num(e.expected_assists), xgi: num(e.expected_goal_involvements),
    dc: e.defensive_contribution || 0, status: e.status || 'a', news: e.news || '', newsAt: e.news_added || null,
    chance: e.chance_of_playing_next_round == null ? null : Number(e.chance_of_playing_next_round),
    yc: e.yellow_cards || 0, rc: e.red_cards || 0, tin: e.transfers_in_event || 0, tout: e.transfers_out_event || 0,
    cce: e.cost_change_event || 0, ccs: e.cost_change_start || 0, ep: num(e.ep_next),
  }));
  const top = players.slice().sort((x, y) => y.pts - x.pts || y.own - x.own || x.id - y.id).slice(0, TOP_N);
  /* Slugs are the URL; two players with one name get the id appended so
     neither page can shadow the other. */
  const seen = {};
  top.forEach((p) => { const s = slugify(p.first + ' ' + p.second) || 'player-' + p.id; seen[s] = (seen[s] || 0) + 1; p.slug = s; });
  top.forEach((p) => { if (seen[p.slug] > 1) { p.slug = p.slug + '-' + p.id; p.dup = true; } });

  const flags = players.filter((p) => p.status !== 'a' || (p.chance != null && p.chance < 100) || p.news)
    .map((p) => ({ id: p.id, web: p.web, first: p.first, second: p.second, team: p.team, pos: p.pos, cost: p.cost, own: p.own, status: p.status, news: p.news, newsAt: p.newsAt, chance: p.chance, yc: p.yc }))
    .sort((x, y) => y.own - x.own);
  const cautions = players.filter((p) => p.yc > 0).map((p) => ({ id: p.id, web: p.web, team: p.team, pos: p.pos, yc: p.yc, own: p.own, min: p.min }))
    .sort((x, y) => y.yc - x.yc || y.own - x.own).slice(0, 60);

  /* Price movers: the feed's latest day when it has one, else the
     gameweek's changes from the feed's absence. */
  const days = feed && feed.log && feed.log.days ? Object.keys(feed.log.days).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort() : [];
  const latest = days.length ? days[days.length - 1] : null;
  const dayRows = latest ? (feed.log.days[latest] || []).map((r) => ({ id: r.id, web: r.n, team: r.t, pos: r.p, from: r.from, to: r.to })) : [];
  const gwUp = players.filter((p) => p.cce > 0).sort((x, y) => y.cce - x.cce || y.own - x.own).slice(0, 40);
  const gwDown = players.filter((p) => p.cce < 0).sort((x, y) => x.cce - y.cce || y.own - x.own).slice(0, 40);
  const pick = (p) => ({ id: p.id, web: p.web, team: p.team, pos: p.pos, cost: p.cost, own: p.own, cce: p.cce, net: p.tin - p.tout });
  const bought = players.slice().sort((x, y) => (y.tin - y.tout) - (x.tin - x.tout)).slice(0, 15).map(pick);
  const sold = players.slice().sort((x, y) => (x.tin - x.tout) - (y.tin - y.tout)).slice(0, 15).map(pick);

  return {
    v: 1, built, season: seasonLabel(events), total: boot.total_players || null,
    event: { current: cur ? cur.id : null, next: next ? next.id : null, deadline: next ? next.deadline_time : null, nextName: next ? next.name : null },
    teams, fixtures: fx, players: top,
    flags, cautions,
    movers: { day: latest, rows: dayRows, gwUp: gwUp.map(pick), gwDown: gwDown.map(pick), bought, sold },
  };
}

function seasonLabel(events) {
  const ds = (events || []).map((e) => e.deadline_time).filter(Boolean).sort();
  if (!ds.length) return '';
  const y = new Date(ds[0]).getUTCFullYear();
  return y + '/' + String(y + 1).slice(-2);
}
