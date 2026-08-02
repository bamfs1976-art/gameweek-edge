/* Shared helpers for the multi-season history pipeline.
 *
 * Source: github.com/vaastav/Fantasy-Premier-League (MIT) — the same open
 * dataset dev/fetch-vaastav.mjs already pulls for the backtest. This pipeline
 * reads MORE of it (every season, not just one) and reduces it to a compact
 * derived artefact; it never ships raw gameweek rows to the browser.
 *
 * Two facts about the upstream data shape everything here:
 *
 * 1. `element` is a PER-SEASON id and is NOT stable across seasons, but
 *    players_raw.csv carries `code` — FPL's permanent player id. Careers are
 *    therefore joined on `code`, never on name. That matters because the
 *    `name` column has had three different formats over the decade
 *    ("Aaron_Cresswell", "Aaron_Cresswell_376", "Aaron Cresswell") and
 *    name-matching would silently split or merge careers.
 *
 * 2. The columns available change by era. xG/xA/xGC and `position` only exist
 *    from 2022-23; `defensive_contribution` only from 2025-26. Era is detected
 *    from the header rather than hardcoded, and recorded per season so
 *    consumers can refuse to compare incomparable things.
 */

export const SEASONS = [
  '2016-17', '2017-18', '2018-19', '2019-20', '2020-21',
  '2021-22', '2022-23', '2023-24', '2024-25', '2025-26',
];

export const RAW_BASE =
  'https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data';

export const UA = 'Mozilla/5.0 (GameweekEdge history pipeline)';

/* ── CSV ─────────────────────────────────────────────────────────────── */

export function parseCsvLine(line) {
  const out = [];
  let f = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(f); f = ''; }
    else f += c;
  }
  out.push(f);
  return out;
}

/* Splits on newlines that are not inside a quoted field. The 2016-17 files
   contain quoted `news` text with embedded newlines, so a naive split('\n')
   corrupts the row alignment. */
export function splitCsvRows(text) {
  const rows = [];
  let cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { q = !q; cur += c; continue; }
    if (!q && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (cur.length) rows.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.length) rows.push(cur);
  return rows;
}

/* Parses a CSV into { header, index, rows } where rows are raw cell arrays.
   Kept row-oriented rather than object-oriented: these files run to hundreds
   of thousands of rows and building an object per row is needless garbage. */
export function parseCsv(text) {
  const rows = splitCsvRows(text);
  if (!rows.length) return { header: [], index: {}, rows: [] };
  const header = parseCsvLine(rows[0]).map((h) => h.replace(/^"|"$/g, '').trim());
  const index = {};
  header.forEach((h, i) => { index[h] = i; });
  const body = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = parseCsvLine(rows[i]);
    if (cells.length > 1) body.push(cells);
  }
  return { header, index, rows: body };
}

export const num = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/^"|"$/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export const str = (v) => String(v ?? '').replace(/^"|"$/g, '').trim();

/* ── Identity ────────────────────────────────────────────────────────── */

/* Display-name normalisation ONLY — never used to join careers (see the
   header note; `code` does that). Handles the three historical formats and
   strips diacritics so search and the guessing game behave predictably. */
export function normName(raw) {
  let s = str(raw);
  s = s.replace(/_(\d+)$/, '');          /* 2019-20..2021-22: trailing element id */
  s = s.replace(/_/g, ' ');              /* 2016-17..2021-22: underscore separator */
  return s.replace(/\s+/g, ' ').trim();
}

export function foldAccents(s) {
  return String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export const searchKey = (s) => foldAccents(normName(s)).toLowerCase();

export const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD', 5: 'MNG' };

/* ── Era detection ───────────────────────────────────────────────────── */

/* Derived from the merged_gw header rather than hardcoded, so a change
   upstream shows up as a data fact instead of a stale constant. */
export function detectEra(header) {
  const has = (c) => header.includes(c);
  return {
    xg: has('expected_goals') && has('expected_assists'),
    xgc: has('expected_goals_conceded'),
    starts: has('starts'),
    position: has('position'),
    defcon: has('defensive_contribution'),
    managers: header.some((h) => h.startsWith('mng_')),
  };
}
