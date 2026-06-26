/* Gameweek Edge — Stripe webhook (Netlify Function)
   Verifies Stripe's signature, then sets the user's tier server-side in
   Supabase (using the service-role key, which bypasses RLS — this is the
   ONLY place tier is set authoritatively). Logs every event to
   gwedge_billing_events for idempotency/audit.

   Env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL,
   SUPABASE_SERVICE_ROLE_KEY. The webhook endpoint in Stripe should point
   at /api/stripe-webhook. */

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const key = process.env.STRIPE_SECRET_KEY;
  const whsec = process.env.STRIPE_WEBHOOK_SECRET;
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !whsec || !supaUrl || !supaKey) return { statusCode: 503, body: 'Billing not configured' };

  const stripe = Stripe(key);
  const sig = event.headers['stripe-signature'];
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

  let evt;
  try { evt = stripe.webhooks.constructEvent(raw, sig, whsec); }
  catch (e) { return { statusCode: 400, body: 'Invalid signature' }; }

  const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
  const setProfile = (userId, patch) =>
    sb.from('gwedge_profiles').upsert(Object.assign({ user_id: userId }, patch));
  const userByCustomer = async (customer) => {
    if (!customer) return null;
    const { data } = await sb.from('gwedge_profiles').select('user_id').eq('stripe_customer_id', customer).maybeSingle();
    return data ? data.user_id : null;
  };

  try {
    const obj = evt.data.object;
    let userId = null;

    if (evt.type === 'checkout.session.completed') {
      userId = obj.client_reference_id || (obj.metadata && obj.metadata.userId) || null;
      if (userId) {
        const patch = { tier: 'pro', subscription_status: 'active', stripe_customer_id: obj.customer || null };
        if (obj.subscription) patch.stripe_subscription_id = obj.subscription;
        if (obj.mode === 'payment') {            // season pass: one year of Pro
          const d = new Date(); d.setFullYear(d.getFullYear() + 1); patch.pro_until = d.toISOString();
        }
        await setProfile(userId, patch);
      }
    } else if (evt.type === 'customer.subscription.updated') {
      userId = (obj.metadata && obj.metadata.userId) || await userByCustomer(obj.customer);
      if (userId) {
        const active = obj.status === 'active' || obj.status === 'trialing';
        await setProfile(userId, { tier: active ? 'pro' : 'free', subscription_status: obj.status });
      }
    } else if (evt.type === 'customer.subscription.deleted') {
      userId = (obj.metadata && obj.metadata.userId) || await userByCustomer(obj.customer);
      if (userId) await setProfile(userId, { tier: 'free', subscription_status: 'canceled' });
    }

    /* Audit log (stripe_event_id is unique → ignore duplicate deliveries). */
    await sb.from('gwedge_billing_events')
      .upsert({ stripe_event_id: evt.id, event_type: evt.type, user_id: userId, payload: obj },
        { onConflict: 'stripe_event_id', ignoreDuplicates: true });
  } catch (e) {
    return { statusCode: 500, body: 'Handler error' };
  }
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
