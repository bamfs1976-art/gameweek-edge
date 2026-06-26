/* Gameweek Edge — unified AI endpoint (Claude, Netlify Function)
   POST { task, context, messages? } -> { text }.
   The numbers come from our own models; Claude reasons over the JSON we
   pass and must not invent data. One function serves every AI feature
   (scout report, chat, transfer plan, digest, review, player, chips,
   rival). Requires ANTHROPIC_API_KEY; returns 503 if unset so the app
   shows a setup note. Key never reaches the client. */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const json = (code, obj) => ({ statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

const BASE =
  "You are the scout for Gameweek Edge, a calm, expert companion for Fantasy Premier League managers. " +
  "Reason ONLY over the JSON data provided — never invent players, fixtures, prices or statistics not in it. " +
  "'xP' is our predicted points for the upcoming gameweek; prefer it when comparing players. Only recommend " +
  "players that appear in the data. Use British English and GitHub-flavoured markdown. Be concise and practical. " +
  "Never claim any affiliation with the Premier League or the official Fantasy Premier League game. No preamble, no disclaimers.";

/* task -> { sys, instruction, model, max } */
const TASKS = {
  ask: {
    sys: "Answer the manager's question as a knowledgeable FPL coach. Use their squad and the candidate list to give a specific, grounded answer. If they have no squad in the data, give general gameweek advice. Keep answers tight (usually under 180 words) unless asked for depth.",
    model: 'claude-sonnet-4-6', max: 800
  },
  scout: {
    instruction: "Write a scout report.\n## Captain\nBest captain from the data + one sentence why.\n## Gameweek picks\n3-4 bullets on standout players in scoutTeam and why.\n## Your team\nOnly if myTeam exists: an honest read on their XI, the captain call vs the model, at most one transfer angle.",
    model: 'claude-haiku-4-5-20251001', max: 900
  },
  transfers: {
    instruction: "Recommend transfers for myTeam using xP, fixtures (next) and bank. Propose at most TWO moves. For each: **OUT → IN**, the net cost vs bank, and whether a -4 points hit is justified. Consider only players in the data. If the team is already strong, say so and recommend holding. End with a one-line bottom line.",
    model: 'claude-sonnet-4-6', max: 700
  },
  digest: {
    instruction: "Write a tight pre-deadline digest (about 140 words): the captain pick, one transfer thought, one risk to watch in the squad, and a one-line chip note if relevant. Skimmable bullets.",
    model: 'claude-haiku-4-5-20251001', max: 500
  },
  review: {
    instruction: "Write a short post-gameweek review using lastGw (points, average, rank): how the manager did versus the average, what likely worked or hurt (captain, bench), and one lesson for next week. About 130 words.",
    model: 'claude-haiku-4-5-20251001', max: 500
  },
  player: {
    instruction: "Give a concise scouting verdict on the player in the data: form and xP, fixture, role/set-pieces if present, ownership and value. End with a one-word call in bold: **Buy**, **Hold**, **Watch** or **Avoid**. About 90 words.",
    model: 'claude-haiku-4-5-20251001', max: 350
  },
  chips: {
    instruction: "Advise on chip strategy from chipsUsed, chipsAvailable and the fixture notes (doubles/blanks if present). For each available chip, suggest a rough window and why. Keep it practical, about 150 words.",
    model: 'claude-sonnet-4-6', max: 600
  },
  rival: {
    instruction: "Using myTeam and rivals (with squad overlap and points gap), explain how to overtake each rival: which differentials to target or avoid, and the captaincy angle. About 150 words.",
    model: 'claude-sonnet-4-6', max: 600
  }
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(503, { error: 'AI not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'Bad request' }); }
  const t = TASKS[body.task];
  if (!t) return json(400, { error: 'Unknown task' });

  const ctxJson = JSON.stringify(body.context || {}).slice(0, 9000);
  const system = BASE + "\n\n" + (t.sys || "") + "\n\nData context (JSON):\n```json\n" + ctxJson + "\n```";

  let messages;
  if (body.task === 'ask') {
    const turns = Array.isArray(body.messages) ? body.messages.slice(-10)
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) })) : [];
    if (!turns.length) return json(400, { error: 'No question' });
    messages = turns;
  } else {
    messages = [{ role: 'user', content: t.instruction }];
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: t.model, max_tokens: t.max, system, messages })
    });
    const data = await r.json();
    if (!r.ok) return json(502, { error: 'AI service error', detail: (data && data.error && data.error.message) || null });
    const text = (data.content || []).map((c) => c.text || '').join('').trim();
    return json(200, { text });
  } catch (e) {
    return json(502, { error: 'Upstream request failed' });
  }
};
