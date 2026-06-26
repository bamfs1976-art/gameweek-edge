/* Gameweek Edge — Stripe customer portal (Netlify Function)
   POST { userId } -> { url } to Stripe's billing portal so subscribers
   manage or cancel themselves. Looks up the user's Stripe customer id
   from gwedge_profiles via the Supabase service-role key.
   Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
   503 if unconfigured, 400 if the user has no Stripe customer yet. */

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

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
  const supaUrl = process.env.SUPABASE_URL, supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !supaUrl || !supaKey) return json(503, { error: 'Billing not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'Bad request' }); }
  if (!body.userId) return json(401, { error: 'Sign in required' });

  try {
    const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
    const { data } = await sb.from('gwedge_profiles').select('stripe_customer_id').eq('user_id', body.userId).maybeSingle();
    const customer = data && data.stripe_customer_id;
    if (!customer) return json(400, { error: 'No Stripe customer' });

    const origin = event.headers.origin || process.env.SITE_URL || '';
    const stripe = Stripe(key);
    const session = await stripe.billingPortal.sessions.create({ customer, return_url: origin + '/' });
    return json(200, { url: session.url });
  } catch (e) {
    return json(502, { error: 'Could not open portal' });
  }
};
