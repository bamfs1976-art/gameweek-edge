/* Gameweek Edge — midweek European and cup fixtures, by FPL gameweek.

   The single biggest driver of rotation is a match a club played three days
   before the one you are picking them for, and the official FPL API cannot
   see it: it knows only the Premier League calendar. A Thursday Europa League
   tie before a Sunday fixture is invisible to `starts` and `minutes` until it
   has already cost you points.

   The open FPL-Core-Insights dataset files each competition by the FPL
   gameweek its matches fall in, with the PL club's official element team id
   in the home_team / away_team column (blank for a non-PL opponent). That is
   exactly the join we need, so this endpoint reads the cup competitions for a
   window of gameweeks and returns a compact per-club list of extra matches.

   Source: https://github.com/olbauday/FPL-Core-Insights (used freely with a
   link back, per its README).

   Degrades to nothing: a competition that has not started yet simply 404s per
   gameweek, and the app then applies no congestion at all — which is the
   correct answer in July, not a failure. */

const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)';
const RAW = 'https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main';
const MAX_GW = 38;
const MAX_WINDOW = 10;         /* gameweeks of look-ahead a single call may ask for */
const BATCH = 8;               /* parallel upstream fetches */

/* The competition folder names as the dataset spells them. "Premier League"
   is deliberately absent — those fixtures come from the FPL API itself, and
   counting them here would make every club permanently congested. */
const COMPS = [
  { dir: 'Champions League', code: 'UCL', label: 'Champions League' },
  { dir: 'Europa League', code: 'UEL', label: 'Europa League' },
  { dir: 'Conference League', code: 'UECL', label: 'Conference League' },
  { dir: 'EFL Cup', code: 'EFL', label: 'EFL Cup' },
  { dir: 'FA Cup', code: 'FA', label: 'FA Cup' },
];

/* ── tiny robust CSV → array-of-objects (shared shape with core-insights) ── */
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

/* FPL's competitive season starts in August, so a July date belongs to the
   campaign about to begin. Unlike the stats aggregator there is NO fallback
   to last season: last season's cup calendar is not a fixture list, it is
   history, and using it would invent congestion that does not exist. */
function deriveSeasonLabel(d) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const start = m >= 6 ? y : y - 1;
  return start + '-' + (start + 1);
}

/* One competition's fixtures for one gameweek → rows tagged with the club.
   A row lists the PL club's team id in whichever of home_team / away_team it
   occupies, and leaves the other blank when the opponent is not a PL club, so
   both columns are read and both may yield a club. */
function clubRows(comp, gw, csvRows) {
  const out = [];
  for (const r of csvRows || []) {
    const kickoff = (r.kickoff_time || '').trim();
    if (!kickoff) continue;
    const finished = String(r.finished || '').toLowerCase() === 'true';
    for (const side of ['home_team', 'away_team']) {
      const t = parseInt(r[side], 10);
      if (!Number.isFinite(t)) continue;
      out.push({ gw, team: t, comp: comp.code, kickoff, home: side === 'home_team', finished });
    }
  }
  return out;
}

/* Drop the duplicate a club picks up when two PL sides meet each other in a
   cup — the same match must count once per club, not twice for the tie. */
function dedupe(rows) {
  const seen = new Set(), out = [];
  for (const r of rows) {
    const k = r.team + '|' + r.kickoff + '|' + r.comp;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out.sort((a, b) => a.kickoff < b.kickoff ? -1 : a.kickoff > b.kickoff ? 1 : a.team - b.team);
}

async function fetchComp(season, comp, gw) {
  const url = RAW + '/data/' + season + '/By%20Tournament/' + encodeURIComponent(comp.dir) +
    '/GW' + gw + '/fixtures.csv';
  let r;
  try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/csv' } }); }
  catch (_) { return []; }                       /* upstream hiccup — no congestion beats wrong congestion */
  if (r.status !== 200) return [];               /* 404: competition not playing that week */
  let text;
  try { text = await r.text(); } catch (_) { return []; }
  return clubRows(comp, gw, parseCsv(text));
}

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};
  const from = Math.max(1, Math.min(MAX_GW, parseInt(q.from, 10) || 1));
  const n = Math.max(1, Math.min(MAX_WINDOW, parseInt(q.n, 10) || 6));
  const season = (q.season && /^\d{4}-\d{4}$/.test(q.season)) ? q.season : deriveSeasonLabel(new Date());

  const jobs = [];
  for (let gw = from; gw < from + n && gw <= MAX_GW; gw++) {
    for (const comp of COMPS) jobs.push({ comp, gw });
  }
  const rows = [];
  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    const got = await Promise.all(batch.map((j) => fetchComp(season, j.comp, j.gw)));
    for (const g of got) rows.push(...g);
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      /* Cup calendars move rarely, and a stale one is far cheaper than 50
         upstream requests per visitor. */
      'Cache-Control': 'public, max-age=21600, stale-while-revalidate=86400',
    },
    body: JSON.stringify({ season, from, n, rows: dedupe(rows) }),
  };
};

module.exports.parseCsv = parseCsv;
module.exports.deriveSeasonLabel = deriveSeasonLabel;
module.exports.clubRows = clubRows;
module.exports.dedupe = dedupe;
module.exports.COMPS = COMPS;
