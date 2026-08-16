/*
 * What the official FPL API actually serves today — measured, not remembered.
 *
 * WHY THIS EXISTS AS A SCRIPT RATHER THAN AN ANSWER
 * The sandbox this project is developed in cannot reach
 * fantasy.premierleague.com; the egress proxy answers 403. So the question
 * "which endpoints exist now?" cannot be answered honestly from here, and
 * answering it from recollection would be the exact failure this repository
 * keeps recording: presenting knowledge as verification. A runner has network.
 * This probes, and prints what came back.
 *
 * WHAT IT REPORTS, AND WHY EACH FIELD
 *   status        200 / 404 / 401-403 are three different answers. "Not
 *                 allowed" is not "does not exist", and both differ from
 *                 "exists and is public".
 *   contentType   a login wall or an error page answers 200 with HTML. Without
 *                 this, "200" would be read as success.
 *   shape         array length, or the top-level keys. This is what decides
 *                 whether an endpoint is worth anything to us.
 *   sample        first-row keys for arrays, so a new column is visible.
 *
 * COVERAGE IS PRINTED TOO. The candidate list below is finite and hand-written,
 * so an endpoint's absence from the output means "not probed", never "does not
 * exist". That distinction is the whole reason the summary states the count.
 *
 * Read-only, unauthenticated, one pass, politely spaced. It sends no
 * credentials and probes nothing behind a login.
 */

const BASE = 'https://fantasy.premierleague.com/api';
const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)';

/* Endpoints the app already proxies (netlify/functions/fpl.js ALLOW list).
   Probed as well, because a control group is the only way to tell "this
   endpoint is gone" from "the probe is broken". */
const IN_USE = [
  'bootstrap-static/', 'fixtures/', 'event-status/', 'set-piece-notes/',
  'element-summary/1/', 'event/1/live/', 'dream-team/1/',
  'entry/1/', 'entry/1/history/', 'entry/1/transfers/',
  'entry/1/event/1/picks/', 'leagues-classic/314/standings/'
];

/* Candidates NOT currently in the allowlist. Includes several that are
   expected to fail — an auth-only route and a deliberate nonsense path — so
   the run proves the probe can produce a negative at all. */
const CANDIDATES = [
  'game-settings/',
  'bootstrap-dynamic/',
  'teams/',
  'element-types/',
  'fixtures/?future=1',
  'fixtures/?event=1',
  'entry/1/cup/',
  'entry/1/cup-status/',
  'leagues-entries-and-h2h-matches/league/314/',
  'most-valuable-teams/',
  'stats/most-valuable-teams/',
  'team/set-piece-notes/',
  'event/1/fixtures/',
  'player-stats/',
  'elite/',
  'region/',
  'award/',
  'me/',                                   /* expected auth-only */
  'my-team/1/',                            /* expected auth-only */
  'this-endpoint-should-not-exist-xyz/'    /* expected 404 — the negative control */
];

const shapeOf = (body, ct) => {
  if (!/json/i.test(ct)) return { kind: 'not-json', bytes: body.length };
  let data;
  try { data = JSON.parse(body); } catch { return { kind: 'unparseable-json', bytes: body.length }; }
  if (Array.isArray(data)) {
    const first = data[0];
    return {
      kind: 'array', length: data.length,
      sampleKeys: first && typeof first === 'object' ? Object.keys(first).slice(0, 40) : null
    };
  }
  if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    const arrays = {};
    for (const k of keys) if (Array.isArray(data[k])) arrays[k] = data[k].length;
    return { kind: 'object', keys: keys.slice(0, 40), arrayCounts: arrays };
  }
  return { kind: typeof data };
};

async function probe(path) {
  const url = `${BASE}/${path}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    const ct = r.headers.get('content-type') || '';
    const body = await r.text();
    return { path, status: r.status, contentType: ct.split(';')[0], bytes: body.length,
      shape: r.ok ? shapeOf(body, ct) : null };
  } catch (e) {
    return { path, status: null, error: String(e && e.message ? e.message : e) };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const line = (r) => {
  const s = r.status === null ? 'ERR ' : String(r.status);
  const bits = [s.padEnd(4), r.path.padEnd(46)];
  if (r.error) { bits.push('· ' + r.error); return bits.join(' '); }
  bits.push((r.contentType || '').padEnd(18));
  const sh = r.shape;
  if (!sh) bits.push('');
  else if (sh.kind === 'array') bits.push(`array[${sh.length}]`);
  else if (sh.kind === 'object') bits.push(`object{${(sh.keys || []).length} keys}`);
  else bits.push(sh.kind + ' ' + (sh.bytes || ''));
  return bits.join(' ');
};

(async () => {
  console.log('FPL API endpoint probe — ' + new Date().toISOString());
  console.log('base: ' + BASE + '\n');

  const results = { inUse: [], candidates: [] };

  console.log('=== ALREADY IN THE PROXY ALLOWLIST (control group) ===');
  for (const p of IN_USE) {
    const r = await probe(p);
    results.inUse.push(r);
    console.log(line(r));
    await sleep(400);
  }

  console.log('\n=== NOT IN THE ALLOWLIST (candidates) ===');
  for (const p of CANDIDATES) {
    const r = await probe(p);
    results.candidates.push(r);
    console.log(line(r));
    await sleep(400);
  }

  /* ── the part that makes the run interpretable ─────────────────── */
  const ok = (r) => r.status === 200 && /json/i.test(r.contentType || '');
  const liveNew = results.candidates.filter(ok);
  const control = results.candidates.find((r) => r.path.startsWith('this-endpoint-should-not'));
  const inUseBroken = results.inUse.filter((r) => !ok(r));

  console.log('\n=== SUMMARY ===');
  console.log(`probed: ${IN_USE.length} in-use + ${CANDIDATES.length} candidates`);
  console.log(`in-use endpoints NOT answering as JSON 200: ${inUseBroken.length}`
    + (inUseBroken.length ? ' -> ' + inUseBroken.map((r) => `${r.path} (${r.status})` ).join(', ') : ''));
  console.log(`candidates answering JSON 200: ${liveNew.length}`
    + (liveNew.length ? ' -> ' + liveNew.map((r) => r.path).join(', ') : ''));
  console.log(`negative control (${control ? control.path : 'MISSING'}): `
    + (control ? `status ${control.status}` : 'NOT PROBED')
    + (control && control.status === 200
      ? '  <-- WARNING: a nonsense path answered 200, so every 200 above is suspect'
      : '  (a non-200 here is what makes the 200s above meaningful)'));
  console.log(`\nCOVERAGE: this run probed ${IN_USE.length + CANDIDATES.length} paths from a `
    + 'hand-written list. An endpoint absent from this output was NOT PROBED, which is '
    + 'not evidence it does not exist.');

  /* Full detail last, so the shapes are greppable from the run log. */
  console.log('\n=== DETAIL (JSON) ===');
  console.log(JSON.stringify(results, null, 2));
})();
