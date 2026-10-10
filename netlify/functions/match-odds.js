/* Gameweek Edge — bookmaker odds for the next Premier League fixtures.

   Where the market has priced a fixture, its goal rates beat our own match
   model. Backtested on 1,140 matches of 2023-26 through the shipped
   plsimRatings / plsimMatch, odds collected before the weekend (this feed's
   timing) cut result RPS by 0.0063 (95% interval -0.0088 to -0.0038) and
   clean-sheet Brier by 0.0033 (-0.0048 to -0.0019), with the clean-sheet
   gain clear in every season (docs/MODELLING.md, P12). So the app turns
   these prices into goal rates for the fixtures they cover and keeps the
   fitted model for everything further out.

   Source: football-data.co.uk fixtures.csv, free, refreshed by its author
   before each round (Fridays for a weekend, Tuesdays for midweek). Market
   average prices, margin removed by normalisation; Bet365 or Pinnacle when
   the average is missing. Only 1X2 and over/under 2.5 are read: those three
   chances pin down both teams' goal rates.

   This returns probabilities and names only. Turning them into goal rates
   and matching names to FPL team ids happens in index.html (marketRates),
   so the app, the prediction logger and the MCP tools share one rule. */

const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)';
const URL_ODDS = 'https://www.football-data.co.uk/fixtures.csv';
const DIV = 'E0';

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
  /* The file starts with a byte-order mark. */
  const head = rows[0].map((h) => h.replace(/^﻿/, '').trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0] === '') continue;
    const o = {};
    for (let c = 0; c < head.length; c++) o[head[c]] = (rows[r][c] || '').trim();
    out.push(o);
  }
  return out;
}

/* Decimal prices to fair probabilities. Anything that is not a real price
   (missing, zero, below evens-of-nothing) makes the whole set unusable. */
function fair(prices) {
  const x = prices.map(Number);
  if (!x.every((v) => Number.isFinite(v) && v > 1)) return null;
  const inv = x.map((v) => 1 / v), s = inv.reduce((a, b) => a + b, 0);
  return inv.map((v) => v / s);
}

/* The first bookmaker set that is complete: market average, then Bet365,
   then Pinnacle. */
function pick(r, sets) {
  for (const cols of sets) {
    const p = fair(cols.map((c) => r[c]));
    if (p) return p;
  }
  return null;
}
const SETS_1X2 = [['AvgH', 'AvgD', 'AvgA'], ['B365H', 'B365D', 'B365A'], ['PSH', 'PSD', 'PSA']];
const SETS_OU = [['Avg>2.5', 'Avg<2.5'], ['B365>2.5', 'B365<2.5'], ['P>2.5', 'P<2.5']];

/* dd/mm/yy or dd/mm/yyyy to yyyy-mm-dd. */
function isoDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s || '');
  if (!m) return null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function oddsRows(rows) {
  const out = [];
  for (const r of rows || []) {
    if (r.Div !== DIV) continue;
    const date = isoDate(r.Date);
    const p = pick(r, SETS_1X2), o = pick(r, SETS_OU);
    if (!date || !p || !r.HomeTeam || !r.AwayTeam) continue;
    const r4 = (v) => Math.round(v * 10000) / 10000;
    out.push({ date, time: r.Time || null, home: r.HomeTeam, away: r.AwayTeam,
      pH: r4(p[0]), pD: r4(p[1]), pA: r4(p[2]), pOver: o ? r4(o[0]) : null });
  }
  return out;
}

exports.handler = async () => {
  let rows = [];
  try {
    const r = await fetch(URL_ODDS, { headers: { 'User-Agent': UA, Accept: 'text/csv' }, redirect: 'follow' });
    if (r.status === 200) rows = oddsRows(parseCsv(await r.text()));
  } catch (_) { rows = []; }
  /* An empty list is a plain "no odds", and the client keeps the model. */
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': rows.length ? 'public, max-age=3600, stale-while-revalidate=21600' : 'public, max-age=600',
    },
    body: JSON.stringify({ source: 'football-data.co.uk', fetchedAt: new Date().toISOString(), matches: rows }),
  };
};

module.exports.parseCsv = parseCsv;
module.exports.fair = fair;
module.exports.isoDate = isoDate;
module.exports.oddsRows = oddsRows;
