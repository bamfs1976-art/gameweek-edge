/* Gameweek Edge — "Ask the model" (public stub).
   The right-rail Ask box POSTs a short question here. For now this returns a
   canned, deterministic answer that points the manager at the right panel —
   no auth, no LLM call, no data leakage. A later iteration can swap the body
   for a grounded model call. */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

/* Route the question to a helpful pointer by keyword. */
function answer(q) {
  const s = String(q || '').toLowerCase();
  if (/captain|armband|triple/.test(s))
    return 'Captaincy lives on the dashboard "This Week · Action" row and the Scout panel — it ranks the top picks by expected points with a floor→ceiling band and the margin over the next-best.';
  if (/transfer|sell|buy|wildcard|free hit|chip/.test(s))
    return 'Transfers and chips are on the Planner: the Transfer Solver ranks moves by cumulative xP over the horizon, and the Fixture Planner flags the fixture-swing Free Hit / Wildcard windows.';
  if (/differential|template|owned|ownership/.test(s))
    return 'Differentials (under 15% owned, non-premium, ranked by projection) are on the Players area; The Template shows the most-owned core.';
  if (/fixture|fdr|easy|hard|run/.test(s))
    return 'Fixture difficulty is on the Planner: an 8-to-15-gameweek FDR grid with our model, the official FPL rating, rotation pairs and each team’s fixture purple patch.';
  if (/price|rise|fall/.test(s))
    return 'Price moves are on the Prices panel — likely risers and fallers tonight from an ownership-scaled net-transfer threshold.';
  return 'Every call on the dashboard is explained: tap a jargon term for its definition, or the "?" on a Model XI row for why that player is picked. Ask about captaincy, transfers, differentials, fixtures or prices.';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let q = '';
  try { q = (JSON.parse(event.body || '{}').q || '').slice(0, 300); } catch (_) {}
  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: answer(q), stub: true })
  };
};
