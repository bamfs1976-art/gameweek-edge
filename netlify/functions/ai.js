/* Gameweek Edge — unified AI endpoint (Claude, Netlify Function)
   POST { task, context, messages? } -> { text }.
   The numbers come from our own models; Claude reasons over the JSON we
   pass and must not invent data. One function serves every AI feature
   (scout report, chat, transfer plan, digest, review, player, chips,
   rival).

   Auth: requires an `Authorization: Bearer <Supabase access token>`
   header. The token is verified against Supabase (`/auth/v1/user`) and
   the caller's tier is read server-side from gwedge_profiles with the
   service-role key — the client's local tier flag is never trusted.
   Pro-only tasks return 403 for free-tier users, and every user has a
   daily call quota tracked in gwedge_ai_usage.

   Graceful degradation: missing ANTHROPIC_API_KEY -> 503 setup note;
   missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY -> 503 setup note.
   Keys never reach the client. */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};
const json = (code, obj) => ({ statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

const DAILY_QUOTA = 50;

const BASE =
  "You are the scout for Gameweek Edge, a calm, expert companion for Fantasy Premier League managers. " +
  "Reason ONLY over the JSON data provided — never invent players, fixtures, prices or statistics not in it. " +
  "'xP' is our predicted points for the upcoming gameweek; prefer it when comparing players. Only recommend " +
  "players that appear in the data. Use British English and GitHub-flavoured markdown. Be concise and practical. " +
  "Never claim any affiliation with the Premier League or the official Fantasy Premier League game. No preamble, no disclaimers.";

/* task -> { sys, instruction, model, max, pro }. `pro` mirrors the client
   gating: every AI button in the app is Pro-gated, so the server enforces
   the same rule authoritatively. */
const TASKS = {
  ask: {
    sys: "Answer the manager's question as a knowledgeable FPL coach. Use their squad and the candidate list to give a specific, grounded answer. If they have no squad in the data, give general gameweek advice. Keep answers tight (usually under 180 words) unless asked for depth.",
    model: 'claude-sonnet-5', max: 800, pro: true
  },
  scout: {
    instruction: "Write a scout report.\n## Captain\nBest captain from the data + one sentence why.\n## Gameweek picks\n3-4 bullets on standout players in scoutTeam and why.\n## Your team\nOnly if myTeam exists: an honest read on their XI, the captain call vs the model, at most one transfer angle.",
    model: 'claude-haiku-4-5-20251001', max: 900, pro: true
  },
  transfers: {
    instruction: "Recommend transfers for myTeam using xP, fixtures (next) and bank. Propose at most TWO moves. For each: **OUT → IN**, the net cost vs bank, and whether a -4 points hit is justified. Consider only players in the data. If the team is already strong, say so and recommend holding. End with a one-line bottom line.",
    model: 'claude-sonnet-5', max: 700, pro: true
  },
  digest: {
    instruction: "Write a tight pre-deadline digest (about 140 words): the captain pick, one transfer thought, one risk to watch in the squad, and a one-line chip note if relevant. Skimmable bullets.",
    model: 'claude-haiku-4-5-20251001', max: 500, pro: true
  },
  review: {
    instruction: "Write a short post-gameweek review using lastGw (points, average, rank): how the manager did versus the average, what likely worked or hurt (captain, bench), and one lesson for next week. About 130 words.",
    model: 'claude-haiku-4-5-20251001', max: 500, pro: true
  },
  player: {
    instruction: "Give a concise scouting verdict on the player in the data: form and xP, fixture, role/set-pieces if present, ownership and value. End with a one-word call in bold: **Buy**, **Hold**, **Watch** or **Avoid**. About 90 words.",
    model: 'claude-haiku-4-5-20251001', max: 350, pro: true
  },
  chips: {
    instruction: "Advise on chip strategy from chipsUsed, chipsAvailable and the fixture notes (doubles/blanks if present). For each available chip, suggest a rough window and why. Keep it practical, about 150 words.",
    model: 'claude-sonnet-5', max: 600, pro: true
  },
  rival: {
    instruction: "Using myTeam and rivals (with squad overlap and points gap), explain how to overtake each rival: which differentials to target or avoid, and the captaincy angle. About 150 words.",
    model: 'claude-sonnet-5', max: 600, pro: true
  },
  draft: {
    instruction: "Diagnose this pre-season draft squad (squad entries carry position, club, predicted price, xP6 = projected points over GW1-6, and minsSecurity 0-100). Cover: budget balance across positions and the bank, club concentration, minutes-security risks, and the squad's total xP6 versus templateXP6 (a greedy reference draft from the same pool). Then suggest at most TWO swaps using only players from candidates, each as **OUT → IN** with the price difference and one-line reasoning. Note once that prices and projections are pre-season estimates. About 160 words.",
    model: 'claude-sonnet-5', max: 700, pro: true
  }
};

/* Serialise `obj` into at most `budget` characters of VALID JSON. Rather
   than slicing the string (which cuts JSON mid-token), progressively trim
   arrays throughout the object and re-stringify until it fits. */
function fitJSON(obj, budget) {
  let s;
  try { s = JSON.stringify(obj || {}); } catch (_) { return '{}'; }
  if (s.length <= budget) return s;
  const trimArrays = (o, max) => {
    if (Array.isArray(o)) return o.slice(0, max).map((v) => trimArrays(v, max));
    if (o && typeof o === 'object') {
      const out = {};
      for (const k of Object.keys(o)) out[k] = trimArrays(o[k], max);
      return out;
    }
    if (typeof o === 'string' && o.length > 400) return o.slice(0, 400);
    return o;
  };
  let clone;
  try { clone = JSON.parse(s); } catch (_) { return '{}'; }
  for (const max of [24, 16, 10, 6, 3, 1]) {
    clone = trimArrays(clone, max);
    s = JSON.stringify(clone);
    if (s.length <= budget) return s;
  }
  return '{"note":"context omitted — too large"}';
}

/* Verify the Supabase access token and return { id } or null. */
async function verifyUser(supaUrl, serviceKey, token) {
  try {
    const r = await fetch(supaUrl + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: serviceKey }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? { id: u.id } : null;
  } catch (_) { return null; }
}

/* Read the caller's tier from gwedge_profiles (service role, bypasses RLS).
   A season pass carries a `pro_until` expiry — honour it so an expired pass
   falls back to free even if the row still reads tier='pro' (nothing else
   downgrades a one-off payment). Monthly Pro has no pro_until and is
   governed by the subscription webhook. */
async function userTier(supaUrl, serviceKey, userId) {
  try {
    const r = await fetch(supaUrl + '/rest/v1/gwedge_profiles?user_id=eq.' + encodeURIComponent(userId) + '&select=tier,pro_until',
      { headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey } });
    if (!r.ok) return 'free';
    const rows = await r.json();
    const row = rows && rows[0];
    if (!row || row.tier !== 'pro') return 'free';
    if (row.pro_until && new Date(row.pro_until).getTime() < Date.now()) return 'free';
    return 'pro';
  } catch (_) { return 'free'; }
}

/* Per-user daily quota via gwedge_ai_usage (user_id, day, count).
   Best-effort read-then-upsert; returns true when the call is allowed. */
async function checkQuota(supaUrl, serviceKey, userId) {
  const day = new Date().toISOString().slice(0, 10);
  const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };
  try {
    const r = await fetch(supaUrl + '/rest/v1/gwedge_ai_usage?user_id=eq.' + encodeURIComponent(userId) + '&day=eq.' + day + '&select=count', { headers });
    const rows = r.ok ? await r.json() : [];
    const count = rows && rows[0] ? rows[0].count || 0 : 0;
    if (count >= DAILY_QUOTA) return false;
    await fetch(supaUrl + '/rest/v1/gwedge_ai_usage?on_conflict=user_id,day', {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: userId, day, count: count + 1 })
    });
    return true;
  } catch (_) { return true; /* metering must never take the feature down */ }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(503, { error: 'AI not configured' });

  const supaUrl = process.env.SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) return json(503, { error: 'AI not configured', detail: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY so AI calls can be authenticated.' });

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return json(401, { error: 'Sign in to use AI features' });

  const user = await verifyUser(supaUrl, serviceKey, token);
  if (!user) return json(401, { error: 'Sign in to use AI features' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'Bad request' }); }
  const t = TASKS[body.task];
  if (!t) return json(400, { error: 'Unknown task' });

  if (t.pro) {
    const tier = await userTier(supaUrl, serviceKey, user.id);
    if (tier !== 'pro') return json(403, { error: 'AI features are part of Gameweek Edge Pro. Upgrade to unlock the scout — the rest of the app stays free.' });
  }

  if (!(await checkQuota(supaUrl, serviceKey, user.id))) {
    return json(429, { error: 'You have reached today’s AI limit (' + DAILY_QUOTA + ' calls). It resets at midnight UTC — the model tools keep working in the meantime.' });
  }

  const ctxJson = fitJSON(body.context || {}, 9000);
  const system = BASE + "\n\n" + (t.sys || "") + "\n\nData context (JSON):\n```json\n" + ctxJson + "\n```";

  let messages;
  if (body.task === 'ask') {
    const turns = Array.isArray(body.messages) ? body.messages.slice(-10)
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) })) : [];
    /* The Messages API requires the first turn to be the user's — drop any
       leading assistant turns the -10 slice may have started on. */
    while (turns.length && turns[0].role !== 'user') turns.shift();
    if (!turns.length) return json(400, { error: 'No question' });
    messages = turns;
  } else {
    messages = [{ role: 'user', content: t.instruction }];
  }

  /* Call Claude, retrying once on a model-not-found 404 with the pinned
     Haiku fallback so a retired/unknown model id never dead-ends a user. */
  const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
  const callModel = (model) => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: t.max, system, messages })
  });

  try {
    let r = await callModel(t.model);
    if (!r.ok && r.status === 404 && t.model !== FALLBACK_MODEL) {
      const errText = await r.text();
      if (/model/i.test(errText)) r = await callModel(FALLBACK_MODEL);
      else return json(502, { error: 'AI service error' });
    }
    const data = await r.json();
    if (!r.ok) return json(502, { error: 'AI service error', detail: (data && data.error && data.error.message) || null });
    const text = (data.content || []).map((c) => c.text || '').join('').trim();
    return json(200, { text });
  } catch (e) {
    return json(502, { error: 'Upstream request failed' });
  }
};
