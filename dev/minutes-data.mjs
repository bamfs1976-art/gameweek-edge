/*
 * Point-in-time minutes examples from a vaastav merged_gw season, shared by
 * dev/fit-minutes.mjs (which fits the learned minutes model) and
 * dev/backtest-minutes.mjs (which grades it on a season the fit never saw).
 *
 * One example per player-fixture. Everything the model is shown comes from
 * fixtures that kicked off strictly earlier: rows are walked in kickoff
 * order, and a whole kickoff slot is scored before any of it is folded in, so
 * a 3pm game cannot see another 3pm game's team sheet.
 *
 * `gp` is the player's club's matches since he joined it, the same
 * denominator the app uses (`played[team]`), NOT his own appearances. The
 * older real-actuals harness divides by appearances, which flatters every
 * start share it computes; a minutes model graded that way would be graded
 * on a question the app never asks.
 */
import { readFileSync } from 'node:fs';

export function parseCsvLine(line) {
  const out = []; let f = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(f); f = ''; }
    else f += c;
  }
  out.push(f); return out;
}

const POS = { GK: 1, GKP: 1, DEF: 2, MID: 3, FWD: 4 };
export const MINUTES_COLUMNS = ['element', 'position', 'team', 'fixture', 'kickoff_time', 'GW', 'minutes', 'starts', 'value'];

export function loadRows(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const head = parseCsvLine(lines[0]);
  const c = Object.fromEntries(head.map((k, i) => [k, i]));
  for (const k of MINUTES_COLUMNS) if (c[k] == null) throw new Error(`${path}: missing column ${k}`);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const x = parseCsvLine(lines[i]);
    const type = POS[(x[c.position] || '').trim()];
    const el = parseInt(x[c.element], 10), gw = parseInt(x[c.GW], 10);
    if (!type || !Number.isFinite(el) || !Number.isFinite(gw)) continue;
    rows.push({ el, type, team: x[c.team], fx: x[c.fixture], t: x[c.kickoff_time], gw,
      min: +x[c.minutes] || 0, st: +x[c.starts] || 0, val: +x[c.value] || 0 });
  }
  rows.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.el - b.el));
  return rows;
}

/* recentMinutes is the app's own (extracted from index.html), so the history
   summary the model is fitted on is the one it is fed live. */
export function examples(rows, recentMinutes) {
  const teamGames = {}, seen = new Set(), P = {}, out = [];
  for (let i = 0; i < rows.length;) {
    let j = i; while (j < rows.length && rows[j].t === rows[i].t) j++;
    const batch = rows.slice(i, j);
    for (const r of batch) {
      let p = P[r.el];
      if (!p || p.team !== r.team) p = P[r.el] = { team: r.team, joined: teamGames[r.team] || 0, min: 0, st: 0, hist: [] };
      const gp = (teamGames[r.team] || 0) - p.joined;
      if (gp < 1) continue;                       /* no club history yet: the app has nothing to say either */
      const hist = p.hist.slice(-5);
      out.push({
        gp, type: r.type,
        el: { starts: p.st, minutes: p.min, element_type: r.type, now_cost: r.val,
          _recent: hist.length ? recentMinutes(hist, 5) : null },
        y: { start: r.st > 0 ? 1 : 0, app: r.min > 0 ? 1 : 0, p60: r.min >= 60 ? 1 : 0 },
      });
    }
    for (const r of batch) {
      const p = P[r.el];
      if (p && p.team === r.team) { p.min += r.min; p.st += r.st; p.hist.push({ round: r.gw, starts: r.st, minutes: r.min }); }
      const k = r.team + '|' + r.fx;
      if (!seen.has(k)) { seen.add(k); teamGames[r.team] = (teamGames[r.team] || 0) + 1; }
    }
    i = j;
  }
  return out;
}

/* Log loss, Brier score and AUC for probabilities `ps` against 0/1 `ys`. */
export function score(ps, ys) {
  const n = ps.length; let ll = 0, br = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.min(1 - 1e-6, Math.max(1e-6, ps[i]));
    ll -= ys[i] * Math.log(p) + (1 - ys[i]) * Math.log(1 - p);
    br += (p - ys[i]) ** 2;
  }
  const idx = [...ps.keys()].sort((a, b) => ps[a] - ps[b]);
  let pos = 0, sumR = 0;
  for (let i = 0; i < n;) {
    let j = i; while (j < n && ps[idx[j]] === ps[idx[i]]) j++;
    const avg = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (ys[idx[k]]) { sumR += avg; pos++; }
    i = j;
  }
  const auc = pos && pos < n ? (sumR - pos * (pos + 1) / 2) / (pos * (n - pos)) : NaN;
  return { n, ll: ll / n, brier: br / n, auc };
}
