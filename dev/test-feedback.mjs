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

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
