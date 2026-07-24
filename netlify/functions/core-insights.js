/* Gameweek Edge — FPL Core Insights aggregator (scheduled).
   Runs twice daily (the same cadence the upstream dataset refreshes). It
   pulls the open FPL-Core-Insights per-match stats — advanced Opta-like
   metrics the official FPL API does NOT expose — aggregates them per player
   over the season, and upserts a compact per-player row into
   public.gwedge_core_insights, keyed by the official FPL element id.

   Headline field: `goals_prevented` (post-shot xG faced minus goals conceded
   — a keeper's shot-stopping above expectation), which sharpens nativeXP's
   goalkeeper term. Also finishing quality (xgot, big_chances_missed),
   open-play threat (non-penalty xG) and involvement (chances_created,
   touches in the box).

   Source: https://github.com/olbauday/FPL-Core-Insights (used freely with a
   link back, per its README). Per-match files live at
   data/{season}/By Gameweek/GW{n}/playermatchstats.csv.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. No-ops if unconfigured, so
   the feature degrades to "official data only" exactly like the app's other
   keyed features. */

const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)';
const RAW = 'https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main';
const PEN_XG = 0.79;          /* an FPL penalty is worth ~0.79 xG */
const MAX_GW = 38;

/* ── tiny robust CSV → array-of-objects ──────────────────── */
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0] === '') continue;   // blank line
    const o = {};
    for (let c = 0; c < head.length; c++) o[head[c]] = rows[r][c];
    out.push(o);
  }
  return out;
}
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

/* ── which season to aggregate ───────────────────────────── */
/* FPL's competitive season starts in August; a July "pre-season" belongs to
   the campaign about to begin. Return that label first, then last season as a
   fallback (pre-season it's last season that actually has match data — the
   right prior for GW1). */
function deriveSeasonLabel(d) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth();     // 0 = Jan
  const start = m >= 6 ? y : y - 1;                       // Jul(6)+ → new season
  return start + '-' + (start + 1);
}
function seasonCandidates(d) {
  const cur = deriveSeasonLabel(d);
  const s = parseInt(cur.split('-')[0], 10);
  return [cur, (s - 1) + '-' + s];                        // current, then previous
}

const gwUrl = (season, gw) => RAW + '/data/' + season + '/By%20Gameweek/GW' + gw + '/playermatchstats.csv';

async function fetchGw(season, gw) {
  const r = await fetch(gwUrl(season, gw), { headers: { 'User-Agent': UA, Accept: 'text/csv' } });
  if (r.status === 200) return parseCsv(await r.text());
  if (r.status === 404) return null;
  throw new Error('GW' + gw + ' HTTP ' + r.status);
}

/* ── pure aggregation (unit-tested) ──────────────────────── */
/* matchRows: flat array of playermatchstats rows (objects) across all
   gameweeks of one season. Returns one compact record per FPL element id. */
function aggregate(season, matchRows) {
  const acc = {};
  for (const m of matchRows) {
    const id = parseInt(m.player_id, 10);
    if (!Number.isFinite(id)) continue;
    const a = acc[id] || (acc[id] = {
      season, element: id, games: 0, minutes: 0, goals_prevented: 0, xgot_faced: 0,
      saves: 0, goals_conceded: 0, xg: 0, xgot: 0, big_chances_missed: 0,
      chances_created: 0, touches_opp_box: 0, penalties: 0,
    });
    const mins = num(m.minutes_played);
    if (mins > 0) a.games += 1;
    a.minutes += mins;
    a.goals_prevented += num(m.goals_prevented);
    a.xgot_faced += num(m.xgot_faced);
    a.saves += num(m.saves);
    a.goals_conceded += num(m.goals_conceded);
    a.xg += num(m.xg);
    a.xgot += num(m.xgot);
    a.big_chances_missed += num(m.big_chances_missed);
    a.chances_created += num(m.chances_created);
    a.touches_opp_box += num(m.touches_opposition_box);
    a.penalties += num(m.penalties_scored) + num(m.penalties_missed);
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return Object.values(acc).map((a) => {
    const per90 = a.minutes > 0 ? 90 / a.minutes : 0;
    const npXg = Math.max(0, a.xg - PEN_XG * a.penalties);   /* strip penalty xG → open-play threat */
    return {
      season: a.season, element: a.element, games: a.games, minutes: Math.round(a.minutes),
      goals_prevented: r2(a.goals_prevented), goals_prevented_per_90: r3(a.goals_prevented * per90),
      xgot_faced: r2(a.xgot_faced), saves: Math.round(a.saves), goals_conceded: Math.round(a.goals_conceded),
      xg: r2(a.xg), xgot: r2(a.xgot), np_xg: r2(npXg), np_xg_per_90: r3(npXg * per90),
      big_chances_missed: Math.round(a.big_chances_missed), chances_created: Math.round(a.chances_created),
      touches_opp_box: Math.round(a.touches_opp_box), touches_opp_box_per_90: r3(a.touches_opp_box * per90),
      penalties: Math.round(a.penalties),
    };
  });
}

/* Gather every gameweek's match rows for a season. Contiguous scan: fetch in
   small parallel batches, stop once a whole batch is empty (past the last GW
   played). Returns { season, rows } or null when the season has no data. */
async function collectSeason(season) {
  const rows = [];
  let found = 0;
  for (let base = 1; base <= MAX_GW; base += 4) {
    const gws = [base, base + 1, base + 2, base + 3].filter((g) => g <= MAX_GW);
    let batch;
    try { batch = await Promise.all(gws.map((g) => fetchGw(season, g))); }
    catch (_) { break; }                                   // upstream hiccup — use what we have
    let any = false;
    for (const b of batch) if (b) { rows.push(...b); found++; any = true; }
    if (!any) break;                                       // whole batch 404 → season finished
  }
  return found ? { season, rows } : null;
}

exports.config = { schedule: '30 6,17 * * *' };            /* ~1h after the upstream 07:30 / 17:30 UTC refreshes */

exports.handler = async () => {
  const supaUrl = process.env.SUPABASE_URL, supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return { statusCode: 200, body: 'not configured' };

  let picked = null;
  try {
    for (const s of seasonCandidates(new Date())) {
      picked = await collectSeason(s);
      if (picked) break;                                   // first season with data wins
    }
  } catch (_) { return { statusCode: 200, body: 'upstream unavailable' }; }
  if (!picked) return { statusCode: 200, body: 'no season data' };

  const records = aggregate(picked.season, picked.rows);
  if (!records.length) return { statusCode: 200, body: 'no players' };

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
  let upserted = 0;
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    const { error } = await sb.from('gwedge_core_insights').upsert(chunk, { onConflict: 'season,element' });
    if (!error) upserted += chunk.length;
  }
  return { statusCode: 200, body: JSON.stringify({ season: picked.season, players: upserted }) };
};

module.exports.parseCsv = parseCsv;
module.exports.aggregate = aggregate;
module.exports.deriveSeasonLabel = deriveSeasonLabel;
module.exports.seasonCandidates = seasonCandidates;
