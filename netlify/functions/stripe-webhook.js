/**
 * Gameweek Edge — Stripe webhook handler (Phase 4)
 *
 * Stripe POSTs subscription lifecycle events here. We verify the signature
 * against STRIPE_WEBHOOK_SECRET, dedupe by stripe_event_id, then update the
 * user's tier in gwedge_profiles via the Supabase service role.
 *
 * Configure in Stripe dashboard: webhook endpoint
 *   https://<your-site>.netlify.app/.netlify/functions/stripe-webhook
 *   Events: checkout.session.completed, customer.subscription.created,
 *           customer.subscription.updated, customer.subscription.deleted,
 *           invoice.payment_failed
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY        — for fetching subscription details
 *   STRIPE_WEBHOOK_SECRET    — whsec_... from the Stripe dashboard
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * If env vars are missing the function returns 503. Stripe will retry; you
 * can configure the env vars and then re-fire events from the dashboard.
 */

const crypto = require('crypto');

const REQUIRED_ENV = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY'
];

function verifyStripeSignature(rawBody, header, secret) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map(kv => kv.split('=')));
  if (!parts.t || !parts.v1) return false;
  const signed = parts.t + '.' + rawBody;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(parts.v1, 'hex'), Buffer.from(expected, 'hex'));
  } catch (e) { return false; }
}

async function supaFetch(path, init) {
  const url = process.env.SUPABASE_URL + '/rest/v1/' + path;
  const headers = Object.assign({
    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  }, (init && init.headers) || {});
  return fetch(url, Object.assign({}, init, { headers }));
}

async function logEvent(eventId, eventType, payload, userId) {
  /* Dedupe via the unique constraint on stripe_event_id */
  await supaFetch('gwedge_billing_events', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=ignore-duplicates' },
    body: JSON.stringify({
      stripe_event_id: eventId,
      event_type: eventType,
      payload: payload,
      user_id: userId || null
    })
  });
}

async function updateProfile(userId, patch) {
  return supaFetch('gwedge_profiles?user_id=eq.' + encodeURIComponent(userId), {
    method: 'PATCH',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify(patch)
  });
}

async function fetchSubscription(subscriptionId) {
  const res = await fetch('https://api.stripe.com/v1/subscriptions/' + subscriptionId, {
    headers: { 'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY }
  });
  if (!res.ok) return null;
  return res.json();
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missing.length) {
    return { statusCode: 503, body: 'billing_not_configured: ' + missing.join(',') };
  }

  const rawBody = event.body || '';
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!verifyStripeSignature(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)) {
    return { statusCode: 400, body: 'invalid signature' };
  }

  let evt;
  try { evt = JSON.parse(rawBody); }
  catch (e) { return { statusCode: 400, body: 'invalid json' }; }

  const userId =
    (evt.data && evt.data.object && evt.data.object.metadata && evt.data.object.metadata.user_id) ||
    (evt.data && evt.data.object && evt.data.object.client_reference_id) ||
    null;

  /* Always log first so failures downstream don't lose the event */
  try { await logEvent(evt.id, evt.type, evt, userId); }
  catch (e) { /* swallow — already deduped or table missing */ }

  if (!userId) {
    /* Some events (like invoice.payment_failed) might not carry metadata.user_id
       — we'd need to look up via customer_id. For Phase 4 scaffolding we ack and move on. */
    return { statusCode: 200, body: 'no user_id, acked' };
  }

  try {
    if (evt.type === 'checkout.session.completed') {
      const session = evt.data.object;
      const isSubscription = session.mode === 'subscription';
      const isOneOff = session.mode === 'payment';
      const patch = {
        stripe_customer_id: session.customer || null,
        tier: 'pro'
      };
      if (isSubscription) {
        patch.stripe_subscription_id = session.subscription || null;
        patch.subscription_status = 'active';
        if (session.subscription) {
          const sub = await fetchSubscription(session.subscription);
          if (sub) {
            patch.pro_until = new Date(sub.current_period_end * 1000).toISOString();
            patch.price_id = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;
          }
        }
      } else if (isOneOff) {
        /* Season pass: grant pro until end of season — pick a far-future date.
           Tune this once you know the exact season-end date for 2025/26. */
        patch.pro_until = '2026-05-31T23:59:59Z';
        patch.subscription_status = null;
      }
      await updateProfile(userId, patch);
    } else if (evt.type === 'customer.subscription.created' || evt.type === 'customer.subscription.updated') {
      const sub = evt.data.object;
      const status = sub.status;
      const tier = (status === 'active' || status === 'trialing') ? 'pro' : 'free';
      await updateProfile(userId, {
        stripe_subscription_id: sub.id,
        subscription_status: status,
        tier: tier,
        pro_until: new Date(sub.current_period_end * 1000).toISOString(),
        price_id: sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id
      });
    } else if (evt.type === 'customer.subscription.deleted') {
      await updateProfile(userId, {
        subscription_status: 'canceled',
        tier: 'free'
      });
    } else if (evt.type === 'invoice.payment_failed') {
      await updateProfile(userId, { subscription_status: 'past_due' });
    }
  } catch (e) {
    /* Returning 5xx makes Stripe retry. For Phase 4 we surface the error. */
    return { statusCode: 500, body: 'processing error: ' + e.message };
  }

  return { statusCode: 200, body: 'ok' };
};
