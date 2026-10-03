/* Gameweek Edge — one-click email unsubscribe. GET (a person clicking) or
   POST (a mail client's List-Unsubscribe-Post), with u (user id), c
   (channel) and s (signature from ALERTS_SIGNING_KEY). Turns email alerts
   off for that account and nothing else.
   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALERTS_SIGNING_KEY. */
const { createClient } = require('@supabase/supabase-js');
const { verifyUnsub, SITE } = require('../lib/alert-channels');

const page = (title, body) => ({ statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title +
    '</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.4rem">' +
    title + '</h1><p>' + body + '</p><p><a href="' + SITE + '/">Back to Gameweek Edge</a></p></body>' });

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const key = process.env.ALERTS_SIGNING_KEY, url = process.env.SUPABASE_URL, sk = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !url || !sk) return page('Not available', 'Unsubscribing is not set up on this site yet.');
  if (q.c !== 'email' || !verifyUnsub(q.u, 'email', q.s, key)) return page('Link not recognised', 'This unsubscribe link is not valid. You can turn email alerts off in Alerts, under Email and Telegram.');
  const sb = createClient(url, sk, { auth: { persistSession: false } });
  const { error } = await sb.from('gwedge_alert_channels').update({ email_on: false, updated_at: new Date().toISOString() }).eq('user_id', q.u);
  if (error) return page('Something went wrong', 'We could not update your settings. Please try again, or turn email alerts off in Alerts.');
  return page('You are unsubscribed', 'Gameweek Edge will not email you alerts any more. You can switch them back on in Alerts at any time.');
};
