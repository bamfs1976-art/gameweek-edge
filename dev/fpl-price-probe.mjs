/*
 * What the FPL API publishes about PRICE — measured, not remembered.
 *
 * WHY A SCRIPT AND NOT AN ANSWER
 * Same reason as dev/fpl-endpoint-probe.mjs: this sandbox cannot reach
 * fantasy.premierleague.com (egress answers 403), so "what does the new price
 * page call?" cannot be answered honestly from here. Answering it from
 * recollection would be presenting knowledge as verification. A runner has
 * network. This asks, and prints what came back.
 *
 * WHY A SECOND PROBE RATHER THAN MORE CANDIDATES IN THE FIRST
 * The endpoint probe answers "which endpoints exist". This answers a different
 * question — "what price data is actually populated, and is it better than the
 * threshold model we already ship?" — and that needs values, not key names. A
 * previous probe in this repo printed field names for a 503 body and called it
 * a result; the fix was to print what the fields CONTAIN. So this one prints
 * real numbers for real players.
 *
 * DISCOVERY, NOT GUESSWORK
 * The candidate list below is finite and hand-written, so absence from it
 * means "not probed", never "does not exist". To reduce how much rides on my
 * imagination, step 1 fetches the price page itself and extracts every
 * /api/-shaped string from the HTML and from the Next.js payload. Endpoints
 * found that way get probed alongside the hand-written ones and are labelled
 * DISCOVERED, so the report distinguishes what the site told us from what I
 * thought to ask.
 *
 * Read-only, unauthenticated, one pass, politely spaced. Sends no credentials,
 * probes nothing behind a login, and stores no page text beyond the URL
 * fragments it extracts.
 */

const BASE = 'https://fantasy.premierleague.com/api';
const SITE = 'https://fantasy.premierleague.com';
const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Pages that might BE the price page ───────────────────────────────
   The user reports it is live; I do not know its path. Probing several and
   reporting which answered 200 is the honest way to find out, and a 404 here
   is a real result rather than a failure. */
const PAGE_CANDIDATES = [
  '/prices', '/prices/', '/statistics', '/statistics/prices',
  '/player-list', '/price-changes', '/transfers'
];

/* ── Hand-written API candidates ──────────────────────────────────────
   Named for what they would plausibly be called. Each one that 404s is
   evidence too: it narrows where the page's data can be coming from. */
const API_CANDIDATES = [
  'element-status/',
  'price-changes/',
  'prices/',
  'stats/prices/',
  'stats/price-changes/',
  'element-prices/',
  'bootstrap-prices/',
  'this-price-endpoint-should-not-exist-xyz/'   /* negative control */
];

/* Fields in bootstrap-static's elements[] that bear on price. Printed WITH
   VALUES for named players, because "the field exists" and "the field is
   populated with something usable" are different claims and only the second
   one is worth acting on. */
const PRICE_FIELDS = [
  'now_cost', 'cost_change_event', 'cost_change_event_fall',
  'cost_change_start', 'cost_change_start_fall',
  'transfers_in', 'transfers_out', 'transfers_in_event', 'transfers_out_event',
  'selected_by_percent', 'value_form', 'value_season',
  'now_cost_rank', 'now_cost_rank_type'
];

async function get(url, { json = false } = {}) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html,application/json' },
      redirect: 'follow'
    });
    const ct = (r.headers.get('content-type') || '').split(';')[0];
    const body = await r.text();
    return { url, status: r.status, contentType: ct, bytes: body.length, body, finalUrl: r.url };
  } catch (e) {
    return { url, status: null, error: String((e && e.message) || e) };
  }
}

/* Every /api/-shaped path the page mentions. Deliberately greedy about the
   shape and then de-duplicated: a missed endpoint costs us the whole point of
   the discovery step, while a spurious one costs one extra 404 line. */
function apiPathsIn(text) {
  const out = new Set();
  const res = [
    /["'`](?:https?:\/\/fantasy\.premierleague\.com)?\/api\/([a-z0-9\-_/{}$.:]+)["'`]/gi,
    /\/api\/([a-z0-9\-_]+(?:\/[a-z0-9\-_{}$.:]+)*)\/?/gi
  ];
  for (const re of res) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const p = m[1].replace(/^\/+|\/+$/g, '');
      if (p && p.length < 80) out.add(p);
    }
  }
  return [...out];
}

const shapeOf = (body, ct) => {
  if (!/json/i.test(ct)) return { kind: 'not-json', bytes: body.length };
  let d;
  try { d = JSON.parse(body); } catch { return { kind: 'unparseable-json', bytes: body.length }; }
  if (Array.isArray(d)) {
    const f = d[0];
    return { kind: 'array', length: d.length,
      sampleKeys: f && typeof f === 'object' ? Object.keys(f).slice(0, 40) : null,
      sampleRow: f && typeof f === 'object' ? f : null };
  }
  if (d && typeof d === 'object') {
    const keys = Object.keys(d);
    const arrays = {};
    for (const k of keys) if (Array.isArray(d[k])) arrays[k] = d[k].length;
    return { kind: 'object', keys: keys.slice(0, 40), arrayCounts: arrays };
  }
  return { kind: typeof d };
};

const pad = (s, n) => String(s).padEnd(n);
const mark = (r) => (r.status === 200 && /json/i.test(r.contentType || '') ? '✓'
  : r.status === 200 ? '·' : r.status === null ? '!' : '✗');

async function probeApi(p, label) {
  const r = await get(`${BASE}/${p}`, { json: true });
  const rec = { path: p, label, status: r.status, contentType: r.contentType,
    bytes: r.bytes, error: r.error,
    shape: r.status === 200 ? shapeOf(r.body, r.contentType || '') : null };
  console.log(`  ${mark(rec)} ${pad(p, 44)} ${pad(rec.status ?? 'ERR', 5)} ${pad(rec.contentType || '', 18)} ${label}`);
  return rec;
}

const results = { probedAt: new Date().toISOString(), pages: [], discovered: [], api: [],
  bootstrap: null, elementSummary: null };

console.log('=== 1. WHERE IS THE PRICE PAGE ===\n');
for (const p of PAGE_CANDIDATES) {
  const r = await get(SITE + p);
  const rec = { path: p, status: r.status, contentType: r.contentType, bytes: r.bytes,
    finalUrl: r.finalUrl, error: r.error };
  results.pages.push(rec);
  console.log(`  ${mark(rec)} ${pad(p, 24)} ${pad(rec.status ?? 'ERR', 5)} ${pad(rec.contentType || '', 12)} ${rec.bytes ?? ''} bytes${
    r.finalUrl && r.finalUrl !== SITE + p ? '  → ' + r.finalUrl : ''}`);
  if (r.status === 200 && r.body) {
    for (const a of apiPathsIn(r.body)) results.discovered.push({ from: p, api: a });
  }
  await sleep(500);
}

const discovered = [...new Set(results.discovered.map((d) => d.api))];
console.log(`\n  ${discovered.length} distinct /api/ path(s) referenced by those pages:`);
for (const d of discovered) console.log('    · ' + d);
if (!discovered.length) {
  console.log('    (none — the pages are a client-side bundle, so the calls are in JS,');
  console.log('     not the served HTML. The hand-written candidates below carry the weight.)');
}

console.log('\n=== 2. CANDIDATE PRICE ENDPOINTS ===\n');
for (const p of API_CANDIDATES) { results.api.push(await probeApi(p, 'guessed')); await sleep(400); }
/* Only concrete paths — a discovered template like entry/{id} cannot be
   fetched, and pretending otherwise would put a fake 404 in the report. */
for (const p of discovered) {
  if (/[{}$:]/.test(p)) { console.log(`  – ${pad(p, 44)} ${pad('—', 5)} ${pad('', 18)} templated, not fetchable`); continue; }
  if (API_CANDIDATES.includes(p + '/') || API_CANDIDATES.includes(p)) continue;
  results.api.push(await probeApi(p.endsWith('/') ? p : p + '/', 'DISCOVERED'));
  await sleep(400);
}

console.log('\n=== 3. WHAT BOOTSTRAP-STATIC CARRIES ABOUT PRICE, WITH VALUES ===\n');
const bs = await get(`${BASE}/bootstrap-static/`, { json: true });
if (bs.status !== 200 || !/json/i.test(bs.contentType || '')) {
  console.log(`  ✗ bootstrap-static answered ${bs.status} ${bs.contentType || ''} — nothing below can be trusted.`);
} else {
  const b = JSON.parse(bs.body);
  const els = b.elements || [];
  const present = PRICE_FIELDS.filter((f) => els[0] && Object.prototype.hasOwnProperty.call(els[0], f));
  const missing = PRICE_FIELDS.filter((f) => !present.includes(f));
  console.log(`  elements: ${els.length}   total_players: ${b.total_players}`);
  console.log(`  price fields present: ${present.length}/${PRICE_FIELDS.length}`);
  if (missing.length) console.log(`  ABSENT: ${missing.join(', ')}`);

  /* Populated is the question, not present. A column of zeroes is a column
     we cannot build on, and it looks identical to a healthy one in a key
     list. */
  console.log('\n  field                     non-zero   min        max        e.g.');
  for (const f of present) {
    const vals = els.map((e) => Number(e[f])).filter((v) => Number.isFinite(v));
    const nz = vals.filter((v) => v !== 0).length;
    const ex = els.find((e) => Number(e[f]) !== 0);
    console.log(`  ${pad(f, 25)} ${pad(nz + '/' + vals.length, 10)} ${pad(Math.min(...vals), 10)} ${pad(Math.max(...vals), 10)} ${
      ex ? ex.web_name + '=' + ex[f] : '—'}`);
  }

  /* The movers the API itself reports, so the report shows real rows rather
     than asserting that the data would be usable. */
  const byRise = els.slice().sort((a, c) => (c.cost_change_event || 0) - (a.cost_change_event || 0)).slice(0, 8);
  const byFall = els.slice().sort((a, c) => (a.cost_change_event || 0) - (c.cost_change_event || 0)).slice(0, 8);
  const row = (e) => `    ${pad(e.web_name, 18)} now ${pad((e.now_cost / 10).toFixed(1), 6)} Δevent ${pad(e.cost_change_event, 4)} Δstart ${pad(e.cost_change_start, 4)} net ${pad((e.transfers_in_event || 0) - (e.transfers_out_event || 0), 9)} own ${e.selected_by_percent}%`;
  console.log('\n  biggest cost_change_event RISES this gameweek:');
  byRise.forEach((e) => console.log(row(e)));
  console.log('\n  biggest cost_change_event FALLS this gameweek:');
  byFall.forEach((e) => console.log(row(e)));

  const moved = els.filter((e) => (e.cost_change_event || 0) !== 0).length;
  const movedSeason = els.filter((e) => (e.cost_change_start || 0) !== 0).length;
  console.log(`\n  ${moved} player(s) have moved price this gameweek; ${movedSeason} since the season started.`);
  results.bootstrap = { elements: els.length, total_players: b.total_players, present, missing, moved, movedSeason };

  /* ── element-summary carries the OWNER COUNT ──────────────────────
     Our shipped model estimates owners as total_players × selected_by_percent,
     because that is all bootstrap gives. If history rows carry `selected`,
     that is the real denominator the threshold scales with, and the gap
     between the two is measurable rather than assumed. Checked on a real,
     heavily-owned player. */
  const target = els.slice().sort((a, c) => parseFloat(c.selected_by_percent) - parseFloat(a.selected_by_percent))[0];
  if (target) {
    await sleep(500);
    const es = await get(`${BASE}/element-summary/${target.id}/`, { json: true });
    console.log(`\n  element-summary/${target.id}/ (${target.web_name}, most-owned at ${target.selected_by_percent}%): ${es.status} ${es.contentType || ''}`);
    if (es.status === 200 && /json/i.test(es.contentType || '')) {
      const d = JSON.parse(es.body);
      const h = (d.history || [])[(d.history || []).length - 1];
      console.log(`    top-level keys: ${Object.keys(d).join(', ')}`);
      console.log(`    history rows: ${(d.history || []).length}   history_past: ${(d.history_past || []).length}`);
      if (h) {
        console.log(`    latest history row keys: ${Object.keys(h).join(', ')}`);
        const est = Math.round(b.total_players * parseFloat(target.selected_by_percent) / 100);
        console.log(`    value=${h.value}  transfers_balance=${h.transfers_balance}  transfers_in=${h.transfers_in}  transfers_out=${h.transfers_out}`);
        if (h.selected != null) {
          console.log(`    selected=${h.selected}  (our model estimates ${est} owners — off by ${(((est - h.selected) / h.selected) * 100).toFixed(1)}%)`);
        } else {
          console.log(`    selected: ABSENT — the owner count is not published here, so the estimate stands.`);
        }
        results.elementSummary = { id: target.id, name: target.web_name, keys: Object.keys(h),
          selected: h.selected ?? null, estimate: est };
      }
    }
  }
}

console.log('\n=== DETAIL (JSON) ===');
console.log(JSON.stringify(results, null, 2));

/* ── Conclusions last is wrong for a CI log; people tail. But the detail
   dump above is what makes them checkable, so it stays, and the summary is
   repeated here where a tail will find it. ── */
console.log('\n=== SUMMARY ===');
const livePages = results.pages.filter((p) => p.status === 200);
const liveApi = results.api.filter((r) => r.status === 200 && /json/i.test(r.contentType || ''));
const control = results.api.find((r) => r.path.startsWith('this-price-endpoint-should-not'));
console.log(`  pages probed: ${results.pages.length}, answering 200: ${livePages.length}` +
  (livePages.length ? ' (' + livePages.map((p) => p.path).join(', ') + ')' : ''));
console.log(`  api paths probed: ${results.api.length}, serving JSON: ${liveApi.length}` +
  (liveApi.length ? ' (' + liveApi.map((r) => r.path).join(', ') + ')' : ''));
console.log(`  discovered from page HTML: ${discovered.length}`);
console.log(`  negative control: ${control ? control.status : 'MISSING'}` +
  (control && control.status === 404 ? ' (404 — a 404 in this run means absent, not blocked)'
    : ' — TREAT EVERY 404 ABOVE WITH SUSPICION, the control did not behave'));
console.log('\n  Absence from the candidate list is not evidence of absence from the API.');
