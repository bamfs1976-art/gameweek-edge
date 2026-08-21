/*
 * Does football-data.org's free tier actually FILL `nationality` on a squad?
 *
 * WHY THIS EXISTS
 * The fixture ticker work raised a real gap: FPL's `elements` carry 59 fields
 * and not one of them is nationality, so the app cannot know that a winter
 * tournament is about to take six players out of a squad. Pulselive's
 * /players carries `nationalTeam` — but Pulselive is an undocumented site API
 * whose terms say nothing about third-party use, and that is a question we
 * would rather not have to answer.
 *
 * football-data.org would make the question moot. We hold a free key under
 * published terms, the proxy is already written, and `netlify/functions/
 * football-data.js` ALREADY has a `team` route (/teams/{id}) whose response,
 * per the v4 documentation, carries a `squad` array with `nationality` on
 * each player. If that is populated on our plan, the licensing question dies
 * unasked.
 *
 * WHY IT IS A PROBE AND NOT AN ASSUMPTION
 * Because this repository has already been burned by exactly this shape of
 * belief. `referees` is present in the v4 schema on all 552 Championship and
 * 380 Premier League matches and populated on NONE of them — a tier limit
 * wearing a schema's clothes (see docs/scope-referee-source.md, and the long
 * comment on the `matchday` route). "The docs list the field" is not evidence
 * that our plan returns it. Only a response is.
 *
 * The proxy's own header says the same thing about itself: its response
 * shapes "come from the published v4 documentation, not from a response
 * anyone has seen". This script is the pass that header asks for.
 *
 * HOW IT REACHES THE DATA — AND WHY IT NEVER SEES THE KEY
 * It calls OUR OWN DEPLOYED SITE, not football-data directly. The key lives
 * in the function's environment and stays there; this script sends no
 * credentials and could not leak one if it tried. That is also the only way
 * to run it without copying a secret somewhere new, which is a thing we do
 * not do.
 *
 * It is a workflow rather than a local script for the usual reason: the
 * sandbox this project is developed in cannot reach either host. Measured on
 * 21 Aug 2026, both api.football-data.org and gameweekedge.co.uk answered
 * `000` — the egress proxy refuses the CONNECT. A runner has network.
 *
 * IDS ARE CHAINED, NOT GUESSED
 * The team ids come out of a real matchday response. An earlier probe in this
 * repo guessed a fixture id, got a 404, and would have had that read as "the
 * endpoint is gone" — which is evidence about the id, not about the route.
 * So: ask the feed what exists, then ask about those.
 *
 * THE GATES ARE THE POINT
 * A probe that finds no nationality and a probe that could never have found
 * one print the same empty column. So the verdict below is gated: it will not
 * say anything about `nationality` until it has established that a squad came
 * back to look in. When a check finds nothing, the first question is whether
 * it could have found anything.
 *
 * Read-only. No writes, no credentials, one pass, paced under the rate limit.
 */

const BASE = (process.env.GWE_BASE || 'https://gameweekedge.co.uk').replace(/\/+$/, '');

/* The free tier allows ~10 requests a minute for the WHOLE SITE, and the
   proxy's edge cache is what normally keeps us under it. A cold probe misses
   that cache by definition, so it paces itself. Anything above ~6s is safe;
   8s leaves room for a real visitor during the run.

   GWE_PACE_MS exists so dev/test-squad-probe.mjs can drive this against a
   local mock in under a second. It is not a tuning knob for the real run:
   lowering it against the live site is a decision to start collecting 429s
   for everybody, exactly as the proxy's own header warns. */
const PACE_MS = Number(process.env.GWE_PACE_MS) || 8000;
const MAX_TEAMS = 3;

/* Both competitions the app actually covers. The Fantasy EFL half of this
   project has the same minutes-risk problem as the FPL half, and a tier can
   differ per competition, so ELC is asked separately rather than assumed to
   behave like PL. */
const COMPS = [
  { code: 'PL', label: 'Premier League' },
  { code: 'ELC', label: 'Championship' }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A timeout and an elapsed figure, both for the same reason: on the first
   real run I watched the job sit at "in progress" and concluded it had hung.
   It had not — it finished in 63 seconds, on schedule, and the status I was
   reading was stale. But I could not tell slow from stuck from the outside,
   and neither could the log, because nothing here printed how long anything
   took. Without a deadline a probe against an unresponsive host really would
   sit there until the runner's six-hour limit, and it would look exactly the
   same as this did. So: bound it, and show the number. */
const TIMEOUT_MS = 20000;

let calls = 0;
async function hit(path) {
  if (calls++) await sleep(PACE_MS);
  const url = `${BASE}/api/football-data/${path}`;
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch (_) { /* recorded below as non-JSON */ }
    return { ok: r.ok, status: r.status, body, raw: text.slice(0, 200), url, ms: Date.now() - t0 };
  } catch (e) {
    /* A timeout arrives here as an AbortError. Named explicitly, because
       "status 0" covers DNS failure, connection refused and giving up
       waiting, and those are three different things to act on. */
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return {
      ok: false,
      status: 0,
      body: null,
      raw: timedOut ? `no answer within ${TIMEOUT_MS}ms` : String(e && e.message),
      url,
      ms: Date.now() - t0
    };
  }
}

/* football-data distinguishes SCHEDULED (date known, kick-off time not yet
   fixed) from TIMED (time confirmed). If that holds on our plan it is the
   same distinction Pulselive offers as provisionalKickoff vs kickoff — the
   second reason anyone wanted Pulselive — so it is counted rather than
   assumed. An empty histogram means the key was absent, and says so. */
function statusHistogram(body) {
  const matches = (body && Array.isArray(body.matches)) ? body.matches : [];
  const h = {};
  let missing = 0;
  matches.forEach((m) => {
    const s = m && m.status;
    if (typeof s !== 'string' || !s) { missing++; return; }
    h[s] = (h[s] || 0) + 1;
  });
  return { h, missing, total: matches.length };
}

/* Distinct team ids in kickoff order, from whatever the matchday call gave
   back. Defensive about the shape because nobody here has seen one. */
function teamIdsFrom(body) {
  const out = [];
  const seen = new Set();
  const matches = (body && Array.isArray(body.matches)) ? body.matches : [];
  matches.forEach((m) => {
    [m && m.homeTeam, m && m.awayTeam].forEach((t) => {
      const id = t && t.id;
      if (Number.isFinite(id) && !seen.has(id)) { seen.add(id); out.push({ id, name: (t.name || t.shortName || '') }); }
    });
  });
  return out;
}

/* One club's squad, reduced to the only three numbers that matter: how many
   players came back, how many rows CARRY the key at all, and how many carry a
   non-empty value. Present-but-empty is the exact failure mode `referees`
   had, so it is counted separately rather than folded into "missing". */
function squadCoverage(body) {
  const squad = (body && Array.isArray(body.squad)) ? body.squad : null;
  if (!squad) return { squad: null };
  const present = squad.filter((p) => p && Object.prototype.hasOwnProperty.call(p, 'nationality')).length;
  const filled = squad.filter((p) => p && typeof p.nationality === 'string' && p.nationality.trim() !== '').length;
  const samples = squad
    .filter((p) => p && p.nationality)
    .slice(0, 4)
    .map((p) => `${p.name || p.id} → ${p.nationality}`);
  return { squad: squad.length, present, filled, samples, keys: squad[0] ? Object.keys(squad[0]) : [] };
}

const pad = (s, n) => String(s).padEnd(n);

async function probeComp(comp) {
  console.log(`\n${'='.repeat(72)}\n${comp.label} (${comp.code})\n${'='.repeat(72)}`);

  const md = await hit(`matchday?competition=${comp.code}`);
  const meta = (md.body && md.body._meta) || {};
  console.log(`matchday        → HTTP ${md.status}  ${md.ms}ms` +
    (meta.requestsAvailableMinute ? `  (budget left this minute: ${meta.requestsAvailableMinute})` : ''));

  if (!md.ok) {
    console.log(`  body: ${md.body ? JSON.stringify(md.body).slice(0, 240) : md.raw}`);
    return { comp: comp.code, gate: 'matchday', reason: `HTTP ${md.status}` };
  }

  const ids = teamIdsFrom(md.body);
  const matchCount = (md.body && Array.isArray(md.body.matches)) ? md.body.matches.length : 0;
  console.log(`                  ${matchCount} matches, ${ids.length} distinct clubs`);

  const st = statusHistogram(md.body);
  if (st.total && st.missing === st.total) {
    console.log(`                  status: absent from every match on this plan`);
  } else if (st.total) {
    const parts = Object.keys(st.h).sort().map((k) => `${k} ${st.h[k]}`);
    console.log(`                  status: ${parts.join(', ')}` +
      (st.missing ? `, missing ${st.missing}` : ''));
    /* Only claim the distinction when BOTH sides of it are present. One
       value alone could mean the plan collapses them, or simply that the
       season has not started — and those look identical from here. */
    const timed = st.h.TIMED || 0, sched = st.h.SCHEDULED || 0;
    if (timed && sched) {
      console.log(`                  → TIMED and SCHEDULED both present: confirmed vs provisional`);
      console.log(`                    kick-offs ARE distinguishable on this plan.`);
    } else if (timed || sched) {
      console.log(`                  → only ${timed ? 'TIMED' : 'SCHEDULED'} seen, so this run cannot`);
      console.log(`                    show the two are distinguished. Not evidence they are not.`);
    }
  }

  /* GATE: no ids means nothing downstream can mean anything. Say so as a
     broken chain, not as a finding about nationality. */
  if (!ids.length) {
    return { comp: comp.code, gate: 'ids', reason: `matchday returned ${matchCount} matches and no team ids` };
  }

  const rows = [];
  for (const t of ids.slice(0, MAX_TEAMS)) {
    const r = await hit(`team?id=${t.id}`);
    if (!r.ok) {
      console.log(`team ${pad(t.id, 5)}      → HTTP ${r.status}  ${t.name}`);
      rows.push({ ...t, error: `HTTP ${r.status}` });
      continue;
    }
    const cov = squadCoverage(r.body);
    if (cov.squad === null) {
      console.log(`team ${pad(t.id, 5)}      → 200 but NO squad array  ${t.name}`);
      console.log(`                  top-level keys: ${Object.keys(r.body || {}).join(', ')}`);
      rows.push({ ...t, ...cov });
      continue;
    }
    console.log(`team ${pad(t.id, 5)}      → 200  ${pad(t.name, 24)} squad ${pad(cov.squad, 4)} ` +
      `nationality present ${pad(cov.present, 4)} filled ${cov.filled}`);
    if (cov.samples.length) console.log(`                  e.g. ${cov.samples.join(' | ')}`);
    else if (cov.squad) console.log(`                  player keys: ${cov.keys.join(', ')}`);
    rows.push({ ...t, ...cov });
  }

  return { comp: comp.code, rows };
}

const results = [];
for (const c of COMPS) results.push(await probeComp(c));

/* ── Verdict ──────────────────────────────────────────────────────────────
   Gated deliberately. The only sentence this script is entitled to say about
   `nationality` is one backed by a squad it actually read. */
console.log(`\n${'='.repeat(72)}\nVERDICT\n${'='.repeat(72)}`);

let couldAsk = false;
let answered = false;

results.forEach((r) => {
  if (r.gate) {
    console.log(`${pad(r.comp, 5)} COULD NOT ASK — ${r.reason}`);
    console.log(`      This says nothing about nationality. The chain broke before the question.`);
    return;
  }
  const withSquad = r.rows.filter((x) => Number.isFinite(x.squad) && x.squad > 0);
  if (!withSquad.length) {
    console.log(`${pad(r.comp, 5)} COULD NOT ASK — ${r.rows.length} clubs answered, none returned a non-empty squad.`);
    console.log(`      Nationality was never in reach here; do not read this as "not provided".`);
    return;
  }
  couldAsk = true;
  const players = withSquad.reduce((s, x) => s + x.squad, 0);
  const filled = withSquad.reduce((s, x) => s + x.filled, 0);
  const present = withSquad.reduce((s, x) => s + x.present, 0);
  console.log(`${pad(r.comp, 5)} ASKED ${withSquad.length} clubs / ${players} players — ` +
    `nationality present on ${present}, filled on ${filled}`);
  if (filled === players) {
    answered = true;
    console.log(`      FILLED ON EVERY PLAYER. This is a usable nationality source on our plan.`);
  } else if (filled > 0) {
    answered = true;
    console.log(`      PARTIAL (${Math.round((filled / players) * 100)}%). Usable, but the gaps have to be`);
    console.log(`      shown as unknown rather than guessed, and this figure belongs in the doc.`);
  } else if (present > 0) {
    answered = true;
    console.log(`      PRESENT BUT EMPTY ON ALL OF THEM — the same shape 'referees' has.`);
    console.log(`      That is a tier limit, not a schema gap. Waiting will not fill it.`);
  } else {
    answered = true;
    console.log(`      KEY ABSENT ENTIRELY from the player rows on this plan.`);
  }
});

console.log(`\nWhat this probe does NOT tell you:`);
console.log(`  · Whether nationality equals call-up. It is eligibility. A Senegal-eligible`);
console.log(`    player is not a selected player, and anything built on this must say`);
console.log(`    "at risk", never "out".`);
console.log(`  · Anything about clubs it did not ask (capped at ${MAX_TEAMS} per competition to`);
console.log(`    stay under the ~10/min free-tier budget). Absence here means not asked.`);
console.log(`  · Whether football-data's terms permit the USE we would put it to. They are`);
console.log(`    published and we hold a key, which is more than can be said for the`);
console.log(`    alternative — but reachable is still not the same as permitted.`);

/* Exit code separates "measured, and here is the answer" from "could not
   measure". A red run means the instrument failed, NOT that the answer is no.
   Getting those two confused is the whole reason this file has gates. */
if (!couldAsk || !answered) {
  console.log(`\nEXIT 1 — the probe could not complete. This is not a finding.`);
  process.exit(1);
}
console.log(`\nEXIT 0 — probe completed; the verdict above is a measurement.`);
