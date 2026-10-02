/* Gameweek Edge — email and Telegram alerts (Netlify Scheduled Function).
   Hourly. Two kinds of message, to users who switched them on in Alerts:
     - deadline reminders at 24h, 6h and about 1h (free);
     - your squad's new fitness flags (Pro), from a diff of the FPL
       bootstrap against the last run, matched to each linked squad.
   Web push keeps its own sender (push-cron.js); this one only adds the two
   channels push cannot reach, so nothing is sent twice through one channel.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required);
        RESEND_API_KEY, ALERTS_FROM, ALERTS_SIGNING_KEY (email);
        TELEGRAM_BOT_TOKEN (Telegram).
   Each channel no-ops when its keys are missing. */
const { createClient } = require('@supabase/supabase-js');
const A = require('../lib/alert-channels');

exports.config = { schedule: '@hourly' };
const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendEmail(to, msg, unsubUrl) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.ALERTS_FROM || 'Gameweek Edge <alerts@gameweekedge.co.uk>', to: [to],
      subject: msg.subject, html: msg.html, text: msg.text,
      headers: { 'List-Unsubscribe': '<' + unsubUrl + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }),
  });
  return r.ok;
}
async function sendTelegram(chatId, text) {
  const r = await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  return r.status;   /* 403: the user blocked the bot */
}

exports.handler = async () => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { statusCode: 200, body: 'not configured' };
  const emailOn = !!(process.env.RESEND_API_KEY && process.env.ALERTS_SIGNING_KEY);
  const tgOn = !!process.env.TELEGRAM_BOT_TOKEN;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const getState = async (k) => { const { data } = await sb.from('gwedge_push_state').select('value').eq('key', k).maybeSingle(); return data ? data.value : null; };
  const setState = (k, value) => sb.from('gwedge_push_state').upsert({ key: k, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });

  let boot;
  try { boot = await (await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { headers: { 'User-Agent': UA, Accept: 'application/json' } })).json(); }
  catch (_) { return { statusCode: 200, body: 'fpl unavailable' }; }
  const teams = {}; (boot.teams || []).forEach((t) => { teams[t.id] = t.short_name; });

  /* The flag diff runs every hour, sending or not, so the snapshot is
     always one hour old and a flag is reported once. */
  const prev = await getState('chan_snapshot');
  const flagged = A.newlyFlagged(prev, boot.elements);
  await setState('chan_snapshot', A.snapshotOf(boot.elements));

  const next = (boot.events || []).find((e) => e.is_next) || (boot.events || []).find((e) => !e.finished);
  let due = null;
  if (next && next.deadline_time) {
    const st = (await getState('chan_deadline')) || {};
    const sent = st.gw === next.id ? st.sent || {} : {};
    due = A.dueWindow(Date.parse(next.deadline_time), Date.now(), sent);
    /* Recorded before sending: a failed run misses a reminder rather than
       sending it twice on the retry. */
    if (due) await setState('chan_deadline', { gw: next.id, sent: { ...sent, [due.key]: true } });
  }
  if (!due && !flagged.length) return { statusCode: 200, body: 'nothing due' };
  if (!emailOn && !tgOn) return { statusCode: 200, body: 'no channel configured' };

  const { data: rows } = await sb.from('gwedge_alert_channels').select('*').or('email_on.eq.true,telegram_on.eq.true');
  if (!rows || !rows.length) return { statusCode: 200, body: 'no subscribers' };

  /* Squad alerts are Pro: read the tiers once. */
  let pro = new Set();
  if (flagged.length) {
    const ids = rows.filter((r) => r.flags_on && r.manager_id).map((r) => r.user_id);
    if (ids.length) {
      const { data: profs } = await sb.from('gwedge_profiles').select('user_id,tier').in('user_id', ids);
      pro = new Set((profs || []).filter((p) => p.tier === 'pro').map((p) => p.user_id));
    }
  }
  const cur = (boot.events || []).find((e) => e.is_current) || next;
  const squads = {};
  if (flagged.length && cur) {
    const mids = [...new Set(rows.filter((r) => pro.has(r.user_id)).map((r) => r.manager_id))].slice(0, 300);
    for (const mid of mids) {
      try {
        const r = await fetch('https://fantasy.premierleague.com/api/entry/' + mid + '/event/' + cur.id + '/picks/', { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        if (r.ok) squads[mid] = new Set(((await r.json()).picks || []).map((p) => p.element));
      } catch (_) { /* this manager just gets no squad alert */ }
      await sleep(120);
    }
  }

  const emails = {};
  const emailOf = async (uid) => {
    if (uid in emails) return emails[uid];
    try { const { data } = await sb.auth.admin.getUserById(uid); emails[uid] = (data && data.user && data.user.email) || null; }
    catch (_) { emails[uid] = null; }
    return emails[uid];
  };
  const unsubUrl = (uid) => A.SITE + '/api/alerts-unsubscribe?u=' + encodeURIComponent(uid) + '&c=email&s=' + A.signUnsub(uid, 'email', process.env.ALERTS_SIGNING_KEY);

  let sentE = 0, sentT = 0;
  for (const r of rows) {
    const msgs = [];
    if (due && (!r.windows || r.windows[due.key] !== false)) {
      msgs.push(['deadline', { gwName: next.name, window: due, when: A.whenUk(Date.parse(next.deadline_time)) }]);
    }
    if (flagged.length && pro.has(r.user_id) && squads[r.manager_id]) {
      const mine = flagged.filter((e) => squads[r.manager_id].has(e.id));
      if (mine.length) msgs.push(['flags', { lines: mine.slice(0, 6).map((e) => A.flagLine(e, teams)) }]);
    }
    for (const [kind, data] of msgs) {
      if (emailOn && r.email_on) {
        const to = await emailOf(r.user_id);
        if (to) { try { if (await sendEmail(to, A.emailFor(kind, data, unsubUrl(r.user_id)), unsubUrl(r.user_id))) sentE++; } catch (_) { /* next */ } }
      }
      if (tgOn && r.telegram_on && r.telegram_chat_id) {
        try {
          const code = await sendTelegram(r.telegram_chat_id, A.telegramFor(kind, data));
          if (code === 200) sentT++;
          else if (code === 403) await sb.from('gwedge_alert_channels').update({ telegram_on: false }).eq('user_id', r.user_id);
        } catch (_) { /* next */ }
      }
    }
  }
  return { statusCode: 200, body: `sent ${sentE} emails, ${sentT} Telegram messages` + (due ? ' (' + due.key + ')' : '') + (flagged.length ? `, ${flagged.length} new flags` : '') };
};
