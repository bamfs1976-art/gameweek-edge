/*
 * What ELSE the Premier League serves for free — measured, not remembered.
 *
 * The sibling of dev/fpl-endpoint-probe.mjs, and for the same reason: the
 * sandbox this project is developed in cannot reach these hosts (the egress
 * proxy answers 403), so "what other free Premier League APIs are there?"
 * cannot be answered honestly from here. Answering it from recollection would
 * be presenting knowledge as verification, which is the failure this
 * repository keeps writing down. A runner has network. This probes.
 *
 * WHY IT IS A SEPARATE SCRIPT
 * The FPL probe surveys ONE host with one auth model. This surveys several,
 * and the interesting differences between them are per-host: whether a key is
 * needed, whether an Origin header is required, whether the answer is JSON at
 * all. Folding them together would have meant a report where the columns mean
 * different things per row.
 *
 * THE THREE QUESTIONS EACH CANDIDATE HAS TO ANSWER
 *   1. Does it answer at all, without credentials?  status + contentType.
 *      A login wall and an error page both return 200 with HTML, so status
 *      alone is not an answer.
 *   2. Does it need an Origin header?  Several site APIs are open but refuse
 *      requests that do not look like they came from their own front end.
 *      Probed BOTH ways, because the answer decides whether a browser can
 *      call it directly or whether it needs a Netlify function in front —
 *      this app has a strict CSP and cannot add a host without one.
 *   3. Is the payload worth anything?  shape: array length, or top-level
 *      keys, plus first-row keys so a useful column is visible.
 *
 * COVERAGE IS PRINTED. The candidate list is finite and hand-written, so an
 * absence from the output means "not probed", never "does not exist".
 *
 * WHAT THIS SCRIPT DELIBERATELY DOES NOT DO
 *   - No credentials, no cookies, no login-walled paths.
 *   - No paid tiers. The project's standing rule is no paid APIs and no new
 *     keys, so a key-gated candidate is probed WITHOUT a key precisely to
 *     record that it is gated, and then dropped.
 *   - No scraping. Every candidate is a JSON endpoint. HTML pages are out of
 *     scope by the project's own rule about publisher sites, and an endpoint
 *     that answers HTML is recorded as a failure rather than parsed.
 *   - One pass, spaced, read-only. This is a survey, not a monitor.
 *
 * LICENCE IS NOT MEASURED BY THIS SCRIPT. A 200 means reachable. It does not
 * mean permitted, and several of these are undocumented site APIs whose terms
 * say nothing about third-party use. That judgement belongs in the report the
 * human reads, not in an exit code.
 */

const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)';
const PL_ORIGIN = 'https://www.premierleague.com';

/* Hosts already wired into the app, probed as a control group. If these fail
   the probe is broken, not the internet. */
const CONTROL = [
  { host: 'FPL API (in use)', url: 'https://fantasy.premierleague.com/api/bootstrap-static/' },
  { host: 'PL resources CDN (in use)', url: 'https://resources.premierleague.com/premierleague/badges/50/t3.png' },
  { host: 'negative control', url: 'https://footballapi.pulselive.com/football/this-should-not-exist-xyz' }
];

/* Candidates. `origin` marks the ones to try twice — with and without the
   Premier League Origin header — because that single header is the
   difference between "a browser can call this" and "this needs a proxy". */
const CANDIDATES = [
  /* ── the Premier League's own site API (Pulselive) ─────────────────────
     This is what premierleague.com itself runs on. No key. Undocumented. */
  { group: 'pulselive', origin: true, why: 'competition list — the entry point everything else keys off',
    url: 'https://footballapi.pulselive.com/football/competitions' },
  { group: 'pulselive', origin: true, why: 'clubs, with grounds and short names',
    url: 'https://footballapi.pulselive.com/football/teams?pageSize=100&comps=1' },
  { group: 'pulselive', origin: true, why: 'fixtures — kickoff, ground, status',
    url: 'https://footballapi.pulselive.com/football/fixtures?comps=1&pageSize=20' },
  { group: 'pulselive', origin: true, why: 'the league table',
    url: 'https://footballapi.pulselive.com/football/standings?comps=1' },
  { group: 'pulselive', origin: true, why: 'players',
    url: 'https://footballapi.pulselive.com/football/players?pageSize=10&comps=1' },
  /* The first run guessed fixture id 93000 and got a 404. That is evidence
     about the ID, not about the endpoint, and reporting it as "the endpoint is
     gone" would have been exactly the confusion this project keeps recording.
     Chained below instead, off a real id from the fixtures list. */
  { group: 'pulselive', origin: true, why: 'staff/officials for a season — would answer the referee question without scraping',
    url: 'https://footballapi.pulselive.com/football/teams/1/compseasons/719/staff' },
  { group: 'pulselive', origin: true, why: 'aggregate player stats',
    url: 'https://footballapi.pulselive.com/football/stats/ranked/players/goals?page=0&pageSize=5&comps=1' },

  /* ── the newer Premier League SDP API ─────────────────────────────────
     The site has been migrating to this; worth knowing which is live. */
  { group: 'sdp', origin: true, why: 'newer PL platform — successor to the above',
    url: 'https://sdp-prem-prod.premier-league-prod.pulselive.com/api/v2/competitions' },
  { group: 'sdp', origin: true, why: 'newer PL platform, fixtures',
    url: 'https://sdp-prem-prod.premier-league-prod.pulselive.com/api/v2/matches?competition=8&pageSize=5' },

  /* ── premierleague.com front-door API paths ───────────────────────────── */
  { group: 'plsite', origin: true, why: 'does the www host proxy its own API?',
    url: 'https://www.premierleague.com/api/competitions' },

  /* ── open data on GitHub: no key, explicit licence, but hand-maintained ── */
  { group: 'openfootball', why: 'openfootball/football.json — CC0-ish, fixtures only, community-maintained',
    url: 'https://raw.githubusercontent.com/openfootball/football.json/master/2024-25/en.1.json' },

  /* ── key-gated, probed WITHOUT a key to record that it is gated ───────── */
  { group: 'gated', why: 'football-data.org v4 unauthenticated — expected 401/403, we already hold a free key',
    url: 'https://api.football-data.org/v4/competitions/PL/matches' },
  { group: 'gated', why: 'api-football (RapidAPI) — expected refusal, and it is a paid tier beyond a trial',
    url: 'https://v3.football.api-sports.io/fixtures?league=39&season=2026' }
];

const shapeOf = (body, ct) => {
  /* Content-type is the first filter, not the only one: raw.githubusercontent
     serves .json files as text/plain, and the first run reported a perfectly
     good JSON file as "not-json" on that basis alone. So fall through to an
     actual parse before calling it non-JSON. */
  if (!/json/i.test(ct) && !(body.trim().startsWith('{') || body.trim().startsWith('['))) {
    return { kind: 'not-json', bytes: body.length };
  }
  let data;
  try { data = JSON.parse(body); } catch { return { kind: 'unparseable-json', bytes: body.length }; }
  if (Array.isArray(data)) {
    const first = data[0];
    return { kind: 'array', length: data.length,
      sampleKeys: first && typeof first === 'object' ? Object.keys(first).slice(0, 30) : null };
  }
  if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    const arrays = {};
    for (const k of keys) if (Array.isArray(data[k])) arrays[k] = data[k].length;
    /* One level down: these APIs bury the payload under `content` or `data`. */
    let inner = null;
    for (const k of ['content', 'data', 'items', 'results']) {
      if (Array.isArray(data[k]) && data[k][0] && typeof data[k][0] === 'object') {
        inner = { under: k, sampleKeys: Object.keys(data[k][0]).slice(0, 30) };
        break;
      }
    }
    return { kind: 'object', keys: keys.slice(0, 30), arrayCounts: arrays, inner };
  }
  return { kind: typeof data };
};

async function hit(url, withOrigin) {
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (withOrigin) { headers.Origin = PL_ORIGIN; headers.Referer = PL_ORIGIN + '/'; }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(t);
    const ct = r.headers.get('content-type') || '';
    const body = await r.text();
    return { status: r.status, contentType: ct.split(';')[0], bytes: body.length,
      acao: r.headers.get('access-control-allow-origin'),
      shape: r.ok ? shapeOf(body, ct) : null,
      snippet: r.ok ? null : body.slice(0, 120).replace(/\s+/g, ' ') };
  } catch (e) {
    return { status: null, error: String(e && e.message ? e.message : e) };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (u) => u.replace(/^https:\/\//, '').slice(0, 72);

function describe(r) {
  if (!r) return '—';
  if (r.status === null) return 'ERR  ' + r.error;
  const bits = [String(r.status).padEnd(4), (r.contentType || '').padEnd(17)];
  const sh = r.shape;
  if (!sh) bits.push(r.snippet ? '· ' + r.snippet.slice(0, 60) : '');
  else if (sh.kind === 'array') bits.push(`array[${sh.length}]`);
  else if (sh.kind === 'object') {
    bits.push(`object{${(sh.keys || []).join(',').slice(0, 60)}}`);
    if (sh.inner) bits.push(`\n           payload under .${sh.inner.under}: ${sh.inner.sampleKeys.join(', ').slice(0, 150)}`);
  } else bits.push(sh.kind + ' ' + (sh.bytes || ''));
  return bits.join(' ');
}

(async () => {
  console.log('Premier League free-API probe — ' + new Date().toISOString());
  console.log('No credentials sent. Read-only. One pass.\n');

  console.log('=== CONTROL GROUP (already in use, plus a deliberate 404) ===');
  for (const c of CONTROL) {
    const r = await hit(c.url, /pulselive/.test(c.url));
    console.log(`${c.host}\n  ${short(c.url)}\n  ${describe(r)}\n`);
    await sleep(500);
  }

  console.log('\n=== CANDIDATES ===');
  const summary = [];
  for (const c of CANDIDATES) {
    const plain = await hit(c.url, false);
    await sleep(500);
    let withOrigin = null;
    if (c.origin) { withOrigin = await hit(c.url, true); await sleep(500); }

    console.log(`[${c.group}] ${c.why}`);
    console.log(`  ${short(c.url)}`);
    console.log(`  no Origin header : ${describe(plain)}`);
    if (withOrigin) console.log(`  with PL Origin   : ${describe(withOrigin)}`);
    console.log('');

    const best = (withOrigin && withOrigin.status >= 200 && withOrigin.status < 300)
      ? withOrigin : plain;
    summary.push({
      group: c.group, url: c.url, acao: best.acao,
      usable: !!(best.status >= 200 && best.status < 300 && best.shape
        && best.shape.kind !== 'not-json'),
      needsOrigin: !!(withOrigin && withOrigin.status < 300 && plain.status >= 300),
      status: best.status
    });
  }

  /* Chained probe: one real id, taken from the fixtures list above rather
     than guessed. A 404 on a made-up id says nothing about the route. */
  console.log('\n=== CHAINED (a real id, not a guessed one) ===');
  try {
    const list = await hit('https://footballapi.pulselive.com/football/fixtures?comps=1&pageSize=1', true);
    const id = list.shape && list.shape.inner ? null : null;
    const raw = await fetch('https://footballapi.pulselive.com/football/fixtures?comps=1&pageSize=1',
      { headers: { 'User-Agent': UA, Accept: 'application/json', Origin: PL_ORIGIN } });
    const j = await raw.json();
    const fid = j && j.content && j.content[0] && j.content[0].id;
    if (!fid) console.log('  could not read a fixture id from the list — chain not attempted');
    else {
      console.log(`  using fixture id ${fid}`);
      const one = await hit(`https://footballapi.pulselive.com/football/fixtures/${fid}`, true);
      console.log(`  single fixture   : ${describe(one)}`);
      await sleep(500);
      const tl = await hit(`https://footballapi.pulselive.com/football/fixtures/${fid}/textstream/EN?pageSize=5`, true);
      console.log(`  textstream (commentary/events) : ${describe(tl)}`);
    }
  } catch (e) { console.log('  chain failed: ' + (e && e.message)); }

  console.log('\n=== SUMMARY ===');
  const usable = summary.filter((s) => s.usable);
  console.log(`probed ${CANDIDATES.length} candidates across ${new Set(CANDIDATES.map((c) => c.group)).size} groups`);
  console.log(`${usable.length} returned usable JSON without credentials`);
  const needsOrigin = usable.filter((s) => s.needsOrigin);
  console.log(`${needsOrigin.length} of those required the Premier League Origin header.`);
  /* The first run printed a consequence clause here unconditionally — "which
     means a browser cannot call them directly" — which read as a finding when
     the count was zero and was simply a non-sequitur. Say it only when it
     applies, and say the thing that actually decides it otherwise. */
  if (needsOrigin.length) {
    console.log('  Those cannot be called from a browser on our own domain;');
    console.log('  they need a Netlify function in front, like fpl.js and football-data.js.');
  } else {
    console.log('  So none of them is gated on looking like the PL front end.');
  }
  const cors = usable.filter((s) => s.acao);
  console.log(`\n${cors.length} of ${usable.length} send an Access-Control-Allow-Origin header.`);
  console.log('  This, not the Origin request header, is what decides whether the');
  console.log('  BROWSER can call it. Server-side reachability says nothing about it:');
  console.log('  a runner has no same-origin policy and this script is a runner.');
  for (const s of usable) {
    console.log(`    ${s.acao ? 'CORS ' + s.acao : 'no CORS header'} — ${short(s.url)}`);
  }
  console.log('\nNOT MEASURED HERE: whether any of this is LICENSED for our use.');
  console.log('A 200 means reachable. Several of these are undocumented site APIs');
  console.log('whose terms say nothing about third-party use, and that judgement is');
  console.log('a human one. The list above is what exists, not what is permitted.');
  console.log(`\nCoverage: this list is hand-written and finite. An endpoint absent`);
  console.log('from it was NOT PROBED, which is not the same as not existing.');
})();
