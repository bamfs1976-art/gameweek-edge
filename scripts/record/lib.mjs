/* ═══════════════════════════════════════════════════════════
   GAMEWEEK EDGE — the FPL ledger's plumbing.

   The Fantasy Premier League twin of scripts/efl/lib.mjs, and the same
   rule: a pick recorded after the deadline is not a prediction, it is a
   memory. The recorder REFUSES to write an entry whose deadline has passed
   and refuses to overwrite one that exists. There is no flag for either.

   Everything with a side effect — fetching, reading, writing — lives here
   so scripts/record/metrics.mjs stays pure and testable.
   ═══════════════════════════════════════════════════════════ */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildEngine } from '../extract-engine.mjs';
import { extractFn } from '../../dev/extract.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/* Overridable only so an end-to-end run can point at a scratch directory. */
export const LEDGER_DIR = process.env.FPL_LEDGER_DIR || join(ROOT, 'data', 'record');

/* The site's own proxy, not the upstream: it is the exact path a visitor's
   browser takes, so the ledger measures the data the site serves. Override
   for a local run against dev/mock_fpl.py (FPL_API_BASE=http://127.0.0.1:8700/api/fpl). */
export const API_BASE = process.env.FPL_API_BASE || 'https://gameweekedge.co.uk/api/fpl';

export async function fetchJson(path, base = API_BASE, fetchImpl = fetch) {
  const url = `${base.replace(/\/$/, '')}/${path}`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'gameweek-edge-record/1.0' } });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
}

/* ── The model, as it ships ───────────────────────────────
   The Team of the Week, the captain and the price calls are built by the
   SAME functions index.html runs — lifted out of the file by the extractor
   the tests use, not re-implemented. A ledger that graded a copy would
   measure the wrong thing. */
export function loadModel(html = readFileSync(join(ROOT, 'index.html'), 'utf8')) {
  const ctx = { window: {}, console, Date, Math, JSON, parseFloat, parseInt, Number, isFinite, Array, Object, String };
  vm.createContext(ctx);
  new vm.Script(buildEngine(html)).runInContext(ctx);
  Object.assign(ctx, ctx.window.GEEngine);
  const extras = ['esc', 'teamShort', 'posShort', 'fixtureOver', 'fixtureToCome', 'plsimDiff',
    'buildNextFix', 'xP', 'scoutScored', 'captainEligible', 'captainBand', 'captainModel',
    'priceChangeProb'];
  new vm.Script(extras.map((n) => extractFn(html, n)).join('\n')
    + '\nwindow.__model = {' + extras.join(',') + '};').runInContext(ctx);
  return Object.assign({}, ctx.window.GEEngine, ctx.window.__model);
}

/* The index the app's functions read: a superset of the daily-content
   renderer's, with the per-id maps buildNextFix and teamShort want. */
export function buildIndex(boot, fixtures) {
  const teams = {}, els = {}, types = {};
  (boot.teams || []).forEach((t) => { teams[t.id] = t; });
  (boot.elements || []).forEach((e) => { els[e.id] = e; });
  (boot.element_types || []).forEach((t) => { types[t.id] = t; });
  return { raw: boot, teams, els, types, elements: boot.elements || [], events: boot.events || [],
    fixtures: fixtures || [], euro: null };
}

/* ── Gameweeks ──────────────────────────────────────────── */
export const deadlineOf = (ev) => Date.parse(ev && ev.deadline_time);

/** The gameweek to record for: the earliest whose deadline is still ahead. */
export function openEvent(events, now = Date.now()) {
  return (events || [])
    .filter((e) => e && !e.finished && Number.isFinite(deadlineOf(e)) && deadlineOf(e) > now)
    .sort((a, b) => deadlineOf(a) - deadlineOf(b))[0] || null;
}

/** Has FPL finished scoring this gameweek? Both flags, because `finished`
    alone flips before bonus is confirmed on some weeks and `data_checked`
    is the one FPL sets when the numbers are final. */
export function eventSettled(events, gw) {
  const ev = (events || []).find((e) => Number(e.id) === Number(gw));
  return !!(ev && ev.finished && ev.data_checked !== false);
}

/* ── The ledger on disk ───────────────────────────────────
   One file per gameweek: data/record/gw-NN.json. */
export const entryPath = (gw) => join(LEDGER_DIR, `gw-${String(gw).padStart(2, '0')}.json`);

export async function readEntry(gw) {
  try { return JSON.parse(await readFile(entryPath(gw), 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}

export async function readLedger() {
  let names = [];
  try { names = await readdir(LEDGER_DIR); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  const out = [];
  for (const name of names.filter((n) => /^gw-\d+\.json$/.test(n)).sort()) {
    out.push(JSON.parse(await readFile(join(LEDGER_DIR, name), 'utf8')));
  }
  return out.sort((a, b) => a.gw - b.gw);
}

export async function writeEntry(entry) {
  await mkdir(LEDGER_DIR, { recursive: true });
  await writeFile(entryPath(entry.gw), `${JSON.stringify(entry, null, 2)}\n`);
  return entryPath(entry.gw);
}

/* ── Refusals ─────────────────────────────────────────────
   One place defines "too late" and "too early". */
export const RECORD_WINDOW_HOURS = 36;

/** May picks for this gameweek be written now? */
export function canRecord({ event, existing, now = Date.now() }) {
  if (!event) return { ok: false, reason: 'no gameweek is open — the season may be over', hoursBeforeDeadline: null };
  const dl = deadlineOf(event);
  if (!Number.isFinite(dl)) return { ok: false, reason: `gameweek ${event.id} has no readable deadline`, hoursBeforeDeadline: null };
  const hours = (dl - now) / 3600000;
  if (existing) {
    return { ok: false, reason: `gameweek ${event.id} was already recorded at ${existing.recordedAt} — the ledger is append-only`, hoursBeforeDeadline: hours };
  }
  if (hours <= 0) {
    return { ok: false, reason: `gameweek ${event.id} locked ${Math.abs(hours).toFixed(1)}h ago — a pick recorded after the deadline is not a prediction`, hoursBeforeDeadline: hours };
  }
  if (hours > RECORD_WINDOW_HOURS) {
    return { ok: false, reason: `gameweek ${event.id} locks in ${hours.toFixed(1)}h — too early, team news is still to come`, hoursBeforeDeadline: hours };
  }
  return { ok: true, reason: `gameweek ${event.id} locks in ${hours.toFixed(1)}h`, hoursBeforeDeadline: hours };
}

/** Which recorded gameweeks are ready to be graded. */
export function gradable(entries, events) {
  return (entries || []).filter((e) => e && !e.result && eventSettled(events, e.gw));
}
