/* Gameweek Edge — feedback inbox (Netlify Function)
   GET /api/feedback-inbox?days=90 -> collated user feedback.

   OWNER ONLY, AND THE GATE IS SERVER-SIDE — the same gate as analytics.js.
   window.GE_OWNER is a client flag anyone can set in a console, so it hides
   the panel and protects nothing. The caller sends its Supabase access token,
   this function verifies it against Supabase (which signed it, so the email
   cannot be forged), hashes the verified email and checks the owner allowlist.
   Anything else gets 403.

   This endpoint is deliberately kept SEPARATE from feedback.js. That one is a
   public write with no auth at all; this one reads everything anybody has ever
   written. Putting both behind one handler means one wrong branch exposes the
   lot, and the write path is the last place that should grow conditionals.

   What it returns, and what it does not:

     RETURNED   message, kind, page, app, ts, and the reply-to email the user
                typed. All of it is needed to act on the feedback — the email
                because the whole point of collecting it was to reply.
     WITHHELD   anon_id and user agent. anon_id is the analytics join key, so
                returning it would turn the inbox into a way to follow one
                person's session history around the app. Nothing about acting
                on feedback needs that. `app` (a short client hint the sender
                chose to attach) covers the reproduce-a-bug case.

   The collation is done here rather than in the browser so the panel cannot
   drift from the numbers, and so a truncated page reads as truncated instead
   of as "feedback dried up". */

const OWNER_HASHES = (process.env.OWNER_EMAIL_HASHES ||
  '3030acf5031d5b815d5e50e0db6cac1beaf3ea9209300ac42fc42bbf2d81fab6')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const KINDS = ['bug', 'data', 'idea', 'praise', 'other'];
const PAGE = 1000;
const MAX_ROWS = 5000;

const json = (code, body) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body)
});

async function sha256Hex(s) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');
}

async function verifyEmail(supaUrl, serviceKey, token) {
  try {
    const r = await fetch(supaUrl + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: serviceKey }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.email ? u.email : null;
  } catch (_) { return null; }
}

/* Page through the table. PostgREST caps a response, and a silent truncation
   in an inbox reads as "nobody has written in", which is the opposite of what
   it means. If the cap is hit the response says so and the panel prints it. */
async function fetchRows(supaUrl, serviceKey, sinceIso) {
  const rows = [];
  let truncated = false;
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const url = supaUrl + '/rest/v1/gwedge_feedback' +
      '?select=message,kind,email,email_given_but_unusable,page,app,ts' +
      '&ts=gte.' + encodeURIComponent(sinceIso) +
      '&order=ts.desc';
    const r = await fetch(url, {
      headers: {
        apikey: serviceKey, Authorization: 'Bearer ' + serviceKey,
        Range: from + '-' + (from + PAGE - 1), 'Range-Unit': 'items'
      }
    });
    if (!r.ok) { const e = new Error('feedback HTTP ' + r.status); e.status = r.status; throw e; }
    const batch = await r.json();
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, truncated };
    if (rows.length >= MAX_ROWS) truncated = true;
  }
  return { rows, truncated };
}

const day = (ts) => String(ts || '').slice(0, 10);

/* Collate: counts that answer "what should I look at first", then the items.
   Deliberately NOT a sentiment score or a ranking — those invent a judgement
   the data does not contain. Grouping and counting is all this can honestly do. */
function collate(rows, days, nowIso) {
  const now = nowIso ? new Date(nowIso) : new Date();
  const cutoff7 = new Date(now.getTime() - 7 * 86400e3).toISOString();

  const byKind = {};
  for (const k of KINDS) byKind[k] = 0;
  const byPanel = {};
  const byDay = {};
  let awaitingReply = 0, unusableEmail = 0, last7 = 0;

  for (const r of rows) {
    const kind = KINDS.includes(r.kind) ? r.kind : 'other';
    byKind[kind]++;
    if (r.ts >= cutoff7) last7++;
    if (r.email) awaitingReply++;
    if (r.email_given_but_unusable) unusableEmail++;
    /* page arrives as "Panel: fixtures" from the client; group on the panel. */
    const p = (String(r.page || '').replace(/^Panel:\s*/i, '').trim() || 'unknown');
    byPanel[p] = (byPanel[p] || 0) + 1;
    const d = day(r.ts);
    if (d) byDay[d] = (byDay[d] || 0) + 1;
  }

  const items = rows.map((r) => ({
    message: r.message,
    kind: KINDS.includes(r.kind) ? r.kind : 'other',
    email: r.email || null,
    emailUnusable: !!r.email_given_but_unusable,
    panel: (String(r.page || '').replace(/^Panel:\s*/i, '').trim() || null),
    app: r.app || null,
    ts: r.ts
  }));

  return {
    windowDays: days,
    totals: {
      all: rows.length,
      last7,
      awaitingReply,
      unusableEmail,
      /* Named so it cannot be mistaken for "nobody wrote in": an empty window
         and an unconfigured server must never render the same way. */
      distinctPanels: Object.keys(byPanel).length
    },
    byKind: KINDS.map((k) => ({ kind: k, n: byKind[k] })).filter((x) => x.n > 0),
    byPanel: Object.entries(byPanel).map(([panel, n]) => ({ panel, n }))
      .sort((a, b) => b.n - a.n || a.panel.localeCompare(b.panel)),
    byDay: Object.entries(byDay).map(([date, n]) => ({ date, n }))
      .sort((a, b) => (a.date < b.date ? 1 : -1)),
    items
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET only.' });

  const supaUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) {
    return json(503, { error: 'Feedback storage is not configured on the server.' });
  }

  const auth = (event.headers &&
    (event.headers.authorization || event.headers.Authorization)) || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'Sign in as the owner to read feedback.' });

  const email = await verifyEmail(supaUrl, serviceKey, token);
  if (!email) return json(401, { error: 'That session is not valid.' });
  const hash = await sha256Hex(email);
  if (!OWNER_HASHES.includes(hash)) return json(403, { error: 'Owner only.' });

  const qs = (event.queryStringParameters || {});
  const days = Math.min(365, Math.max(1, parseInt(qs.days, 10) || 90));
  const sinceIso = new Date(Date.now() - days * 86400e3).toISOString();

  let got;
  try {
    got = await fetchRows(supaUrl, serviceKey, sinceIso);
  } catch (e) {
    /* 404 = the table has not been created. Distinct from "it broke", because
       the fix is completely different and the owner is the one seeing this. */
    if (e.status === 404) {
      return json(503, {
        error: 'The gwedge_feedback table does not exist yet — run supabase/gwedge_feedback.sql.'
      });
    }
    return json(502, { error: 'Could not read feedback: ' + (e.message || 'unknown error') });
  }

  const out = collate(got.rows, days);
  out.truncated = got.truncated;
  return json(200, out);
};

exports._internal = { collate, KINDS, MAX_ROWS };
