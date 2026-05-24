/**
 * Gameweek Edge — Anthropic AI proxy (Phase 12 enhancements)
 *
 * POST /.netlify/functions/ai
 * Body: { type: 'decision_brief' | 'mini_league_story' | 'confidence_feedback'
 *               | 'transfer_verdict' | 'chip_advice', ...typedFields }
 *
 * The API key is read from process.env.ANTHROPIC_API_KEY only. It is never
 * accepted in the request body, query string, or headers. All five typed
 * prompts use Anthropic Messages API, model claude-sonnet-4-20250514,
 * max_tokens 300, plain prose only.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 300;

const SYSTEM_PROMPT =
  "You are the Gameweek Edge assistant for Fantasy Premier League managers. " +
  "You give calm, clear, plain-English advice. Never use markdown, bullet points, " +
  "asterisks or headers. Write in short sentences. Sound like a knowledgeable friend, " +
  "not a data analyst. Never use the words: dive, unlock, game-changer, exciting, " +
  "powerful, leverage, groundbreaking.";

const ALLOWED_TYPES = new Set([
  'decision_brief',
  'mini_league_story',
  'confidence_feedback',
  'transfer_verdict',
  'chip_advice'
]);

/* ── PROMPT BUILDERS ────────────────────────────────────── */
function buildPrompt(type, body){
  if(type === 'decision_brief'){
    const { captainName, captainOwnership, topTransferIn, topTransferOut,
            chipsRemaining, currentRank, gwNumber } = body;
    return "It's Gameweek " + gwNumber + ". Write three sentences. " +
      "First sentence: give a clear captain recommendation based on " + captainName +
      " who is owned by " + captainOwnership + "% of managers. " +
      "Second sentence: the most important transfer to consider is bringing in " +
      topTransferIn + " and selling " + topTransferOut + ". " +
      "Third sentence: comment on the manager's chip situation given they have " +
      chipsRemaining + " chips left and are currently ranked " + currentRank + ".";
  }
  if(type === 'mini_league_story'){
    const { managerName, rivals, gwNumber } = body;
    const rivalSummary = (rivals||[]).slice(0,5).map(r =>
      r.name + " (gap " + r.gap + ", " + r.trend + ")"
    ).join("; ");
    return "After Gameweek " + gwNumber + ", write two sentences about " +
      managerName + "'s mini-league position. Rival positions: " + (rivalSummary || 'none tracked') + ". " +
      "The gap to nearest rival and whether they are closing or falling away should be " +
      "reflected naturally. End with one concrete suggestion for protecting or extending the lead.";
  }
  if(type === 'confidence_feedback'){
    const { decision, confidence, outcome, gwNumber } = body;
    return "In Gameweek " + gwNumber + " the manager made this decision: " + decision + ". " +
      "They rated their confidence as " + confidence + " out of 5. " +
      "The outcome was: " + outcome + ". " +
      "Write one sentence acknowledging the decision quality honestly, separating process from result.";
  }
  if(type === 'transfer_verdict'){
    const { playerOut, playerOutXg, playerIn, playerInXg, hitCost, breakEvenGws } = body;
    return "The manager wants to transfer out " + playerOut +
      " (xG contribution " + playerOutXg + " per 90) and bring in " + playerIn +
      " (xG contribution " + playerInXg + " per 90). " +
      "The hit cost is " + hitCost + " points. " +
      "Break-even is " + breakEvenGws + " gameweeks. " +
      "Give a single clear verdict of no more than two sentences on whether to take the hit.";
  }
  if(type === 'chip_advice'){
    const { chipsRemaining, currentGw, confirmedDgws, confirmedBgws, squadStrength } = body;
    return "The manager has these chips remaining: " + chipsRemaining + ". " +
      "It is Gameweek " + currentGw + ". " +
      "Confirmed double gameweeks are: " + confirmedDgws + ". " +
      "Confirmed blank gameweeks are: " + confirmedBgws + ". " +
      "Squad strength is rated " + squadStrength + " out of 10. " +
      "Write two sentences recommending the best chip deployment plan for the rest of the season.";
  }
  /* unreachable due to allow-list */
  throw new Error('Unknown prompt type');
}

/* ── HELPERS ───────────────────────────────────────────── */
function jsonResponse(statusCode, body, extraHeaders){
  return {
    statusCode,
    headers: Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Content-Type-Options': 'nosniff',
      },
      extraHeaders || {}
    ),
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

function parseBody(event){
  if(!event.body) return {};
  try{ return JSON.parse(event.body); }
  catch(e){ return null; }
}

/* ── HANDLER ───────────────────────────────────────────── */
exports.handler = async function(event){
  /* CORS preflight */
  if(event.httpMethod === 'OPTIONS'){
    return { statusCode: 204, headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }, body: '' };
  }
  if(event.httpMethod !== 'POST'){
    return jsonResponse(405, { error: 'Method not allowed', allowed: ['POST', 'OPTIONS'] });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if(!key){
    return jsonResponse(503, { error: 'AI service not configured' });
  }

  const body = parseBody(event);
  if(body === null) return jsonResponse(400, { error: 'Invalid JSON body' });

  const type = body && body.type;
  if(!type || !ALLOWED_TYPES.has(type)){
    return jsonResponse(400, {
      error: 'Invalid or missing type',
      allowed: Array.from(ALLOWED_TYPES)
    });
  }

  /* Strip any incoming key fields so the rest of the request can't slip a key in */
  delete body.api_key;
  delete body.apiKey;
  delete body.anthropic_api_key;

  let userPrompt;
  try{
    userPrompt = buildPrompt(type, body);
  }catch(err){
    return jsonResponse(400, { error: 'Could not build prompt: ' + err.message });
  }

  try{
    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if(!upstream.ok){
      let detail = '';
      try{ const j = await upstream.json(); detail = (j.error && j.error.message) || ''; }
      catch(e){}
      console.error('Anthropic API error', upstream.status, detail);
      return jsonResponse(upstream.status === 401 ? 503 : 502, {
        error: 'AI service returned ' + upstream.status,
        type
      });
    }

    const data = await upstream.json();
    const text = (data.content && data.content[0] && data.content[0].text) || '';
    if(!text){
      return jsonResponse(502, { error: 'AI response was empty', type });
    }

    return jsonResponse(200, { type, text: text.trim() }, {
      'Cache-Control': 'no-store'
    });
  }catch(err){
    console.error('AI call failed', err && err.message);
    return jsonResponse(502, { error: 'AI call failed', type });
  }
};
