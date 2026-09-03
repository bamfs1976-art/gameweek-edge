/*
 * Is dev/mock_fpl.py telling the truth about the FPL API?
 *
 * WHY THIS FILE EXISTS. Every FPL-shaped bug this app has shipped was a bug
 * about what a field MEANS, or whether it is there at all, at some particular
 * moment of a matchday — `event_total` and `total` frozen until FPL scores the
 * week, `overall_rank` null while it is being scored, `finished` and
 * `finished_provisional` settling in two stages, live BPS all zeros at
 * kick-off. Not one of them was caught by the suite. They were caught by
 * somebody opening the site.
 *
 * The suite could not catch them because the only FPL it has ever talked to is
 * dev/mock_fpl.py, and the mock was written from the same understanding as the
 * code it exercises. Where that understanding was wrong the mock was wrong the
 * same way, so the test agreed with the bug. Three times the mock simply did
 * not serve a field the real API serves — no overall_rank, no transfers_made
 * or chip_plays, a full 38-row history during gameweek one — and each silence
 * hid something live.
 *
 * So this file introduces a witness that did not come from us:
 * dev/fixtures/fpl-openapi.json, an unofficial OpenAPI description of the FPL
 * API vendored by scripts/vendor-fpl-spec.mjs. It was written by a stranger
 * from the real API, so where it and the mock disagree, one of them is wrong,
 * and which one is a question worth answering.
 *
 * WHAT IT CHECKS, AND HOW HARD
 *
 *   1. REACHABILITY (hard fail). Every endpoint index.html actually requests
 *      must answer 200 from the mock. This is the cheapest check here and it
 *      caught a real one immediately: the app asks for `team/set-piece-notes`
 *      and the mock only answered to `set-piece-notes`, so that fetch had
 *      never once succeeded under test and only the failure branch was ever
 *      exercised.
 *
 *   2. TYPES (hard fail). Where the spec says integer and the mock says
 *      "0", something downstream is one `+` away from string concatenation.
 *      The spec earns this severity: it distinguishes the season totals the
 *      real API serves as strings (`expected_goals`, `ict_index`) from the
 *      per-90 derivatives it serves as numbers (`expected_goals_per_90`).
 *      That distinction is peculiar enough that nobody reproduces it by
 *      accident, which is the evidence that this spec was read off the wire
 *      rather than guessed.
 *
 *   3. COVERAGE (ratchet). The mock omits a lot the real API sends, and most
 *      of it this app never reads, so failing on all of it would be a check
 *      nobody could keep green. Instead the count per endpoint is pinned in
 *      BASELINE below: it may fall, and lowering the number is part of the
 *      fix, but it may never rise. The gaps are printed either way, because
 *      the number that matters is visible rather than merely enforced.
 *
 *   4. INVENTIONS (advisory). Fields the mock serves that the spec has never
 *      heard of, filtered to those index.html reads. These are the dangerous
 *      direction of the same problem: if the mock made a field up and the app
 *      reads it, the app depends on something the real API may not send, and
 *      the suite will never say so.
 *
 * WHAT IT WILL NOT DO. Hard-fail on a null. The spec declares no nullable
 * types anywhere — it types `overall_rank` as a plain required integer, which
 * is precisely the field whose null this app shipped a bug over. On
 * nullability the mock is the better witness and the spec is the one that is
 * wrong, so nulls are reported and never fatal. A check that is wrong loudly
 * gets deleted, and then the checks that were right go with it.
 *
 * Coverage is printed. The spec does not describe every endpoint the app calls
 * — `leagues-h2h/{}/standings` and `.../matches` are not in it — so an absence
 * from the findings means "not checked", never "checked and clean".
 *
 * Run: node dev/test-fpl-contract.mjs   (wired into npm test)
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8737;
const BASE = 'http://127.0.0.1:' + PORT;

/* ── the endpoints the app actually calls ──────────────────────────────────
 *
 * `call` is the normalised shape of an api() argument in index.html, and it is
 * checked against the file rather than trusted: if somebody adds an endpoint
 * and does not add it here, this test says so instead of quietly not covering
 * it. `spec` is null where the spec does not document the endpoint — that is
 * recorded, not hidden.
 */
const CALLS = [
  { call: 'bootstrap-static',              url: 'bootstrap-static/',                spec: '/bootstrap-static/' },
  { call: 'fixtures',                      url: 'fixtures/',                        spec: '/fixtures/' },
  { call: 'event-status',                  url: 'event-status/',                    spec: '/event-status/' },
  { call: 'team/set-piece-notes',          url: 'team/set-piece-notes/',            spec: '/team/set-piece-notes/' },
  { call: 'entry/{}',                      url: 'entry/123456/',                    spec: '/entry/{manager_id}/' },
  { call: 'entry/{}/history',              url: 'entry/123456/history/',            spec: '/entry/{manager_id}/history/' },
  { call: 'entry/{}/event/{}/picks',       url: 'entry/123456/event/1/picks/',      spec: '/entry/{manager_id}/event/{event_id}/picks/' },
  { call: 'entry/{}/transfers',            url: 'entry/123456/transfers/',          spec: '/entry/{manager_id}/transfers/' },
  { call: 'event/{}/live',                 url: 'event/1/live/',                    spec: '/event/{event_id}/live/' },
  { call: 'element-summary/{}',            url: 'element-summary/1/',               spec: '/element-summary/{element_id}/' },
  { call: 'dream-team/{}',                 url: 'dream-team/1/',                    spec: '/dream-team/{event_id}/' },
  { call: 'leagues-classic/{}/standings',  url: 'leagues-classic/314/standings/',   spec: '/leagues-classic/{league_id}/standings/' },
  /* Not in the spec. The document describes /leagues-h2h-matches/league/{id}/,
     which is a different endpoint from the two the app uses. */
  { call: 'leagues-h2h/{}/standings',      url: 'leagues-h2h/55/standings/',        spec: null },
  { call: 'leagues-h2h/{}/matches',        url: 'leagues-h2h/55/matches/',          spec: null },
];

/* Declared properties the mock does not serve, per endpoint. May fall, never
 * rise. Lower the number in the same commit that closes the gap — a baseline
 * left above the truth is a ratchet with the pawl filed off. */
const BASELINE = {
  '/bootstrap-static/': 63,
  '/fixtures/': 5,
  '/event-status/': 0,
  '/team/set-piece-notes/': 0,
  '/entry/{manager_id}/': 44,
  '/entry/{manager_id}/history/': 0,
  '/entry/{manager_id}/event/{event_id}/picks/': 0,
  '/entry/{manager_id}/transfers/': 0,
  '/event/{event_id}/live/': 15,
  '/element-summary/{element_id}/': 50,
  '/dream-team/{event_id}/': 0,
  '/leagues-classic/{league_id}/standings/': 18,
};

const results = [];
const check = (name, ok, detail) => {
  results.push(!!ok);
  console.log(`${ok ? '✓' : '✗'} ${name}` + (ok || !detail ? '' : `\n    ${detail}`));
};

/* ── the vendored spec ─────────────────────────────────────────────────── */
const SPEC_PATH = join(REPO, 'dev', 'fixtures', 'fpl-openapi.json');
if (!existsSync(SPEC_PATH)) {
  console.log('· FPL contract: no vendored spec — run: node scripts/vendor-fpl-spec.mjs');
  process.exit(1);
}
const VENDORED = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
const SPEC = VENDORED.spec;

/* The spec uses a small slice of JSON Schema — type, properties, required,
 * items, $ref — and nothing else. Resolving refs is therefore this much. */
const deref = (s, seen = 0) => {
  while (s && typeof s === 'object' && s.$ref && seen < 20) {
    s = SPEC.components.schemas[s.$ref.split('/').pop()];
    seen++;
  }
  return s;
};
const responseSchema = (p) => {
  const g = ((SPEC.paths || {})[p] || {}).get;
  const c = g && g.responses && g.responses['200'] && g.responses['200'].content;
  return (c && c['application/json'] && c['application/json'].schema) || null;
};

/* ── the app's own call sites, so this table cannot go stale ───────────── */
function appCalls() {
  const html = readFileSync(join(REPO, 'index.html'), 'utf8');
  const found = new Set();
  /* Every api(...) whose argument starts with a string literal. The argument
     is a concatenation of literals and expressions; each literal contributes
     itself and each gap between them contributes a placeholder, which turns
     'entry/'+id+'/history' into entry/{}/history. */
  for (const m of html.matchAll(/\bapi\((['"`])([\s\S]*?)\)\s*[,;)]/g)) {
    const arg = m[1] + m[2];
    let out = '', i = 0;
    while (i < arg.length) {
      const q = arg[i];
      if (q === "'" || q === '"' || q === '`') {
        let j = i + 1, lit = '';
        while (j < arg.length && arg[j] !== q) { lit += arg[j]; j++; }
        out += lit; i = j + 1;
      } else {
        let j = i;
        while (j < arg.length && !`'"\``.includes(arg[j])) j++;
        if (arg.slice(i, j).trim()) out += '{}';
        i = j;
      }
    }
    /* A trailing placeholder is only ever the residue of the optional-page
       ternary — 'leagues-classic/'+id+'/standings'+(page>1?'?page='+page:'')
       leaves one where the ternary opened. Strip it only when a query string
       was actually cut, or 'entry/'+id normalises down to 'entry/'. */
    const q = out.indexOf('?');
    if (q >= 0) out = out.slice(0, q).replace(/\{\}$/, '');
    if (out) found.add(out);
  }
  return found;
}

/* ── the comparison ────────────────────────────────────────────────────── */
function compare(schema, value, at, out) {
  const s = deref(schema);
  if (!s || typeof s !== 'object') return;
  const t = s.type;

  if (value === null || value === undefined) {
    /* The spec models no nullable types at all, so this is the spec's gap
       rather than the mock's. Recorded, never fatal. */
    if (t) out.nulls.add(`${at} (spec ${t})`);
    return;
  }
  if (t === 'array' || (!t && s.items)) {
    if (!Array.isArray(value)) { out.types.add(`${at}: spec array, mock ${typeof value}`); return; }
    /* Three items is enough to catch a field that is absent throughout and
       cheap enough to keep the run instant. */
    for (const v of value.slice(0, 3)) compare(s.items || {}, v, at + '[]', out);
    return;
  }
  if (t === 'object' || s.properties) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      out.types.add(`${at}: spec object, mock ${Array.isArray(value) ? 'array' : typeof value}`);
      return;
    }
    const props = s.properties || {};
    const req = new Set(s.required || []);
    for (const [k, ps] of Object.entries(props)) {
      if (!(k in value)) out.missing.set(`${at}.${k}`, req.has(k));
      else compare(ps, value[k], `${at}.${k}`, out);
    }
    for (const k of Object.keys(value)) {
      if (!(k in props)) out.extra.add(`${at}.${k}`);
    }
    return;
  }
  const got = value === true || value === false ? 'boolean'
    : Number.isInteger(value) ? 'integer'
    : typeof value === 'number' ? 'number'
    : typeof value;
  /* An integer is a valid number; the reverse is not true. */
  if (t === 'number' && got === 'integer') return;
  if (t && t !== got) {
    out.types.add(`${at}: spec ${t}, mock ${got} ${JSON.stringify(value).slice(0, 24)}`);
  }
}

/* ── the mock ──────────────────────────────────────────────────────────── */
if (spawnSync('python3', ['-c', 'import sys'], { stdio: 'ignore' }).status !== 0) {
  console.log('· FPL contract: python3 unavailable, skipped'); process.exit(0);
}
if (!existsSync(join(REPO, 'dev', 'mock_fpl.py'))) {
  console.log('· FPL contract: mock server missing, skipped'); process.exit(0);
}

let mock = null, up = false;
const NOPROXY = { ...process.env, PORT: String(PORT), no_proxy: '127.0.0.1', NO_PROXY: '127.0.0.1' };
try { up = (await fetch(BASE + '/api/fpl/bootstrap-static/')).ok; } catch (_) {}
if (!up) {
  mock = spawn('python3', [join(REPO, 'dev', 'mock_fpl.py')], { cwd: REPO, env: NOPROXY, stdio: 'ignore' });
  for (let i = 0; i < 40 && !up; i++) {
    try { up = (await fetch(BASE + '/api/fpl/bootstrap-static/')).ok; }
    catch (_) { await new Promise(r => setTimeout(r, 250)); }
  }
}
const stop = () => { if (mock) { try { mock.kill(); } catch (_) {} } };
process.on('exit', stop);
if (!up) { stop(); console.log('· FPL contract: mock server did not start, skipped'); process.exit(0); }

/* ── 0. the table describes the app ────────────────────────────────────── */
console.log(`\nthe call table matches index.html`);
{
  const actual = appCalls();
  const listed = new Set(CALLS.map(c => c.call));
  const unlisted = [...actual].filter(c => !listed.has(c));
  const stale = [...listed].filter(c => !actual.has(c));
  check('every endpoint index.html requests is in the table', unlisted.length === 0,
    'not listed, so not checked: ' + unlisted.join(', '));
  check('and the table lists nothing the app no longer requests', stale.length === 0,
    'listed but never called: ' + stale.join(', '));
}

/* ── 1. reachability ───────────────────────────────────────────────────── */
console.log(`\nthe mock answers every endpoint the app requests`);
const bodies = new Map();
for (const c of CALLS) {
  let status = 0, body = null;
  try {
    const r = await fetch(BASE + '/api/fpl/' + c.url);
    status = r.status;
    if (r.ok) body = await r.json();
  } catch (e) { status = String(e.message).slice(0, 40); }
  bodies.set(c.call, body);
  check(`${c.call} answers 200`, status === 200, `got ${status} for /api/fpl/${c.url}`);
}

/* ── 2-4. the comparison, per endpoint ─────────────────────────────────── */
const html = readFileSync(join(REPO, 'index.html'), 'utf8');
const readByApp = (name) =>
  new RegExp('[.\\[][\'"]?' + name.replace(/[^\w]/g, '\\$&') + '[\'"\\]]?[^\\w]').test(html);

const totals = { types: [], missing: 0, nulls: [], inventions: [] };
const uncovered = [];

console.log(`\nthe mock serves what the spec describes`);
for (const c of CALLS) {
  const body = bodies.get(c.call);
  if (!c.spec) { uncovered.push(c.call); continue; }
  const schema = responseSchema(c.spec);
  if (!schema) { uncovered.push(c.call + ' (path in spec, no 200 schema)'); continue; }
  if (body === null) continue;   /* already failed reachability */

  const out = { missing: new Map(), types: new Set(), nulls: new Set(), extra: new Set() };
  compare(schema, body, c.spec.replace(/\/$/, ''), out);

  const base = BASELINE[c.spec];
  const n = out.missing.size;
  totals.missing += n;
  totals.types.push(...out.types);
  totals.nulls.push(...out.nulls);
  for (const e of out.extra) if (readByApp(e.split('.').pop())) totals.inventions.push(e);

  check(`${c.call}: no type disagreement`, out.types.size === 0,
    [...out.types].join('\n    '));
  if (base === undefined) {
    check(`${c.call}: has a recorded coverage baseline`, false,
      `add '${c.spec}': ${n} to BASELINE`);
  } else if (n > base) {
    check(`${c.call}: coverage has not regressed`, false,
      `${n} declared fields unserved, baseline ${base} — newly missing:\n    ` +
      [...out.missing.keys()].slice(0, 8).join('\n    '));
  } else if (n < base) {
    check(`${c.call}: the baseline matches the gap`, false,
      `only ${n} fields missing now, baseline still says ${base} — lower it to ${n}`);
  } else {
    check(`${c.call}: coverage holds at ${n} unserved field${n === 1 ? '' : 's'}`, true);
  }
}

/* ── what was not checked, and what is merely worth knowing ────────────── */
console.log(`\ncoverage`);
console.log(`  spec: ${VENDORED._source}`);
console.log(`  checked ${CALLS.length - uncovered.length} of ${CALLS.length} endpoints the app calls`);
if (uncovered.length) {
  console.log(`  NOT described by the spec, so NOT checked here:`);
  for (const u of uncovered) console.log(`    · ${u}`);
}
console.log(`  ${totals.missing} declared field${totals.missing === 1 ? '' : 's'} the mock does not serve` +
  ` — tests touching them prove less than they appear to`);

if (totals.nulls.length) {
  console.log(`\n  ${totals.nulls.length} field(s) the mock nulls where the spec declares a scalar.`);
  console.log(`  The spec models no nullable types anywhere, so these are almost certainly`);
  console.log(`  the spec's gap and not the mock's — not failed, listed:`);
  for (const n of totals.nulls.slice(0, 12)) console.log(`    · ${n}`);
}
if (totals.inventions.length) {
  console.log(`\n  ${totals.inventions.length} field(s) the mock serves, the spec does not know, and index.html reads.`);
  console.log(`  If the mock invented these, the app is reading something the real API may not send:`);
  for (const i of totals.inventions.slice(0, 12)) console.log(`    · ${i}`);
}

await new Promise(r => setTimeout(r, 50));
stop();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
