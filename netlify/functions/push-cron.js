/* Gameweek Edge — scheduled push sender (Netlify Scheduled Function)
   Runs hourly. Diffs the FPL bootstrap against the last snapshot to find
   overnight price changes and new injury flags, and sends a deadline
   reminder in the final hours before a gameweek. Delivers Web Push to all
   opted-in subscribers (no Apple account needed — works on the PWA).

   Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…),
   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. No-ops if unconfigured. */

const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

exports.config = { schedule: '@hourly' };

const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.app)';

exports.handler = async () => {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:alerts@gameweekedge.app';
  const supaUrl = process.env.SUPABASE_URL, supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!pub || !priv || !supaUrl || !supaKey) return { statusCode: 200, body: 'not configured' };

  webpush.setVapidDetails(subject, pub, priv);
  const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const getState = async (k) => { const { data } = await sb.from('gwedge_push_state').select('value').eq('key', k).maybeSingle(); return data ? data.value : null; };
  const setState = (k, value) => sb.from('gwedge_push_state').upsert({ key: k, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });

  /* Pull the FPL bootstrap (server-side; the API allows non-browser GETs). */
  let boot;
  try { boot = await (await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { headers: { 'User-Agent': UA, Accept: 'application/json' } })).json(); }
  catch (e) { return { statusCode: 200, body: 'fpl unavailable' }; }
  const teams = {}; (boot.teams || []).forEach((t) => { teams[t.id] = t.short_name; });
  const nm = (e) => e.web_name + (teams[e.team] ? ' (' + teams[e.team] + ')' : '');

  /* ── Build the alert messages ───────────────────────────── */
  const alerts = [];

  /* Price + injury diff vs the last snapshot. */
  const prev = (await getState('snapshot')) || {};
  const snap = {};
  const risers = [], fallers = [], injured = [];
  (boot.elements || []).forEach((e) => {
    snap[e.id] = { c: e.now_cost, s: e.status };
    const p = prev[e.id];
    if (!p) return;
    if (e.now_cost > p.c) risers.push(e);
    else if (e.now_cost < p.c) fallers.push(e);
    if (p.s === 'a' && e.status !== 'a') injured.push(e);
  });
  await setState('snapshot', snap);

  const hadSnapshot = Object.keys(prev).length > 0;   /* don't fire on the very first run */
  if (hadSnapshot && (risers.length || fallers.length)) {
    alerts.push({ type: 'price', title: 'Overnight price changes',
      body: risers.length + ' risers, ' + fallers.length + ' fallers. ' +
        (risers.slice(0, 3).map(nm).join(', ') || '') + (risers.length > 3 ? '…' : ''),
      url: '/?panel=price' });
  }
  if (hadSnapshot && injured.length) {
    alerts.push({ type: 'injury', title: injured.length + ' new fitness flag' + (injured.length > 1 ? 's' : ''),
      body: injured.slice(0, 4).map(nm).join(', ') + (injured.length > 4 ? '…' : ''),
      url: '/?panel=injuries' });
  }

  /* Deadline reminder in the last 0–3 hours, once per gameweek. */
  const next = (boot.events || []).find((e) => e.is_next) || (boot.events || []).find((e) => !e.finished);
  if (next && next.deadline_time) {
    const hrs = (new Date(next.deadline_time).getTime() - Date.now()) / 3600e3;
    const sentGw = await getState('deadline_sent');
    if (hrs > 0 && hrs <= 3 && sentGw !== next.id) {
      alerts.push({ type: 'deadline', title: next.name + ' deadline soon',
        body: 'About ' + Math.max(1, Math.round(hrs)) + 'h to set your team and captain.', url: '/' });
      await setState('deadline_sent', next.id);
    }
  }

  if (!alerts.length) return { statusCode: 200, body: 'nothing to send' };

  /* ── Deliver to opted-in subscribers ────────────────────── */
  const { data: subs } = await sb.from('gwedge_push_subs').select('*');
  let sent = 0;
  for (const a of alerts) {
    const targets = (subs || []).filter((s) => !s.prefs || s.prefs[a.type] !== false);
    await Promise.allSettled(targets.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: a.title, body: a.body, url: a.url, tag: a.type })
        );
        sent++;
      } catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          await sb.from('gwedge_push_subs').delete().eq('endpoint', s.endpoint);  /* expired */
        }
      }
    }));
  }
  return { statusCode: 200, body: 'sent ' + sent + ' notifications across ' + alerts.length + ' alerts' };
};
