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
   gameweeks of one season. `positions` maps FPL element id → the Core Insights
   position label (Defender / Midfielder / Forward / Goalkeeper) so we can apply
   the right defensive-contribution threshold. Returns one record per element. */
const DEF_THRESHOLD = 10;      /* DEF need 10 CBIT for the +2 */
const MIDFWD_THRESHOLD = 12;   /* MID/FWD need 12 CBIRT */

/* THE FORMULA IS VERIFIED. FPL publishes its own official
   `defensive_contribution` per player-gameweek from 2025-26 (visible in the
   vaastav dataset). Checked against the CBIT/CBIRT arithmetic below across
   26,330 outfield player-gameweeks of 2025-26: 26,330 exact matches, zero
   mismatches, zero cases of a published zero against non-zero components.

   So DEF = clearances + blocks + interceptions + tackles at a threshold of
   10, and MID/FWD = the same plus recoveries at 12, is not our reading of
   the rule — it IS the rule, confirmed against the source of truth. An
   independent third implementation (nickharris88/fpl-history) derives the
   same thresholds and the same components.

   WHY THIS RECOMPUTES INSTEAD OF READING `defensive_contributions`.
   playermatchstats.csv publishes a `defensive_contributions` column, and
   reading it directly is the obvious simplification. It is also wrong.
   Measured across 2025-26 GW9-11 (1,142 outfield appearances):

     - of 291 outfielders who played 60+ minutes in GW10, 102 (35%) carry a
       published value of ZERO while their own component columns show real
       clearances, blocks, interceptions and tackles. Those are holes, not
       goalless defensive shifts, and taking them at face value would deflate
       every hit rate this file feeds — the xP model's dcHitRate, Rank
       Threats, and the club threads' "defensive floor";
     - where the column IS populated, this position-aware formula reproduces
       it exactly only ~66% of the time, so it is not simply our arithmetic
       being wrong either.

   The component columns, by contrast, are effectively complete: 4 of 291
   all-zero, which is a plausible real quiet match rather than a gap. So the
   components are the source of truth here and the aggregate column is
   ignored. Do not "simplify" this by reading it.

   Note the distinction, because it is easy to collapse the two: FPL's OWN
   `defensive_contribution` is flawless (26,330 of 26,330 above). It is
   Core Insights' separately-scraped `defensive_contributions` that is not.
   Same idea, same name give or take an s, completely different reliability.
   FPL's column is a season and per-gameweek TOTAL, though, and this file
   needs the per-match hit RATE — how often a player clears the threshold in
   a start — which a total cannot give. That is why the components are still
   the input here rather than simply reading FPL's number.

   The same check ruled out `start_min` / `finish_min` as a better definition
   of a start than `minutes >= 60`: rows routinely read start 0, finish 90,
   minutes 11, so they are match boundaries rather than a player's own on and
   off times. */
function aggregate(season, matchRows, positions) {
  positions = positions || {};
  const acc = {};
  for (const m of matchRows) {
    const id = parseInt(m.player_id, 10);
    if (!Number.isFinite(id)) continue;
    const a = acc[id] || (acc[id] = {
      season, element: id, games: 0, minutes: 0, goals_prevented: 0, xgot_faced: 0,
      saves: 0, goals_conceded: 0, xg: 0, xgot: 0, big_chances_missed: 0,
      chances_created: 0, touches_opp_box: 0, penalties: 0,
      dc_starts: 0, dc_hits: 0, dc_actions: 0,
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
    /* Defensive-contribution consistency: count a "start" as >= 60 minutes and
       check the per-match CBIT (DEF) / CBIRT (MID/FWD) against the threshold.
       Goalkeepers have no defensive-contribution category, so skip them. */
    const pos = positions[id];
    if (mins >= 60 && pos && pos !== 'Goalkeeper') {
      const cbit = num(m.clearances) + num(m.blocks) + num(m.interceptions) + num(m.tackles);
      const isDef = pos === 'Defender';
      const actions = isDef ? cbit : cbit + num(m.recoveries);
      const thr = isDef ? DEF_THRESHOLD : MIDFWD_THRESHOLD;
      a.dc_starts += 1;
      a.dc_actions += actions;
      if (actions >= thr) a.dc_hits += 1;
    }
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return Object.values(acc).map((a) => {
    const per90 = a.minutes > 0 ? 90 / a.minutes : 0;
    const npXg = Math.max(0, a.xg - PEN_XG * a.penalties);   /* strip penalty xG → open-play threat */
    const dcS = a.dc_starts;
    return {
      season: a.season, element: a.element, games: a.games, minutes: Math.round(a.minutes),
      goals_prevented: r2(a.goals_prevented), goals_prevented_per_90: r3(a.goals_prevented * per90),
      xgot_faced: r2(a.xgot_faced), saves: Math.round(a.saves), goals_conceded: Math.round(a.goals_conceded),
      xg: r2(a.xg), xgot: r2(a.xgot), np_xg: r2(npXg), np_xg_per_90: r3(npXg * per90),
      big_chances_missed: Math.round(a.big_chances_missed), chances_created: Math.round(a.chances_created),
      touches_opp_box: Math.round(a.touches_opp_box), touches_opp_box_per_90: r3(a.touches_opp_box * per90),
      penalties: Math.round(a.penalties),
      defcon_starts: dcS, defcon_hits: a.dc_hits, defcon_actions: Math.round(a.dc_actions),
      defcon_hit_rate: dcS ? r3(a.dc_hits / dcS) : null,
      defcon_per_start: dcS ? r2(a.dc_actions / dcS) : null,
    };
  });
}
/* Parse players.csv → { elementId: positionLabel }. */
function positionMap(playersCsv) {
  const map = {};
  for (const r of parseCsv(playersCsv)) {
    const id = parseInt(r.player_id, 10);
    if (Number.isFinite(id) && r.position) map[id] = r.position;
  }
  return map;
}

/* Gather every gameweek's match rows for a season. Contiguous scan: fetch in
   small parallel batches, stop once a whole batch has no DATA (past the last
   GW played). A gameweek file that exists but is header-only counts as no
   data — crucial pre-season, when the upcoming season's GW folders are already
   present but empty, so we must fall through to the last completed season
   rather than return an empty set. Returns { season, rows } or null. */
async function collectSeason(season) {
  const rows = [];
  for (let base = 1; base <= MAX_GW; base += 4) {
    const gws = [base, base + 1, base + 2, base + 3].filter((g) => g <= MAX_GW);
    let batch;
    try { batch = await Promise.all(gws.map((g) => fetchGw(season, g))); }
    catch (_) { break; }                                   // upstream hiccup — use what we have
    let any = false;
    for (const b of batch) if (b && b.length) { rows.push(...b); any = true; }   // header-only → skip
    if (!any) break;                                       // whole batch 404 / empty → season not yet playing
  }
  return rows.length ? { season, rows } : null;
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

  /* Player positions (for the DEF 10 vs MID/FWD 12 defensive-contribution
     threshold). Best-effort: without it the defcon fields stay null. */
  let positions = {};
  try {
    const r = await fetch(RAW + '/data/' + picked.season + '/players.csv', { headers: { 'User-Agent': UA, Accept: 'text/csv' } });
    if (r.status === 200) positions = positionMap(await r.text());
  } catch (_) { /* defcon fields null */ }

  const records = aggregate(picked.season, picked.rows, positions);
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
module.exports.positionMap = positionMap;
module.exports.deriveSeasonLabel = deriveSeasonLabel;
module.exports.seasonCandidates = seasonCandidates;
