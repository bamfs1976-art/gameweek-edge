/**
 * Gameweek Edge — Stripe Checkout session creator (Phase 4)
 *
 * POST /.netlify/functions/stripe-checkout
 * Headers: Authorization: Bearer <Supabase access token>
 * Body:    { "plan": "monthly" | "season" }
 *
 * Verifies the user's Supabase JWT, then creates a Stripe Checkout Session
 * for the chosen plan. On success the user lands on Stripe-hosted checkout;
 * on completion Stripe POSTs to stripe-webhook.js which updates the user's
 * tier in Supabase.
 *
 * Required env vars (set in Netlify site settings → Environment variables):
 *   STRIPE_SECRET_KEY        — sk_test_... or sk_live_...
 *   STRIPE_PRICE_MONTHLY     — price_... ID for the £4.99/month subscription
 *   STRIPE_PRICE_SEASON      — price_... ID for the £24.99 one-off season pass
 *   SUPABASE_URL             — https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — for verifying users + linking customer IDs
 *   PUBLIC_SITE_URL          — https://<site>.netlify.app (used for return URLs)
 *
 * If any required env var is missing, returns 503 with a clear message so
 * the client can display "Billing not yet live" instead of a 500.
 */

const REQUIRED_ENV = [
  'STRIPE_SECRET_KEY',
  'STRIPE_PRICE_MONTHLY',
  'STRIPE_PRICE_SEASON',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'PUBLIC_SITE_URL'
];

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff'
    },
    body: JSON.stringify(body)
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  /* Env var check — Phase 4 scaffolding allows the function to deploy
     before Stripe is set up. Once the env vars land, it Just Works. */
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missing.length) {
    return jsonResponse(503, {
      error: 'billing_not_configured',
      message: 'Stripe billing is being set up — once the account is approved, upgrades will go live.',
      missing
    });
  }

  /* Verify user via Supabase JWT */
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return jsonResponse(401, { error: 'unauthorized', message: 'Missing access token.' });
  }

  let user;
  try {
    const verifyRes = await fetch(process.env.SUPABASE_URL + '/auth/v1/user', {
      headers: {
        'Authorization': 'Bearer ' + token,
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY
      }
    });
    if (!verifyRes.ok) {
      return jsonResponse(401, { error: 'unauthorized', message: 'Invalid or expired session.' });
    }
    user = await verifyRes.json();
  } catch (e) {
    return jsonResponse(502, { error: 'auth_unreachable', message: 'Could not verify session: ' + e.message });
  }
  if (!user || !user.id) {
    return jsonResponse(401, { error: 'unauthorized', message: 'Session has no user.' });
  }

  /* Parse + validate plan */
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return jsonResponse(400, { error: 'bad_request', message: 'Body must be JSON.' }); }
  const plan = body.plan === 'season' ? 'season' : 'monthly';
  const priceId = plan === 'season' ? process.env.STRIPE_PRICE_SEASON : process.env.STRIPE_PRICE_MONTHLY;
  const mode = plan === 'season' ? 'payment' : 'subscription';

  /* Look up the existing Stripe customer for this user, if any */
  let customerId = null;
  try {
    const profileRes = await fetch(
      process.env.SUPABASE_URL + '/rest/v1/gwedge_profiles?user_id=eq.' + user.id + '&select=stripe_customer_id',
      {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
        }
      }
    );
    const rows = await profileRes.json();
    if (Array.isArray(rows) && rows[0] && rows[0].stripe_customer_id) {
      customerId = rows[0].stripe_customer_id;
    }
  } catch (e) {
    /* Non-fatal — Checkout can create a new customer */
  }

  /* Create the Checkout Session via Stripe API (URL-encoded form body) */
  const params = new URLSearchParams();
  params.append('mode', mode);
  params.append('line_items[0][price]', priceId);
  params.append('line_items[0][quantity]', '1');
  params.append('success_url', process.env.PUBLIC_SITE_URL + '/?upgrade=success&session_id={CHECKOUT_SESSION_ID}');
  params.append('cancel_url',  process.env.PUBLIC_SITE_URL + '/?upgrade=cancel');
  params.append('client_reference_id', user.id);
  params.append('metadata[user_id]', user.id);
  params.append('metadata[plan]', plan);
  if (customerId) {
    params.append('customer', customerId);
  } else {
    params.append('customer_email', user.email || '');
    params.append('customer_creation', 'always');
  }
  if (mode === 'subscription') {
    params.append('subscription_data[metadata][user_id]', user.id);
    params.append('subscription_data[metadata][plan]', plan);
  }

  try {
    const checkoutRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
    const data = await checkoutRes.json();
    if (!checkoutRes.ok) {
      return jsonResponse(checkoutRes.status, { error: 'stripe_error', message: data.error && data.error.message ? data.error.message : 'Stripe error' });
    }
    return jsonResponse(200, { url: data.url, id: data.id });
  } catch (e) {
    return jsonResponse(502, { error: 'stripe_unreachable', message: e.message });
  }
};
