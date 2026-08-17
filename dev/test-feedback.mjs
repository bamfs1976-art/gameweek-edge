/*
 * Tests for the feedback button and its sink (netlify/functions/feedback.js).
 *
 * Run: node dev/test-feedback.mjs   (wired into npm test)
 *
 * What is worth testing here is not that a form submits. It is the one
 * property the whole feature rests on:
 *
 *   THE APP MUST NEVER SAY "SENT" UNLESS A ROW EXISTS.
 *
 * The analytics sink beside it (track.js) deliberately returns 204 when
 * Supabase is unconfigured, because a dropped page-view harms nobody. Copying
 * that here would be the worst possible bug in this feature and it would look
 * exactly like working code: the user types a paragraph, sees "Thanks", and
 * the message is gone. So the tests below assert the OPPOSITE of track.js —
 * that an unconfigured or failing server produces an error status, and that
 * the client's success path is reachable only from a 204.
 *
 * Second property: feedback is the one field in this app where a user may
 * type anything about themselves. So the function must not echo the message
 * back in a response or write it to a log.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const fn = require(join(ROOT, 'netlify/functions/feedback.js'));
const { parse, emailish, KINDS } = fn._internal;
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; } else { fails.push(m); console.error('  ✗ ' + m); } };

const post = (body, env = {}) => {
  const saved = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
  if ('url' in env) { if (env.url === null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = env.url; }
  if ('key' in env) { if (env.key === null) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = env.key; }
  const p = fn.handler({ httpMethod: 'POST', body: JSON.stringify(body), headers: {} });
  return p.finally(() => {
    if (saved.u === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.u;
    if (saved.k === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.k;
  });
};

const SECRET = 'my landlord is reading my email and the xG on Haaland looks wrong';

console.log('• an unconfigured server reports failure — it does NOT no-op like track.js');
{
  const r = await post({ message: SECRET }, { url: null, key: null });
  ok(r.statusCode === 503, `unconfigured returns 503, got ${r.statusCode}`);
  ok(r.statusCode !== 204, 'unconfigured must NEVER return 204 — that is the "sent" signal');
  const body = JSON.parse(r.body);
  ok(/not saved/i.test(body.error), 'the error says plainly that it was not saved');
  ok(body.configured === false, 'and distinguishes "not switched on" from "broke"');
}

console.log('• a database that refuses the write is reported, not swallowed');
{
  const real = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500 });
  const r = await post({ message: SECRET }, { url: 'https://x.test', key: 'k' });
  global.fetch = real;
  ok(r.statusCode === 502, `a rejected write returns 502, got ${r.statusCode}`);
  ok(r.statusCode !== 204, 'a rejected write must never look like success');
}

console.log('• a missing table is called out separately from a broken one');
{
  const real = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404 });
  const r = await post({ message: SECRET }, { url: 'https://x.test', key: 'k' });
  global.fetch = real;
  ok(r.statusCode === 503, `a missing table returns 503, got ${r.statusCode}`);
  ok(/not set up/i.test(JSON.parse(r.body).error), 'and says the storage is not set up');
}

console.log('• a network failure reaching storage is reported');
{
  const real = global.fetch;
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  const r = await post({ message: SECRET }, { url: 'https://x.test', key: 'k' });
  global.fetch = real;
  ok(r.statusCode === 502, `a throw returns 502, got ${r.statusCode}`);
}

console.log('• only a real write returns the success signal');
{
  const real = global.fetch; let sent = null;
  global.fetch = async (_u, o) => { sent = JSON.parse(o.body); return { ok: true, status: 201 }; };
  const r = await post({ message: SECRET, kind: 'bug', email: 'a@b.co' }, { url: 'https://x.test', key: 'k' });
  global.fetch = real;
  ok(r.statusCode === 204, `a successful write returns 204, got ${r.statusCode}`);
  ok(sent && sent.message === SECRET, 'the message reaches storage intact');
  ok(sent && sent.kind === 'bug', 'the kind is stored');
  ok(sent && sent.email === 'a@b.co', 'a usable email is stored');
}

console.log('• the message never comes back out of the function');
{
  const real = global.fetch;
  const seen = []; const realErr = console.error;
  console.error = (...a) => seen.push(a.join(' '));
  global.fetch = async () => ({ ok: false, status: 500 });
  const r = await post({ message: SECRET }, { url: 'https://x.test', key: 'k' });
  global.fetch = real; console.error = realErr;
  ok(!r.body.includes(SECRET), 'the response body does not echo the message');
  ok(!seen.join(' ').includes(SECRET), 'the failure log does not contain the message');
  ok(seen.join(' ').includes('length'), 'the log records a length instead, so failures stay debuggable');
}

console.log('• validation keeps the message and drops only the nicety');
{
  ok(parse('{"message":""}').error, 'an empty message is rejected');
  ok(parse('not json').error, 'a malformed body is rejected');
  ok(parse('{"message":"x"}').error, 'a one-character message is rejected');
  const r = parse(JSON.stringify({ message: 'real feedback', email: 'not-an-email' }));
  ok(!r.error, 'a bad OPTIONAL email does not reject the whole submission');
  ok(r.row.email === null, 'the unusable email is dropped');
  ok(r.row.email_given_but_unusable === true, 'but the fact it was given is kept, so a reply can be chased');
  ok(parse(JSON.stringify({ message: 'x'.repeat(9000) })).row.message.length === 4000, 'the message is capped');
  ok(parse(JSON.stringify({ message: 'hi there', kind: 'nonsense' })).row.kind === 'other', 'an unknown kind falls back');
  ok(KINDS.includes('bug') && KINDS.includes('data'), 'the kinds the UI offers exist server-side');
  ok(!emailish('a@b') && emailish('a@b.co'), 'the email test is loose but not useless');
}

console.log('• the method guard');
{
  const r = await fn.handler({ httpMethod: 'GET', headers: {} });
  ok(r.statusCode === 405, 'GET is refused');
  ok(!('access-control-allow-origin' in
    Object.fromEntries(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]))),
  'no CORS header is emitted, so only this origin can post');
}

console.log('• the client cannot reach "Thanks" except from a successful send');
{
  /* The first version of this section counted "return;" occurrences and
     checked index order. It passed a mutation that deleted the return from
     the !r.ok branch — leaving the client to fall straight through into the
     success toast on a FAILED send, which is precisely the bug this whole
     feature is built to prevent. Counting tokens cannot see control flow.
     So the real submitFeedback is executed here against a stubbed fetch and
     the question asked directly: did it claim success? */
  const from = html.indexOf("let fbKind='other'");
  const to = html.indexOf('}', html.indexOf("toast('Thanks")) + 1;
  const src = html.slice(from, to);
  ok(from > -1 && to > from, 'the feedback client code was located in index.html');

  const runSend = async (fetchImpl) => {
    const calls = { toast: [], track: [], closed: 0, err: [] };
    const el = (id) => ({ id, value: id === 'fb-text' ? 'a real bug report' : '',
      textContent: '', innerHTML: '', disabled: false, classList: { toggle(){}, add(){}, remove(){}, contains(){ return false; } },
      appendChild(){}, addEventListener(){}, focus(){}, select(){}, setAttribute(){}, dataset: {} });
    const store = {};
    const sandbox = {
      document: {
        getElementById: (id) => (store[id] || (store[id] = el(id))),
        querySelectorAll: () => [], createElement: () => el('new'),
        addEventListener(){}, body: { appendChild(){} }
      },
      navigator: { userAgent: 'test', clipboard: null },
      fetch: fetchImpl,
      toast: (m) => calls.toast.push(m),
      track: (e, p) => calls.track.push(e),
      anonId: () => 'anon', apiBase: () => '', currentPanel: 'dashboard',
      setTimeout: (f) => f(), console
    };
    sandbox.window = sandbox; sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src + '\n;this.__send = submitFeedback;', sandbox);
    await sandbox.__send();
    calls.err = store['fb-err'] ? [store['fb-err'].innerHTML] : [];
    return { calls, store };
  };

  /* 503 — storage not configured. The exact case that would no-op in track.js */
  {
    const { calls, store } = await runSend(async () => ({ ok: false, status: 503,
      json: async () => ({ error: 'not saved', configured: false }) }));
    ok(calls.toast.length === 0, 'a 503 produces NO success toast');
    ok(!calls.track.includes('feedback_sent'), 'and is never recorded as sent');
    ok(/Not sent/.test(calls.err.join('')), 'the user is told it was not sent');
    ok(store['fb-text'].value === 'a real bug report', 'the typed message is still in the box');
  }
  /* 502 — the write was refused */
  {
    const { calls } = await runSend(async () => ({ ok: false, status: 502, json: async () => ({ error: 'nope' }) }));
    ok(calls.toast.length === 0, 'a 502 produces no success toast');
  }
  /* the network never reached the server */
  {
    const { calls, store } = await runSend(async () => { throw new Error('offline'); });
    ok(calls.toast.length === 0, 'a network failure produces no success toast');
    ok(store['fb-text'].value === 'a real bug report', 'and the message survives it');
  }
  /* 204 — a row exists. This is the ONLY route to "Thanks" */
  {
    const { calls } = await runSend(async () => ({ ok: true, status: 204, json: async () => ({}) }));
    ok(calls.toast.length === 1 && /Thanks/.test(calls.toast[0]), 'a 204 does toast success');
    ok(calls.track.includes('feedback_sent'), 'and records the send');
  }
  ok(/still here/.test(src), 'a failure tells the user their text was kept');
}

console.log('• the failure path gives the user a way out');
{
  ok(/function fbCopy/.test(html), 'there is a copy-out fallback');
  ok(/Copy my message instead/.test(html), 'and a failure offers it');
  ok(/fb-retry/.test(html), 'styled so it reads as an action');
}

console.log('• wiring, routing and disclosure');
{
  ok(/id="feedback-btn"/.test(html), 'the button exists');
  ok(/aria-label="Send feedback about this app"/.test(html), 'and is labelled for screen readers');
  ok(/getElementById\('feedback-btn'\)/.test(html), 'the button is wired');
  ok(/openFeedbackModal/.test(html), 'to the modal opener');
  ok(/role="dialog"[^>]*aria-modal="true"/.test(html.slice(html.indexOf('id="fb-modal"') - 120,
    html.indexOf('id="fb-modal"') + 200)) || /id="fb-modal"[^>]*role="dialog"/.test(html),
  'the modal is a labelled dialog');
  ok(/e\.key!=='Escape'/.test(html) || /key==='Escape'/.test(html), 'Escape closes it');
  ok(/from = "\/api\/feedback"/.test(toml), 'the /api/feedback route exists');
  ok(/to = "\/\.netlify\/functions\/feedback"/.test(toml), 'and points at the function');
  /* the CSP is connect-src 'self' plus two hosts; /api/* is same-origin, so
     this must NOT have required a CSP change. Assert that it did not. */
  const csp = /Content-Security-Policy = "([^"]+)"/.exec(toml)[1];
  ok(/connect-src 'self'/.test(csp), "connect-src still starts at 'self'");
  ok(!/feedback/i.test(csp), 'no CSP host was added for this — it is same-origin');
  /* what we attach must be disclosed in the UI, not just in the code */
  ok(/no name, no team, no email unless you type one/.test(html),
    'the modal discloses exactly what is attached');
  ok(/only if you want a reply/.test(html), 'and that the email is optional and why');
}

/* ══ THE INBOX (netlify/functions/feedback-inbox.js) ══════════════════════
   Reading feedback is a different risk from writing it. The write endpoint is
   public and holds nothing; the inbox returns everything anybody ever typed,
   including whatever they chose to say about themselves. So the gate is the
   thing under test here, and it is tested from the outside — no token, a
   token Supabase rejects, and a valid token whose email is not the owner. */
const inbox = require(join(ROOT, 'netlify/functions/feedback-inbox.js'));
const { collate } = inbox._internal;

const withEnv = async (fn, url = 'https://x.test', key = 'k') => {
  const s = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = url; process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  try { return await fn(); } finally {
    if (s.u === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = s.u;
    if (s.k === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = s.k;
  }
};
const get = (headers = {}, qs = {}) =>
  inbox.handler({ httpMethod: 'GET', headers, queryStringParameters: qs });

/* The owner allowlist ships a default hash; this is the email behind it. */
const OWNER = 'bamfs1976@gmail.com';

console.log('• the inbox is owner-gated, and the gate is server-side');
{
  const real = global.fetch;
  const asUser = (email) => async (u) => {
    if (String(u).includes('/auth/v1/user')) {
      return email ? { ok: true, json: async () => ({ email }) } : { ok: false, status: 401 };
    }
    return { ok: true, json: async () => [] };
  };

  await withEnv(async () => {
    global.fetch = asUser(OWNER);
    let r = await get({});
    ok(r.statusCode === 401, `no token is refused, got ${r.statusCode}`);

    global.fetch = asUser(null);           /* Supabase rejects the token */
    r = await get({ authorization: 'Bearer forged' });
    ok(r.statusCode === 401, `a token Supabase rejects is refused, got ${r.statusCode}`);

    global.fetch = asUser('someone.else@example.com');
    r = await get({ authorization: 'Bearer valid-but-not-owner' });
    ok(r.statusCode === 403, `a valid NON-owner session is refused, got ${r.statusCode}`);
    ok(!/message/i.test(r.body), 'and no feedback is in that response');

    global.fetch = asUser(OWNER);
    r = await get({ authorization: 'Bearer valid-owner' });
    ok(r.statusCode === 200, `the owner is allowed, got ${r.statusCode}`);
  });
  global.fetch = real;
}

console.log('• a missing table reads as "not set up", not as "no feedback"');
{
  const real = global.fetch;
  await withEnv(async () => {
    global.fetch = async (u) => String(u).includes('/auth/v1/user')
      ? { ok: true, json: async () => ({ email: OWNER }) }
      : { ok: false, status: 404 };
    const r = await get({ authorization: 'Bearer owner' });
    ok(r.statusCode === 503, `a missing table returns 503, got ${r.statusCode}`);
    ok(/gwedge_feedback\.sql/.test(r.body), 'and names the SQL file that fixes it');
  });
  global.fetch = real;
}

console.log('• an unconfigured server does not look like an empty inbox');
{
  const s = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await get({ authorization: 'Bearer owner' });
  if (s.u !== undefined) process.env.SUPABASE_URL = s.u;
  if (s.k !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = s.k;
  ok(r.statusCode === 503, `unconfigured returns 503, got ${r.statusCode}`);
  ok(r.statusCode !== 200, 'never a 200 with an empty list, which would read as "nobody wrote in"');
}

console.log('• what the inbox returns, and what it withholds');
{
  const real = global.fetch;
  await withEnv(async () => {
    global.fetch = async (u) => String(u).includes('/auth/v1/user')
      ? { ok: true, json: async () => ({ email: OWNER }) }
      : { ok: true, json: async () => [{ message: 'the grid is empty', kind: 'bug',
        email: 'a@b.co', email_given_but_unusable: false, page: 'Panel: fixtures',
        app: 'Mozilla/5.0', ts: new Date().toISOString(), anon_id: 'SECRET_ANON', ua: 'SECRET_UA' }] };
    const r = await get({ authorization: 'Bearer owner' });
    const d = JSON.parse(r.body);
    ok(d.items[0].message === 'the grid is empty', 'the message is returned — that is the point');
    ok(d.items[0].email === 'a@b.co', 'the reply-to address is returned, so a reply can be sent');
    ok(d.items[0].panel === 'fixtures', 'the "Panel: " prefix is stripped for grouping');
    ok(!r.body.includes('SECRET_ANON'), 'anon_id is withheld — the inbox is not a session tracker');
    ok(!r.body.includes('SECRET_UA'), 'the raw user agent is withheld');
  });
  global.fetch = real;
}

console.log('• the collation is arithmetic, not judgement');
{
  const now = '2026-08-20T12:00:00.000Z';
  const at = (d) => new Date(Date.parse(now) - d * 86400e3).toISOString();
  const rows = [
    { message: 'a', kind: 'bug', page: 'Panel: fixtures', ts: at(1) },
    { message: 'b', kind: 'bug', page: 'Panel: fixtures', ts: at(2), email: 'x@y.co' },
    { message: 'c', kind: 'idea', page: 'Panel: squad', ts: at(3) },
    { message: 'd', kind: 'nonsense', page: '', ts: at(30) },
    { message: 'e', kind: 'praise', page: 'Panel: squad', ts: at(40), email_given_but_unusable: true }
  ];
  const c = collate(rows, 90, now);
  ok(c.totals.all === 5, 'every row is counted');
  ok(c.totals.last7 === 3, `three inside seven days, got ${c.totals.last7}`);
  ok(c.totals.awaitingReply === 1, 'one left a usable address');
  ok(c.totals.unusableEmail === 1, 'one left an unusable one, counted separately');
  ok(c.byKind.find((k) => k.kind === 'bug').n === 2, 'bugs are grouped');
  ok(c.byKind.find((k) => k.kind === 'other').n === 1, 'an unknown kind falls back to other');
  ok(!c.byKind.some((k) => k.n === 0), 'kinds with no messages are not listed as zero rows');
  ok(c.byPanel[0].panel === 'fixtures' || c.byPanel[0].panel === 'squad', 'panels are ranked by volume');
  ok(c.byPanel.find((p) => p.panel === 'unknown').n === 1, 'a missing panel is named, not dropped');
  ok(c.totals.distinctPanels === 3, `three distinct panels, got ${c.totals.distinctPanels}`);
  ok(c.byDay.length === 5 && c.byDay[0].date > c.byDay[4].date, 'days are newest first');
  ok(!('score' in c) && !('sentiment' in c) && !('priority' in c),
    'nothing is scored or ranked — a count is all this data supports');
  ok(collate([], 90, now).totals.all === 0, 'an empty window collates to zero rather than throwing');
}

console.log('• the panel keeps its empty states apart');
{
  const fnSrc = html.slice(html.indexOf('async function hydrateFeedback'),
    html.indexOf('/* ── Analytics (owner)'));
  ok(/status===401/.test(fnSrc), 'a dead session is handled');
  ok(/status===403/.test(fnSrc) && /Owner only/.test(fnSrc), 'a non-owner is told so');
  ok(/status===503/.test(fnSrc) && /Inbox not set up/.test(fnSrc), 'an unconfigured server is told apart');
  ok(/No feedback yet/.test(fnSrc), 'and a genuinely empty inbox says so');
  ok(/The inbox is working/.test(fnSrc), 'and says the panel is working, so empty is not read as broken');
  /* the four must be different strings, or the distinction is cosmetic */
  const states = ['Sign in required', 'Owner only', 'Inbox not set up', 'No feedback yet'];
  ok(new Set(states.filter((s) => fnSrc.includes(s))).size === 4, 'all four states are distinct');
  ok(/fbItemCard/.test(fnSrc), 'messages are rendered');
  ok(/truncated/.test(fnSrc), 'a truncated page says it is truncated');
}

console.log('• a stranger wrote the message, so it must be escaped');
{
  const card = html.slice(html.indexOf('function fbItemCard'), html.indexOf('async function hydrateFeedback'));
  ok(/esc\(it\.message\)/.test(card), 'the message is escaped before it reaches innerHTML');
  ok(/esc\(it\.email\)/.test(card), 'so is the email');
  ok(/esc\(it\.app\)/.test(card), 'and the client hint');
  ok(!/\+it\.message/.test(card) && !/\$\{it\.message\}/.test(card),
    'the raw message is never concatenated in');
  ok(/esc\(it\.panel\)/.test(card), 'and the panel name');
}

console.log('• the panel is registered as owner-only and routed');
{
  ok(/\{id:'feedback', label:'Feedback', icon:'[a-z]+', tier:'owner'\}/.test(html),
    'the panel is owner tier in NAV');
  ok(/feedback:hydrateFeedback/.test(html), 'and wired to its renderer');
  ok(/from = "\/api\/feedback-inbox"/.test(toml), 'the inbox route exists');
  const an = readFileSync(join(ROOT, 'netlify/functions/analytics.js'), 'utf8');
  ok(/studio: \['social', 'analytics', 'feedback'\]/.test(an),
    'analytics knows the panel exists, so its area map does not drift');
  ok(/OWNER_PANELS = new Set\(\['social', 'analytics', 'feedback'\]\)/.test(an),
    'and opening it counts as proof of the owner, like the other owner panels');
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
