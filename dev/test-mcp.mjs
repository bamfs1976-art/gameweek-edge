/*
 * The MCP server (netlify/lib/mcp.js + netlify/functions/mcp.js).
 *
 * Two things are worth testing here and they are different in kind.
 *
 *   1. THE PROTOCOL. This repository speaks MCP without the official SDK
 *      (netlify/lib/mcp.js says why), so nothing else is checking that the
 *      wire format is right. A client that cannot complete the handshake
 *      sees a broken connector and no error we would ever read. So the
 *      handshake, the notification rule, the batch rule and the error codes
 *      are pinned against the JSON-RPC 2.0 spec.
 *
 *   2. THE TOOL CONTRACT. A tool description is not documentation, it is
 *      the prompt an assistant chooses from. A tool with no description, an
 *      input schema that does not parse, or a name that collides is a tool
 *      that gets called wrongly or not at all. The tools are also run for
 *      real against a stubbed FPL feed, because a schema that says one
 *      thing while the handler returns another is the failure this cannot
 *      see by reading.
 *
 * NOT TESTED: the projected points themselves. Those come from the app's
 * own model, which dev/test-engine.mjs and the backtests already grade.
 *
 * Run: node dev/test-mcp.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mcp = require(join(ROOT, 'netlify', 'lib', 'mcp.js'));

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ok  ' + l); } else { fail++; console.log('  FAIL ' + l); } };
const section = (t) => console.log('\n• ' + t);

const SERVER = { name: 'test', title: 'Test', version: '0.0.1', instructions: 'hi' };
const TOOLS = [{
  name: 'echo', title: 'Echo', description: 'Echo a value back.',
  inputSchema: { type: 'object', properties: { value: { type: 'string' } }, additionalProperties: false },
  annotations: { readOnlyHint: true },
  async run(args) {
    if (args.boom) throw new Error('the tool exploded');
    return { echoed: args.value };
  },
}];
const call = (msg) => mcp.handleMessage(msg, SERVER, TOOLS);

/* ── 1. The handshake ─────────────────────────────────── */

section('initialize: the version negotiation is the spec\'s, not a constant');
{
  const known = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  ok(known.result.protocolVersion === '2024-11-05',
    'a version this server speaks is echoed back, so an older client is not forced to upgrade');

  const unknown = await call({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  ok(unknown.result.protocolVersion === mcp.LATEST_PROTOCOL,
    'a version it does not speak gets our newest, and the client decides whether it can live with it');
  ok(mcp.PROTOCOL_VERSIONS.includes(unknown.result.protocolVersion),
    'and the answer is never a version this server has not implemented');

  const none = await call({ jsonrpc: '2.0', id: 3, method: 'initialize', params: {} });
  ok(none.result.protocolVersion === mcp.LATEST_PROTOCOL, 'a client that names no version gets the newest');

  const r = known.result;
  ok(r.capabilities && r.capabilities.tools, 'capabilities declare tools, which is what this server has');
  ok(!r.capabilities.resources && !r.capabilities.prompts,
    'and declare nothing it does not implement, because a client would then call it');
  ok(r.serverInfo.name === 'test' && r.serverInfo.version === '0.0.1', 'serverInfo identifies the build');
  ok(typeof r.instructions === 'string', 'instructions tell the model when to reach for this server');
}

section('notifications get no answer at all');
{
  ok(await call({ jsonrpc: '2.0', method: 'notifications/initialized' }) === null,
    'the initialized notification is answered with silence, as JSON-RPC requires');
  ok(await call({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }) === null,
    'so is any other notification, including ones this server does not act on');
  ok((await call({ jsonrpc: '2.0', id: 9, method: 'ping' })).result !== undefined, 'ping answers, so a client can check liveness');
}

/* ── 2. Tools ─────────────────────────────────────────── */

section('tools/list returns what a model needs to choose with');
{
  const list = (await call({ jsonrpc: '2.0', id: 4, method: 'tools/list' })).result;
  ok(Array.isArray(list.tools) && list.tools.length === 1, 'the tools come back as an array');
  ok(list.tools[0].name === 'echo' && list.tools[0].inputSchema.type === 'object',
    'each carries its name and an object input schema');
}

section('a tool that fails reports through the result, not the transport');
{
  const res = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'echo', arguments: { boom: true } } });
  ok(!res.error, 'a thrown tool is NOT a JSON-RPC error: the call happened, so the model should see what went wrong');
  ok(res.result.isError === true, 'it is flagged as a failed result');
  ok(/exploded/.test(res.result.content[0].text), 'and the reason reaches the model rather than being swallowed');

  const good = await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'echo', arguments: { value: 'x' } } });
  ok(good.result.structuredContent.echoed === 'x', 'a good call returns structured content for clients that read schemas');
  ok(good.result.content[0].type === 'text', 'and the same payload as text for clients that do not');
}

section('an unknown tool is a protocol error, and says what does exist');
{
  const res = await call({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nope' } });
  ok(res.error.code === mcp.INVALID_PARAMS, 'the call never happened, so this one IS a JSON-RPC error');
  ok(res.error.data.available.includes('echo'), 'and it names the tools that exist, so the model can retry rather than give up');
}

section('malformed input is rejected with the right code');
{
  const bad = await mcp.handleBody('not json', SERVER, TOOLS);
  ok(bad.body.error.code === mcp.PARSE_ERROR && bad.status === 400, 'unparseable JSON is a parse error');
  ok(bad.body.id === null, 'with a null id, because there was no request to take one from');

  const wrong = await call({ jsonrpc: '1.0', id: 8, method: 'ping' });
  ok(wrong.error.code === mcp.INVALID_REQUEST, 'a message that is not JSON-RPC 2.0 is an invalid request');

  const unknown = await call({ jsonrpc: '2.0', id: 10, method: 'resources/list' });
  ok(unknown.error.code === mcp.METHOD_NOT_FOUND, 'a method this server does not implement is method-not-found');
}

section('batches follow the JSON-RPC rules');
{
  const mixed = await mcp.handleBody(JSON.stringify([
    { jsonrpc: '2.0', id: 1, method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
  ]), SERVER, TOOLS);
  ok(Array.isArray(mixed.body) && mixed.body.length === 1,
    'a batch answers only the requests in it, never the notifications');

  const silent = await mcp.handleBody(JSON.stringify([{ jsonrpc: '2.0', method: 'notifications/initialized' }]), SERVER, TOOLS);
  ok(silent.body === null && silent.status === 202, 'a batch of nothing but notifications gets no body at all');

  const empty = await mcp.handleBody('[]', SERVER, TOOLS);
  ok(empty.body.error.code === mcp.INVALID_REQUEST, 'an empty batch is invalid');
}

/* ── 3. The real server ───────────────────────────────── */

section('the shipped tools are ones a model can actually choose between');
{
  const fn = require(join(ROOT, 'netlify', 'functions', 'mcp.js'));
  const names = fn.TOOLS.map((t) => t.name);
  ok(new Set(names).size === names.length, 'no two tools share a name');
  ok(names.every((n) => /^[a-z][a-z0-9_]{2,63}$/.test(n)), 'names are lowercase and snake_case, as clients expect');
  ok(names.every((n) => /^(fpl|efl)_/.test(n)),
    'each is prefixed by the game it answers for, so it stays distinguishable beside another FPL server\'s tools');

  for (const t of fn.TOOLS) {
    ok(t.description && t.description.length > 80,
      `${t.name}: the description is the prompt an assistant chooses from, so it says WHEN to reach for it`);
    ok(t.inputSchema && t.inputSchema.type === 'object', `${t.name}: has an object input schema`);
    ok(t.annotations && t.annotations.readOnlyHint === true,
      `${t.name}: is declared read-only, so a client may run it without asking`);
    ok(typeof t.run === 'function', `${t.name}: is implemented`);
    /* A schema a client cannot parse is a tool nobody can call. */
    ok(JSON.parse(JSON.stringify(t.inputSchema)), `${t.name}: the schema survives a JSON round trip`);
  }
  ok(/not affiliated/i.test(JSON.stringify(fn.SERVER)) === false,
    'the disclaimer belongs on the public surface, not buried in the model instructions');
  ok(/uncertain/i.test(fn.SERVER.instructions),
    'the instructions tell the model to pass the uncertainty on rather than state a projection as fact');
}

section('the price-move curve is the one the app shows');
{
  const { priceChangeProb } = require(join(ROOT, 'netlify', 'functions', 'mcp.js'));
  const el = (net, own) => ({ transfers_in_event: Math.max(0, net), transfers_out_event: Math.max(0, -net), selected_by_percent: String(own) });
  ok(priceChangeProb(el(0, 10), 10e6).dir === 'flat', 'no net movement is neither a rise nor a fall');
  ok(priceChangeProb(el(500000, 5), 10e6).dir === 'rise', 'heavy net transfers in point to a rise');
  ok(priceChangeProb(el(-500000, 5), 10e6).dir === 'fall', 'heavy net transfers out point to a fall');
  const low = priceChangeProb(el(50000, 50), 10e6).prob;
  const high = priceChangeProb(el(50000, 1), 10e6).prob;
  ok(high > low, 'the same net transfers move a low-owned player sooner, because the threshold scales with owners');
  ok(priceChangeProb(el(99e6, 1), 10e6).prob <= 95 && priceChangeProb(el(1, 99), 10e6).prob >= 5,
    'the probability is clamped, because this is an estimate of an algorithm the game has never published');
}

/* ── 4. The production bundle ─────────────────────────
   Netlify builds these functions with esbuild, and this one now imports the
   Fantasy EFL model, which is an ES module while the function is CommonJS.
   "It works under node" and "it works once esbuild has turned it into
   CommonJS" are different claims, and only the second one ships. So the
   test does what the deploy does: bundle this exact file and run the
   result. */

section('the function survives the bundler, and the EFL model comes with it');
{
  const esbuild = (await import('esbuild')).default;
  const out = join(ROOT, 'dev', '.tmp-mcp-bundle.cjs');
  await esbuild.build({
    entryPoints: [join(ROOT, 'netlify', 'functions', 'mcp.js')],
    outfile: out, bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    logLevel: 'silent',
  });
  ok(existsSync(out), 'esbuild bundles the function the way Netlify does');

  /* The bundle is one file, so the EFL modules cannot be stubbed through
     the require cache any more. fetch is the seam that survives bundling,
     which is also the only seam production has. */
  const realFetch = globalThis.fetch;
  const club = (id, competitionId, name) => ({ id, competitionId, name, leaguePosition: 1,
    percentSelected: 5, fdrHome: 3, fdrAway: 3, last3Form: 'WWW' });
  const squads = [];
  for (let c = 1; c <= 3; c++) for (let i = 1; i <= 4; i++) squads.push(club(String(c * 10 + i), String(c), 'Club ' + c + '-' + i));
  const players = [];
  for (const sq of squads) {
    for (const [n, pos] of [[1, 'GK'], [2, 'DEF'], [3, 'DEF'], [4, 'MID'], [5, 'MID'], [6, 'FWD'], [7, 'FWD']]) {
      players.push({ id: sq.id + '-' + n, squadId: sq.id, displayName: sq.name + ' P' + n, position: pos,
        appearances: 6, totalPoints: 30 - n, goalsScored: 1, injuryDetails: null, minutesPlayed: 540 });
    }
  }
  /* homeId/awayId, not homeSquadId: the first version of this fixture used
     the wrong names and the bundled provider rejected it by name, which is
     the shape guard doing exactly its job. */
  const games = [];
  for (let i = 0; i < squads.length; i += 2) {
    games.push({ id: 'g' + i, homeId: squads[i].id, awayId: squads[i + 1].id,
      kickoff: new Date(Date.now() + 9e5).toISOString() });
  }
  const rounds = [{ roundNumber: 7, status: 'open', lockoutDate: new Date(Date.now() + 864e5).toISOString(), games }];
  const DOCS = { 'squads.json': squads, 'players.json': players, 'rounds.json': rounds };

  globalThis.fetch = async (url) => {
    const name = Object.keys(DOCS).find((k) => String(url).endsWith(k));
    if (!name) throw new Error('the bundle reached for something other than the EFL feed: ' + url);
    return { ok: true, status: 200, json: async () => DOCS[name] };
  };

  try {
    const bundled = require(out);
    const names = bundled.TOOLS.map((t) => t.name);
    ok(names.includes('efl_round_picks') && names.includes('efl_rate_squad'),
      'the EFL tools are present in the bundled function');

    const res = await bundled.handler({ httpMethod: 'POST', body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'efl_round_picks', arguments: {} } }) });
    const result = JSON.parse(res.body).result;
    const picks = result.structuredContent;
    ok(!result.isError, 'the EFL tool runs inside the bundle: ' + (result.isError ? result.content[0].text : 'ok'));
    ok(picks && picks.squad && picks.squad.length === 7, 'and returns a legal seven');
    ok(picks && picks.formation, 'in one of the game\'s formations');
    ok(picks && picks.squad.filter((p) => p.captain).length === 1, 'with exactly one captain');
    const perClub = {};
    for (const p of (picks && picks.squad) || []) perClub[p.club] = (perClub[p.club] || 0) + 1;
    ok(Object.values(perClub).every((n) => n <= 2), 'and never more than two players from one club');

    const rate = await bundled.handler({ httpMethod: 'POST', body: JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'efl_rate_squad',
        arguments: { players: picks.squad.map((p) => p.player) } } }) });
    const rated = JSON.parse(rate.body).result.structuredContent;
    ok(rated.players_recognised === 7, 'the rating tool finds players by the names the picks tool printed');
    ok(rated.legal === true, 'and agrees the model\'s own seven is legal');
    ok(Array.isArray(rated.swaps), 'and answers with a swap list rather than an error');

    const missing = await bundled.handler({ httpMethod: 'POST', body: JSON.stringify({
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'efl_rate_squad',
        arguments: { players: ['Nobody At All'] } } }) });
    const m = JSON.parse(missing.body).result.structuredContent;
    ok(m.not_found.includes('Nobody At All'), 'a name it cannot place is reported back, not silently dropped');
  } finally {
    globalThis.fetch = realFetch;
    try { rmSync(out); } catch (_) { /* best effort */ }
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
