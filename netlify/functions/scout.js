/* Gameweek Edge — AI Scout Report (Netlify Function)
   Calls the Anthropic API (Claude) to write a natural-language scout
   report grounded ONLY in the data the client computed (predicted-points
   team of the week + the user's squad). The numbers come from our own
   model; Claude supplies the reasoning.

   Requires the ANTHROPIC_API_KEY environment variable on the Netlify
   site. If it's not set, returns 503 so the app shows a setup note.
   The key never reaches the client. */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM =
  "You are the scout for Gameweek Edge, a calm, expert companion for Fantasy Premier League managers. " +
  "Write a concise, confident scout report grounded ONLY in the JSON data provided — never invent players, " +
  "fixtures or statistics that are not in the data. 'xP' is predicted points for the upcoming gameweek. " +
  "Do not claim any affiliation with the Premier League or the official Fantasy Premier League game. " +
  "Use British English. Output GitHub-flavoured markdown, about 220-320 words, with these sections:\n" +
  "## Captain\nName the single best captain from the data and one sentence why.\n" +
  "## Gameweek picks\n3-4 bullet points on the standout players in the team of the week and why they rate.\n" +
  "## Your team (only if myTeam is provided)\nOne honest read on their XI, the captain call versus the model, " +
  "and at most one transfer angle. If myTeam is absent, omit this section.\n" +
  "Keep it practical and skimmable. No preamble, no disclaimers.";

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { statusCode: 503, headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'AI reports not configured' }) };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (_) { return { statusCode: 400, headers: CORS, body: 'Bad request' }; }

  const userMessage =
    "Here is the gameweek data as JSON. Write the scout report.\n\n```json\n" +
    JSON.stringify(payload).slice(0, 6000) + "\n```";

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMessage }]
      })
    });
    const data = await r.json();
    if (!r.ok) {
      return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'AI service error', detail: (data && data.error && data.error.message) || null }) };
    }
    const report = (data.content || []).map((c) => c.text || '').join('').trim();
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ report }) };
  } catch (e) {
    return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Upstream request failed' }) };
  }
};
