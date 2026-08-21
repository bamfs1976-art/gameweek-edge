/*
 * Proves dev/probe-squad-nationality.mjs can tell its six answers apart.
 *
 * A probe whose gates have never been made to fire is a probe you are
 * trusting on its own word. This one's whole claim is that it distinguishes
 * "asked, and the answer is no" from "never got to ask" — and that
 * distinction is worth exactly nothing until something has driven it down
 * both paths and watched it say different things.
 *
 * So: a mock of our own proxy, six scenarios, and an assertion on what the
 * probe SAYS about each. The scenarios include the two failure shapes this
 * repository has actually met — a key present but never filled (`referees`)
 * and a chain that broke upstream of the question (the guessed fixture id) —
 * because those are the ones a careless reader would file as "not provided".
 *
 * Runs in about a second. No network: GWE_BASE points at localhost and
 * GWE_PACE_MS collapses the rate-limit spacing.
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROBE = path.join(HERE, 'probe-squad-nationality.mjs');
const PORT = 8097;

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log(`  FAIL  ${msg}`); } };

/* Squad rows in the shapes football-data could plausibly return. */
const player = (id, name, nat) => {
  const p = { id, name, position: 'Midfield', dateOfBirth: '1998-01-01' };
  if (nat !== undefined) p.nationality = nat;
  return p;
};

const SCENARIOS = {
  /* The outcome that would settle the licensing question by making it moot. */
  filled: (n) => Array.from({ length: n }, (_, i) => player(i + 1, `P${i + 1}`, 'Brazil')),
  /* Half filled — usable, but the gaps must show as unknown, not guessed. */
  partial: (n) => Array.from({ length: n }, (_, i) => player(i + 1, `P${i + 1}`, i % 2 ? 'Brazil' : '')),
  /* The `referees` shape: schema says yes, tier says nothing. */
  emptyValues: (n) => Array.from({ length: n }, (_, i) => player(i + 1, `P${i + 1}`, '')),
  /* The key simply is not on the plan's player rows. */
  noKey: (n) => Array.from({ length: n }, (_, i) => player(i + 1, `P${i + 1}`)),
  /* 200, valid JSON, no squad at all — nothing to look in. */
  noSquad: () => null,
  /* Empty squad. Distinct from noSquad, same consequence: nothing to look in. */
  emptySquad: () => []
};

let scenario = 'filled';
let matchdayMode = 'normal';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const meta = { route: 'x', upstreamStatus: 200, requestsAvailableMinute: '9' };

  if (url.pathname.endsWith('/matchday')) {
    if (matchdayMode === 'empty') return send(200, { matches: [], _meta: meta });
    if (matchdayMode === 'error') return send(503, { error: 'FOOTBALL_DATA_KEY is not visible to this function' });
    return send(200, {
      matches: [
        { id: 1, homeTeam: { id: 57, name: 'Arsenal' }, awayTeam: { id: 64, name: 'Liverpool' } },
        { id: 2, homeTeam: { id: 65, name: 'Man City' }, awayTeam: { id: 57, name: 'Arsenal' } }
      ],
      _meta: meta
    });
  }

  if (url.pathname.endsWith('/team')) {
    const squad = SCENARIOS[scenario](20);
    const body = { id: Number(url.searchParams.get('id')), name: 'A Club', _meta: meta };
    if (squad !== null) body.squad = squad;
    return send(200, body);
  }

  send(404, { error: 'not found' });
});

const run = () => new Promise((resolve) => {
  const p = spawn(process.execPath, [PROBE], {
    env: { ...process.env, GWE_BASE: `http://localhost:${PORT}`, GWE_PACE_MS: '1' }
  });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ out, code }));
});

await new Promise((r) => server.listen(PORT, r));

console.log('probe-squad-nationality — gate behaviour');

/* 1. The answer we are hoping for. */
scenario = 'filled'; matchdayMode = 'normal';
let r = await run();
ok(/FILLED ON EVERY PLAYER/.test(r.out), 'filled squad should report FILLED ON EVERY PLAYER');
ok(r.code === 0, `filled squad should exit 0 (got ${r.code})`);
ok(!/COULD NOT ASK/.test(r.out), 'filled squad should not claim it could not ask');
ok(/Brazil/.test(r.out), 'filled squad should print a real sample value, not just a count');

/* 2. Usable but incomplete — the percentage has to reach the reader. */
scenario = 'partial';
r = await run();
ok(/PARTIAL \(50%\)/.test(r.out), 'half-filled squad should report PARTIAL (50%)');
ok(r.code === 0, `partial squad should exit 0 (got ${r.code})`);

/* 3. The failure this repo has already met once. It must NOT read as a
      schema gap, and it must NOT read as something waiting will fix. */
scenario = 'emptyValues';
r = await run();
ok(/PRESENT BUT EMPTY ON ALL OF THEM/.test(r.out), 'empty values should report PRESENT BUT EMPTY');
ok(/tier limit, not a schema gap/.test(r.out), 'empty values should name it as a tier limit');
ok(!/FILLED ON EVERY PLAYER/.test(r.out), 'empty values must not report FILLED');
ok(r.code === 0, `empty values is a measurement, so exit 0 (got ${r.code})`);

/* 4. Key genuinely absent from the plan's rows. */
scenario = 'noKey';
r = await run();
ok(/KEY ABSENT ENTIRELY/.test(r.out), 'missing key should report KEY ABSENT ENTIRELY');
ok(/position/.test(r.out), 'missing key should print the keys it DID get, so the gap is checkable');
ok(r.code === 0, `missing key is a measurement, so exit 0 (got ${r.code})`);

/* 5 & 6. The two ways the question never gets asked. Both must refuse to say
   anything about nationality, and both must go red. */
for (const s of ['noSquad', 'emptySquad']) {
  scenario = s;
  r = await run();
  ok(/COULD NOT ASK/.test(r.out), `${s} should report COULD NOT ASK`);
  ok(/do not read this as|says nothing about nationality/.test(r.out),
    `${s} should warn against reading it as a finding`);
  ok(!/PRESENT BUT EMPTY|KEY ABSENT|FILLED ON EVERY/.test(r.out),
    `${s} must not render as any verdict about nationality`);
  ok(r.code === 1, `${s} should exit 1 — the instrument failed, not the answer (got ${r.code})`);
}

/* 7. Chain broken upstream: no matches, so no ids, so no question. */
scenario = 'filled'; matchdayMode = 'empty';
r = await run();
ok(/COULD NOT ASK/.test(r.out), 'no matches should report COULD NOT ASK');
ok(/no team ids/.test(r.out), 'no matches should name the broken link');
ok(!/FILLED ON EVERY PLAYER/.test(r.out), 'no matches must not inherit the squad verdict');
ok(r.code === 1, `no matches should exit 1 (got ${r.code})`);

/* 8. The proxy itself refusing — the 503 the function returns when the key is
      not visible to it. Distinct from every data answer above. */
matchdayMode = 'error';
r = await run();
ok(/COULD NOT ASK/.test(r.out), 'proxy 503 should report COULD NOT ASK');
ok(/HTTP 503/.test(r.out), 'proxy 503 should name the status');
ok(r.code === 1, `proxy 503 should exit 1 (got ${r.code})`);

server.close();
console.log(`${checks - fails}/${checks} checks passed`);
if (fails) process.exit(1);
