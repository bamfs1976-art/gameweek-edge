/* Returns the public VAPID key so the client can subscribe to push.
   503 if push isn't configured (VAPID_PUBLIC_KEY unset). */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return { statusCode: 503, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Push not configured' }) };
  return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }, body: JSON.stringify({ key }) };
};
