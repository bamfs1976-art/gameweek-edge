/* Gameweek Edge — user feedback sink (Netlify Function)

   POST { message, kind?, email?, page?, app? } -> 204.
   Inserts a row into gwedge_feedback via the service-role key.

   WHY THIS IS NOT track.js
   ------------------------
   The analytics sink deliberately no-ops with 204 when Supabase isn't
   configured, because a dropped page-view should never break the app and
   nobody is waiting on it. Feedback is the opposite: somebody has just typed
   a paragraph and is watching for confirmation. Returning 204 when the row
   was never written would tell them their message was received when it was
   thrown away — the app lying about its own state, which is the one thing
   this project does not do.

   So every failure here is REPORTED:
     503  storage not configured (or the table is missing)
     502  the database rejected or dropped the write
     400  nothing usable in the request
   and the client keeps the user's text on screen and offers another route
   out. A 204 from this function means a row exists.

   Same-origin only: no CORS headers are emitted, so a page on another origin
   cannot post here. The service-role key never leaves the function.

   The message body is never echoed back in a response and never logged. A
   failure log carries the status and the length, not the content — feedback
   can contain anything, including things about the person writing it. */

const MAX = { message: 4000, email: 200, page: 120, kind: 24, app: 40, ua: 300 };
const KINDS = ['bug', 'idea', 'data', 'praise', 'other'];

const json = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj)
});
const clip = (v, n) => (v == null ? null : String(v).slice(0, n).trim() || null);

/* Loose on purpose. This is a reply-to hint the user typed, not an identity
   claim — anything that cannot possibly be an address is rejected and the
   rest is stored as given. Over-strict validation here rejects real people. */
const emailish = (s) => !!s && s.length <= MAX.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function parse(body) {
  let b;
  try { b = JSON.parse(body || '{}'); } catch (_) { return { error: 'That did not arrive as valid JSON.' }; }

  const message = clip(b.message, MAX.message);
  if (!message) return { error: 'A message is required.' };
  if (message.length < 2) return { error: 'That message is too short to be useful.' };

  const kindRaw = clip(b.kind, MAX.kind);
  const kind = KINDS.includes(kindRaw) ? kindRaw : 'other';

  const email = clip(b.email, MAX.email);
  /* An unusable address is dropped rather than rejected: the feedback is the
     point, and refusing the whole submission over a typo in an OPTIONAL field
     would lose the message to protect a nicety. */
  const row = {
    message,
    kind,
    email: emailish(email) ? email : null,
    email_given_but_unusable: !!email && !emailish(email),
    page: clip(b.page, MAX.page),
    app: clip(b.app, MAX.app),
    anon_id: clip(b.anon_id, 64)
  };
  return { row };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only.' });

  const { row, error } = parse(event.body);
  if (error) return json(400, { error });

  const supaUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) {
    return json(503, {
      error: 'Feedback storage is not configured on the server, so this was not saved.',
      configured: false
    });
  }

  row.ua = clip(event.headers && event.headers['user-agent'], MAX.ua);

  let r;
  try {
    r = await fetch(supaUrl + '/rest/v1/gwedge_feedback', {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(row)
    });
  } catch (e) {
    console.error('feedback: network error reaching storage; message length', row.message.length);
    return json(502, { error: 'Could not reach the server, so this was not saved.' });
  }

  if (!r.ok) {
    /* 404 here almost always means the table has not been created yet. Say so
       distinctly: "not saved" is true either way, but the two have completely
       different fixes and the owner is usually the one hitting this. */
    const missingTable = r.status === 404;
    console.error('feedback: storage rejected the write, status', r.status,
      '; message length', row.message.length);
    return json(missingTable ? 503 : 502, {
      error: missingTable
        ? 'Feedback storage is not set up on the server, so this was not saved.'
        : 'The server could not save this.',
      configured: !missingTable
    });
  }

  return json(204, {});
};

exports._internal = { parse, emailish, KINDS, MAX };
