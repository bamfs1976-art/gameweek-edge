/* Gameweek Edge — create a Stripe Checkout session (Netlify Function)
   POST { plan: 'monthly'|'season', userId, email } -> { url }.
   Requires env vars: STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY,
   STRIPE_PRICE_SEASON. Returns 503 if billing isn't configured so the
   app falls back gracefully. The secret key never reaches the client. */

const Stripe = require('stripe');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const json = (code, obj) => ({ statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const key = process.env.STRIPE_SECRET_KEY;
  const prices = { monthly: process.env.STRIPE_PRICE_MONTHLY, season: process.env.STRIPE_PRICE_SEASON };
  if (!key || (!prices.monthly && !prices.season)) return json(503, { error: 'Billing not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'Bad request' }); }
  const { plan, userId, email } = body;
  if (!userId) return json(401, { error: 'Sign in required' });
  const price = prices[plan];
  if (!price) return json(400, { error: 'Unknown plan' });

  const origin = event.headers.origin || process.env.SITE_URL || '';
  const mode = plan === 'season' ? 'payment' : 'subscription';

  try {
    const stripe = Stripe(key);
    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price, quantity: 1 }],
      client_reference_id: userId,
      customer_email: email || undefined,
      metadata: { userId, plan },
      subscription_data: mode === 'subscription' ? { metadata: { userId } } : undefined,
      allow_promotion_codes: true,
      success_url: origin + '/?upgrade=success',
      cancel_url: origin + '/?upgrade=cancel'
    });
    return json(200, { url: session.url });
  } catch (e) {
    return json(502, { error: 'Could not start checkout' });
  }
};
