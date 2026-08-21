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

/* The proxy's own front door. "Are our endpoints firing?" is a question about
   THIS, not about fantasy.premierleague.com — an endpoint can be perfectly
   alive upstream and still be broken for our users, because the allowlist
   rejects it, the redirect is wrong, or the function errors. The two are
   probed separately and compared, since only the comparison says whose
   problem a failure is. */
const PROXY = (process.env.GWE_BASE || 'https://gameweekedge.co.uk').replace(/\/+$/, '') + '/api/fpl';

/* ── IN-USE COVERAGE IS DERIVED, NOT TYPED ────────────────────────────
   This list used to be hand-written, and it had drifted: twelve paths
   against an allowlist of fifteen. The three it had quietly stopped
   covering were the two h2h league routes and the CURRENT set-piece-notes
   path — and a probe that omits an endpoint reports exactly the same thing
   as a probe that finds it healthy. Silence and success looked identical.

   So the list is now read out of netlify/functions/fpl.js at run time. Add an
   endpoint to the allowlist and this probes it on the next run without
   anybody remembering to; delete one and it stops. The count is asserted
   against the file so a parse failure cannot masquerade as full coverage. */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function allowPatterns() {
  const src = readFileSync(path.join(HERE, '..', 'netlify', 'functions', 'fpl.js'), 'utf8');
  const block = src.match(/const ALLOW = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error('could not find the ALLOW block in fpl.js — refusing to guess coverage');
  return block[1]
    .split('\n')
    .map((l) => l.replace(/\/\*[\s\S]*?\*\//g, '').trim())
    .map((l) => (l.match(/^\/\^(.*)\$\/,?$/) || [])[1])
    .filter(Boolean);
}

/* Turn one allowlist regex into a path that really exists. Ids come from live
   responses rather than from imagination: an earlier probe in this repo
   guessed a fixture id, got a 404, and would have had that read as "the
   endpoint is gone" — evidence about the id, not the route. Anything we
   cannot source a real id for returns a REASON, and the coverage report
   prints it as not-probed rather than letting it vanish. */
function concreteFor(pattern, ids) {
  let p = pattern.replace(/\\\//g, '/');
  if (/leagues-h2h/.test(p)) {
    if (!ids.h2h) return { skip: 'no real head-to-head league id available — see resolveIds()' };
    p = p.replace('\\d+', String(ids.h2h));
  }
  if (/^entry\//.test(p)) {
    if (!ids.entry) return { skip: 'could not resolve a real entry id' };
    p = p.replace('\\d+', String(ids.entry));
  }
  if (/leagues-classic/.test(p)) p = p.replace('\\d+', String(ids.classic));
  if (/element-summary/.test(p)) p = p.replace('\\d+', String(ids.element));
  p = p.replace(/\\d\+/g, String(ids.event));
  if (/\\d\+|\\/.test(p)) return { skip: 'pattern has unsubstituted metacharacters: ' + p };
  return { path: p + '/' };
}

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

/* Probe the same endpoint through our own proxy. Same shape of answer, so the
   two can be compared row by row. */
async function probeProxy(p) {
  const url = `${PROXY}/${p}`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const ct = r.headers.get('content-type') || '';
    const body = await r.text();
    return { path: p, status: r.status, contentType: ct.split(';')[0], bytes: body.length,
      shape: r.ok ? shapeOf(body, ct) : null,
      why: r.ok ? null : body.slice(0, 160).replace(/\s+/g, ' ') };
  } catch (e) {
    const to = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { path: p, status: null, error: to ? 'no answer within 20000ms' : String(e && e.message) };
  }
}

/* Real ids, sourced from real responses. The global classic league 314 holds
   every registered manager, so its standings are where a genuine entry id
   comes from; bootstrap-static names the current gameweek and a real element.

   There is no equivalent source for a head-to-head league we are entitled to
   read, so `h2h` stays null on purpose. Inventing one would produce a 404 and
   a false headline — "our h2h endpoint is broken" — about an id rather than
   about the route. Not probed is recorded as not probed. */
async function resolveIds() {
  const ids = { entry: null, event: 1, element: 1, classic: 314, h2h: null, notes: [] };
  const boot = await probe('bootstrap-static/');
  if (boot.status === 200) {
    try {
      const b = JSON.parse((await (await fetch(`${BASE}/bootstrap-static/`, { headers: { 'User-Agent': UA } })).text()));
      const cur = (b.events || []).find((e) => e.is_current) || (b.events || []).find((e) => e.is_next);
      if (cur) { ids.event = cur.id; ids.notes.push(`current gameweek ${cur.id} (from bootstrap events)`); }
      if (b.elements && b.elements[0]) { ids.element = b.elements[0].id; ids.notes.push(`element ${ids.element}`); }
    } catch (_) { ids.notes.push('bootstrap parsed badly; falling back to event 1, element 1'); }
  } else ids.notes.push(`bootstrap answered ${boot.status}; ids fall back to 1`);

  const st = await probe(`leagues-classic/${ids.classic}/standings/`);
  if (st.status === 200) {
    try {
      const s = JSON.parse((await (await fetch(`${BASE}/leagues-classic/${ids.classic}/standings/`, { headers: { 'User-Agent': UA } })).text()));
      const row = ((s.standings || {}).results || [])[0];
      if (row && row.entry) { ids.entry = row.entry; ids.notes.push(`entry ${ids.entry} (top of league ${ids.classic})`); }
    } catch (_) { /* recorded by the null below */ }
  }
  if (!ids.entry) ids.notes.push('NO real entry id resolved — entry/* rows will be reported as not probed');
  ids.notes.push('no head-to-head league id is obtainable without joining one; leagues-h2h/* not probed');
  return ids;
}

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

/* Exported for dev/test-fpl-probe-coverage.mjs. The coverage claim — "fifteen
   allowlist patterns, N of them probeable" — is the load-bearing sentence in
   this whole report, so the two functions that produce it are testable
   without a network. */
export { allowPatterns, concreteFor };

/* Inert on import, or the coverage test would go to the internet. */
const invokedDirectly = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) await (async () => {
  console.log('FPL API endpoint probe — ' + new Date().toISOString());
  console.log('base: ' + BASE + '\n');

  const results = { inUse: [], candidates: [], viaProxy: [], skipped: [] };

  const patterns = allowPatterns();
  const ids = await resolveIds();
  console.log('ids resolved from live responses, not guessed:');
  ids.notes.forEach((n) => console.log('  · ' + n));

  const IN_USE = [];
  patterns.forEach((pat) => {
    const c = concreteFor(pat, ids);
    if (c.skip) results.skipped.push({ pattern: pat, reason: c.skip });
    else IN_USE.push(c.path);
  });
  console.log(`\nallowlist in fpl.js: ${patterns.length} patterns → ${IN_USE.length} probeable, `
    + `${results.skipped.length} not probeable`);

  console.log('\n=== ALREADY IN THE PROXY ALLOWLIST (control group) ===');
  for (const p of IN_USE) {
    const r = await probe(p);
    results.inUse.push(r);
    console.log(line(r));
    await sleep(400);
  }

  /* The question the owner actually asked. Upstream health is necessary and
     not sufficient: these are the URLs the app calls. */
  console.log('\n=== THE SAME ENDPOINTS THROUGH OUR OWN PROXY ===');
  console.log(`base: ${PROXY}`);
  for (const p of IN_USE) {
    const r = await probeProxy(p);
    results.viaProxy.push(r);
    console.log(line(r) + (r.why ? '  · ' + r.why : ''));
    await sleep(400);
  }

  console.log('\n=== NOT IN THE ALLOWLIST (candidates) ===');
  for (const p of CANDIDATES) {
    const r = await probe(p);
    results.candidates.push(r);
    console.log(line(r));
    await sleep(400);
  }

  /* Raw shapes, printed BEFORE the conclusions. Reading a run means reading
     its end: `tail` is how anyone actually looks at a CI log, and burying the
     findings under four hundred lines of JSON meant the answer was the part
     you could not see. The dump is still here, just not last. */
  console.log('\n=== DETAIL (JSON) ===');
  console.log(JSON.stringify(results, null, 2));

  /* ── the part that makes the run interpretable ─────────────────── */
  const ok = (r) => r.status === 200 && /json/i.test(r.contentType || '');
  const liveNew = results.candidates.filter(ok);
  const control = results.candidates.find((r) => r.path.startsWith('this-endpoint-should-not'));
  const inUseBroken = results.inUse.filter((r) => !ok(r));

  console.log('\n=== SUMMARY ===');
  console.log(`probed: ${IN_USE.length} in-use (upstream AND via our proxy) + ${CANDIDATES.length} candidates`);
  console.log(`in-use endpoints NOT answering as JSON 200 UPSTREAM: ${inUseBroken.length}`
    + (inUseBroken.length ? ' -> ' + inUseBroken.map((r) => `${r.path} (${r.status})` ).join(', ') : ''));

  /* Whose fault is it. Upstream-broken is theirs and we wait; proxy-broken
     while upstream is fine is OURS and is actionable today. Reporting one
     number for both would bury the only rows anybody can act on. */
  const proxyBroken = results.viaProxy.filter((r) => !ok(r));
  const upstreamOkPaths = new Set(results.inUse.filter(ok).map((r) => r.path));
  const oursAlone = proxyBroken.filter((r) => upstreamOkPaths.has(r.path));
  console.log(`in-use endpoints NOT answering as JSON 200 THROUGH OUR PROXY: ${proxyBroken.length}`
    + (proxyBroken.length ? ' -> ' + proxyBroken.map((r) => `${r.path} (${r.status})`).join(', ') : ''));
  console.log(`  of those, healthy upstream and broken only for us: ${oursAlone.length}`
    + (oursAlone.length ? ' -> ' + oursAlone.map((r) => r.path).join(', ') + '   <-- OUR BUG, ACTIONABLE' : ''));
  if (results.skipped.length) {
    console.log(`allowlist entries NOT PROBED (${results.skipped.length}) — absence of a result, not a pass:`);
    results.skipped.forEach((s) => console.log(`  · /^${s.pattern}$/ — ${s.reason}`));
  }
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

  /* ── which FIELDS are served, and which we never read ──────────────
     "Has anything been added?" is not only a question about routes. Most of
     what FPL ships arrives inside bootstrap-static, and a new column on
     `elements` is a new capability with no new URL to notice. So: pull the
     real field lists, and grep the app for each name.

     A name appearing in index.html is weak evidence we USE it — it could be
     in a comment — but a name appearing NOWHERE is strong evidence we do not.
     This is run for the negative, and the output says so. */
  console.log('\n=== FIELDS SERVED vs FIELDS THE APP MENTIONS ===');
  let appSrc = '';
  try {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    appSrc = readFileSync(join(root, 'index.html'), 'utf8');
  } catch (e) {
    console.log('could not read index.html: ' + e.message);
  }

  if (appSrc) {
    const boot = await (await fetch(`${BASE}/bootstrap-static/`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } })).json();

    const mentions = (name) => appSrc.includes(name);
    const report = (label, names) => {
      const unused = names.filter((n) => !mentions(n));
      console.log(`\n${label}: ${names.length} fields, ${names.length - unused.length} mentioned in index.html`);
      if (unused.length) console.log('  NEVER MENTIONED: ' + unused.join(', '));
      else console.log('  (every field is mentioned somewhere)');
    };

    if (Array.isArray(boot.elements) && boot.elements[0]) {
      report('elements[] (players)', Object.keys(boot.elements[0]));
    }
    if (Array.isArray(boot.teams) && boot.teams[0]) {
      report('teams[]', Object.keys(boot.teams[0]));
    }
    if (Array.isArray(boot.events) && boot.events[0]) {
      report('events[] (gameweeks)', Object.keys(boot.events[0]));
    }
    if (Array.isArray(boot.element_stats)) {
      /* element_stats is FPL's own list of the stat identifiers it scores.
         A new entry here is the loudest possible signal of a rule change. */
      const ids = boot.element_stats.map((s) => s && s.name).filter(Boolean);
      console.log(`\nelement_stats (FPL's own list of scored stats): ${ids.length}`);
      console.log('  ' + ids.join(', '));
      const unused = ids.filter((n) => !mentions(n));
      console.log(unused.length ? '  NEVER MENTIONED: ' + unused.join(', ')
        : '  (every scored stat is mentioned somewhere)');
    }
    if (Array.isArray(boot.chips)) {
      console.log(`\nchips: ${boot.chips.map((c) => c && (c.name || c.id)).join(', ')}`);
    }
    /* ── the actual strength numbers ────────────────────────────────
       Printed in full because thresholds cannot be designed against a field
       NAME. Six venue-split numbers per club, and the spread between the best
       and worst is the whole question: if FPL's model barely separates the
       clubs, a difficulty scale built on it inherits that flatness, which is
       exactly the defect already recorded against our own four-band scale. */
    if (Array.isArray(boot.teams) && boot.teams[0] && 'strength_attack_home' in boot.teams[0]) {
      const S = ['strength_overall_home', 'strength_overall_away', 'strength_attack_home',
        'strength_attack_away', 'strength_defence_home', 'strength_defence_away'];
      console.log('\n=== teams[].strength_* (all 20, for threshold design) ===');
      console.log('name'.padEnd(26) + 'str ' + S.map((k) => k.replace('strength_', '').replace('_', '-').padStart(11)).join(''));
      for (const t of boot.teams) {
        console.log(String(t.name).padEnd(26) + String(t.strength).padEnd(4)
          + S.map((k) => String(t[k]).padStart(11)).join(''));
      }
      for (const k of S) {
        const v = boot.teams.map((t) => t[k]).filter((n) => typeof n === 'number').sort((a, c) => a - c);
        if (!v.length) continue;
        const mean = v.reduce((a, c) => a + c, 0) / v.length;
        console.log(`${k.padEnd(24)} min ${v[0]}  median ${v[Math.floor(v.length / 2)]}  max ${v[v.length - 1]}`
          + `  mean ${mean.toFixed(1)}  spread ${(v[v.length - 1] / v[0]).toFixed(3)}x`);
      }
    }

    /* ── which DIRECTION does strength_overall point? ───────────────
       The field name does not say whether a bigger number means a stronger
       club or a harder fixture, and getting it backwards inverts every
       difficulty rating built on it — the worst available failure for this
       feature. `strength` is null and attack/defence are zeroed, so there is
       no internal cross-check.

       There is an external one. Each fixture carries FPL's own
       team_h_difficulty / team_a_difficulty on a 1-5 scale where HIGHER IS
       HARDER. If strength_overall means "stronger club", the away side's
       difficulty should RISE with the home club's strength_overall_home.
       Correlate and read the sign. */
    const fx = await (await fetch(`${BASE}/fixtures/`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } })).json();
    const byId = new Map(boot.teams.map((t) => [t.id, t]));
    const pairs = [];
    for (const f of Array.isArray(fx) ? fx : []) {
      const h = byId.get(f.team_h), a = byId.get(f.team_a);
      if (!h || !a) continue;
      if (typeof f.team_a_difficulty === 'number')
        pairs.push({ x: h.strength_overall_home, y: f.team_a_difficulty, what: 'home strength vs away difficulty' });
      if (typeof f.team_h_difficulty === 'number')
        pairs.push({ x: a.strength_overall_away, y: f.team_h_difficulty, what: 'away strength vs home difficulty' });
    }
    const corr = (rows) => {
      const n = rows.length; if (n < 3) return null;
      const mx = rows.reduce((s, p) => s + p.x, 0) / n, my = rows.reduce((s, p) => s + p.y, 0) / n;
      let sxy = 0, sxx = 0, syy = 0;
      for (const p of rows) { const dx = p.x - mx, dy = p.y - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
      return (sxx && syy) ? sxy / Math.sqrt(sxx * syy) : null;
    };
    console.log('\n=== does strength_overall mean STRONGER or HARDER? ===');
    console.log('reference: fixtures[].team_*_difficulty, 1-5, higher = harder');
    for (const what of ['home strength vs away difficulty', 'away strength vs home difficulty']) {
      const rows = pairs.filter((p) => p.what === what && typeof p.x === 'number');
      const r = corr(rows);
      console.log(`  ${what.padEnd(34)} n=${rows.length}  r=${r === null ? 'n/a' : r.toFixed(3)}`);
    }
    const all = pairs.filter((p) => typeof p.x === 'number');
    const r = corr(all);
    console.log(`  combined                           n=${all.length}  r=${r === null ? 'n/a' : r.toFixed(3)}`);
    console.log(r === null ? '  -> NO ANSWER: not enough variation to read a direction'
      : r > 0.3 ? '  -> POSITIVE: a higher strength_overall means a HARDER fixture for the opponent,'
        + '\n     i.e. the number describes club STRENGTH. Difficulty = opponent strength.'
      : r < -0.3 ? '  -> NEGATIVE: higher strength_overall goes with an EASIER opponent fixture,'
        + '\n     i.e. the field is NOT club strength in the obvious sense. Do not build on it.'
      : '  -> INCONCLUSIVE (|r| <= 0.3): the two do not track each other. Building a '
        + 'difficulty\n     scale on this field would be asserting a meaning the data does not show.');
    /* How much NEW information, if any, over the FDR we already read. */
    const uniq = new Set(all.map((p) => p.x)).size;
    console.log(`  distinct strength_overall values in play: ${uniq}`
      + (uniq <= 2 ? '  <-- too few to separate fixtures' : ''));

    /* Top-level keys are the cheapest place a whole new dataset appears. */
    console.log(`\nbootstrap-static top-level keys: ${Object.keys(boot).join(', ')}`);
    const unusedTop = Object.keys(boot).filter((k) => !mentions(k));
    console.log(unusedTop.length ? '  NEVER MENTIONED: ' + unusedTop.join(', ')
      : '  (every top-level key is mentioned somewhere)');
  }

})();
