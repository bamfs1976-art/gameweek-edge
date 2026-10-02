/* Gameweek Edge — the Telegram bot's webhook.
   /start CODE  links this chat to the account that was shown CODE in Alerts
   /stop        stops Telegram alerts for the account linked to this chat
   Telegram signs each call with the secret set at setWebhook time, sent in
   X-Telegram-Bot-Api-Secret-Token; anything without it is refused. The chat
   id is written here, with the service key, and nowhere else: the browser
   cannot set it (see supabase/gwedge_alert_channels.sql).
   Env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY. */
const { createClient } = require('@supabase/supabase-js');

const reply = (chatId, text) => fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
}).catch(() => {});

async function handle(update, sb, say) {
  const msg = update && (update.message || update.edited_message);
  const chatId = msg && msg.chat && msg.chat.id;
  const text = String((msg && msg.text) || '').trim();
  if (!chatId || !text) return 'ignored';
  const m = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9]{8,32})$/);
  if (m) {
    const { data } = await sb.from('gwedge_alert_channels').select('user_id').eq('link_code', m[1]).limit(2);
    if (!data || data.length !== 1) { await say(chatId, 'That code did not match an account. Open Alerts in Gameweek Edge and tap Link Telegram again.'); return 'no match'; }
    await sb.from('gwedge_alert_channels').update({ telegram_chat_id: chatId, telegram_on: true, link_code: null, updated_at: new Date().toISOString() }).eq('user_id', data[0].user_id);
    await say(chatId, 'Linked. You will get deadline reminders here, and your squad\'s fitness news if you are on Pro. Send /stop at any time.');
    return 'linked';
  }
  if (/^\/stop\b/.test(text)) {
    await sb.from('gwedge_alert_channels').update({ telegram_on: false, updated_at: new Date().toISOString() }).eq('telegram_chat_id', chatId);
    await say(chatId, 'Stopped. Switch Telegram alerts back on in Gameweek Edge, under Alerts.');
    return 'stopped';
  }
  await say(chatId, 'To link this chat, open Alerts in Gameweek Edge and tap Link Telegram. Send /stop to stop alerts.');
  return 'help';
}

exports.handler = async (event) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const got = (event.headers || {})['x-telegram-bot-api-secret-token'];
  if (!secret || got !== secret || event.httpMethod !== 'POST') return { statusCode: 401, body: '' };
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.TELEGRAM_BOT_TOKEN) return { statusCode: 200, body: '' };
  let update; try { update = JSON.parse(event.body || '{}'); } catch (_) { return { statusCode: 200, body: '' }; }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  await handle(update, sb, reply);
  return { statusCode: 200, body: '' };   /* always 200, so Telegram does not retry a message we chose to ignore */
};
exports.handle = handle;
