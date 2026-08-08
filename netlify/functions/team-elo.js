/* Gameweek Edge — club Elo ratings keyed by FPL team id.

   Our match model fits attack/defence multipliers to this season's results,
   seeded by priors fitted offline. Those priors cover the clubs we knew about
   when they were fitted; anything else — a newly promoted side we have no
   entry for, a club that changed its name — falls back to one generic
   "promoted club" number applied identically to every such team.

   Club Elo fixes exactly that gap. The open FPL-Core-Insights dataset carries
   an `elo` column in teams.csv alongside the official FPL team id, so it needs
   no name matching, and it is a live rating rather than a fixed guess.

   Measured against our own offline-fitted priors on the 2026-27 clubs, Elo
   correlates +0.88 with attack and -0.93 with defence, and in a leave-one-out
   test an Elo-derived prior is 71% closer on attack and 84% closer on defence
   than the generic promoted prior it replaces. It is NOT used to override a
   prior we already fitted — a 6% residual is worse than the real thing.

   Source: https://github.com/olbauday/FPL-Core-Insights (used freely with a
   link back, per its README). */

const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)';
const RAW = 'https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main';
/* Football Elo lives in a narrow band; anything outside this is a parse error
   or a placeholder, not a rating. */
const ELO_MIN = 800, ELO_MAX = 2600;

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
    if (rows[r].length === 1 && rows[r][0] === '') continue;
    const o = {};
    for (let c = 0; c < head.length; c++) o[head[c]] = rows[r][c];
    out.push(o);
  }
  return out;
}

function deriveSeasonLabel(d) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const start = m >= 6 ? y : y - 1;
  return start + '-' + (start + 1);
}
function seasonCandidates(d) {
  const cur = deriveSeasonLabel(d);
  const s = parseInt(cur.split('-')[0], 10);
  return [cur, (s - 1) + '-' + s];
}

/* teams.csv rows → { fplTeamId: elo }. Ratings outside the plausible band are
   dropped rather than clamped: a bad value should go missing (and fall back to
   the generic prior) rather than quietly become a confident wrong one. */
function eloMap(rows) {
  const out = {};
  for (const r of rows || []) {
    const id = parseInt(r.id, 10);
    const elo = parseFloat(r.elo);
    if (!Number.isFinite(id) || !Number.isFinite(elo)) continue;
    if (elo < ELO_MIN || elo > ELO_MAX) continue;
    out[id] = Math.round(elo * 10) / 10;
  }
  return out;
}

async function fetchSeason(season) {
  let r;
  try { r = await fetch(RAW + '/data/' + season + '/teams.csv', { headers: { 'User-Agent': UA, Accept: 'text/csv' } }); }
  catch (_) { return null; }
  if (r.status !== 200) return null;
  let text;
  try { text = await r.text(); } catch (_) { return null; }
  const map = eloMap(parseCsv(text));
  /* A handful of clubs is a broken file, not a league. */
  return Object.keys(map).length >= 10 ? map : null;
}

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};
  const wanted = (q.season && /^\d{4}-\d{4}$/.test(q.season)) ? [q.season] : seasonCandidates(new Date());
  for (const season of wanted) {
    const elo = await fetchSeason(season);
    if (elo) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=21600, stale-while-revalidate=86400',
        },
        body: JSON.stringify({ season, elo }),
      };
    }
  }
  /* Nothing upstream: say so plainly with an empty map, so the client applies
     no Elo at all rather than treating a failure as data. */
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
    body: JSON.stringify({ season: null, elo: {} }),
  };
};

module.exports.parseCsv = parseCsv;
module.exports.eloMap = eloMap;
module.exports.deriveSeasonLabel = deriveSeasonLabel;
module.exports.seasonCandidates = seasonCandidates;
