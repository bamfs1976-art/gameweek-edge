/* Gameweek Edge — scheduled push sender (Netlify Scheduled Function)
   Runs hourly. Diffs the FPL bootstrap against the last snapshot to find
   overnight price changes, new injury flags and players reaching one
   yellow from a card ban, and sends a deadline reminder in the final
   hours before a gameweek. Subscribers with a linked FPL team get the
   price alert personalised to their squad, plus a once-a-day early-evening
   warning when one of their players looks likely to move that night.
   Delivers Web Push to all opted-in subscribers (no Apple account needed
   — works on the PWA).

   Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…),
   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. No-ops if unconfigured. */

const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

exports.config = { schedule: '@hourly' };

const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Same price-move likelihood model as the app's Price Predictor panel:
   net transfers against an ownership-scaled threshold (~30% of owners,
   floor 20k) through a logistic curve. An estimate — FPL's exact
   algorithm is not public. */
function priceChangeProb(el, totalPlayers) {
  const net = (el.transfers_in_event || 0) - (el.transfers_out_event || 0);
  const own = Math.max(0.1, parseFloat(el.selected_by_percent) || 0.1);
  const owners = Math.max(1, (totalPlayers || 10e6) * own / 100);
  const threshold = Math.max(20000, 0.30 * owners);
  const raw = 100 / (1 + Math.exp(-4 * (Math.abs(net / threshold) - 0.5)));
  return { dir: net > 0 ? 'rise' : net < 0 ? 'fall' : 'flat', prob: Math.max(5, Math.min(95, Math.round(raw))) };
}

/* The card-ban ladder is the vendored rule the app reads, loaded through
   netlify/lib/suspension.js. No threshold is written in this file, and
   scripts/check-shell.mjs fails the build if one reappears. */
const { loadRule, justOneFromBan } = require('../lib/suspension');
/* The price feed's memory: hourly transfer samples and the changes seen,
   written here because this is the one job that already reads the
   bootstrap every hour. Read back by netlify/functions/price-feed.js. */
const { recordFlow, recordChanges } = require('../lib/price-feed');

exports.handler = async () => {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:alerts@gameweekedge.co.uk';
  const supaUrl = process.env.SUPABASE_URL, supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return { statusCode: 200, body: 'not configured' };

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

  /* Price + injury + card-ban diff vs the last snapshot. */
  const gwNow = (boot.events || []).find((e) => e.is_current) || (boot.events || []).find((e) => e.is_next);
  const rule = loadRule();
  const gwId = gwNow ? gwNow.id : 38;
  const prev = (await getState('snapshot')) || {};
  const snap = {};
  const risers = [], fallers = [], injured = [], banEdge = [];
  (boot.elements || []).forEach((e) => {
    snap[e.id] = { c: e.now_cost, s: e.status, y: e.yellow_cards || 0 };
    const p = prev[e.id];
    if (!p) return;
    if (e.now_cost > p.c) risers.push(e);
    else if (e.now_cost < p.c) fallers.push(e);
    if (p.s === 'a' && e.status !== 'a') injured.push(e);
    /* Just picked up the yellow that leaves them one from a ban. */
    const rung = justOneFromBan(rule, e.yellow_cards, p.y, gwId);
    if (rung) banEdge.push({ e, rung });
  });
  await setState('snapshot', snap);

  const hadSnapshot = Object.keys(prev).length > 0;   /* don't fire on the very first run */
  /* Write the feed before anything is sent, so a push failure never costs
     an hour of history; and never let the feed cost an alert. */
  try {
    const nowIso = new Date().toISOString();
    await setState('price_flow', recordFlow(await getState('price_flow'), boot.elements, nowIso));
    if (hadSnapshot && (risers.length || fallers.length)) {
      const changes = [...risers, ...fallers].map((e) => ({
        id: e.id, n: e.web_name, t: teams[e.team] || '', p: e.element_type, from: prev[e.id].c, to: e.now_cost }));
      await setState('price_log', recordChanges(await getState('price_log'), changes, nowIso.slice(0, 10)));
    }
  } catch (_) { /* the feed is a convenience; the alerts below still go */ }
  if (!pub || !priv) return { statusCode: 200, body: 'feed recorded; push not configured' };
  webpush.setVapidDetails(subject, pub, priv);
  if (hadSnapshot && (risers.length || fallers.length)) {
    alerts.push({ type: 'price', title: 'Overnight price changes',
      body: risers.length + ' risers, ' + fallers.length + ' fallers. ' +
        (risers.slice(0, 3).map(nm).join(', ') || '') + (risers.length > 3 ? '…' : ''),
      url: '/?panel=price',
      /* Personalised for linked squads below. */
      personal: { changed: [...risers.map((e) => ({ e, up: true })), ...fallers.map((e) => ({ e, up: false }))] } });
  }
  if (hadSnapshot && injured.length) {
    alerts.push({ type: 'injury', title: injured.length + ' new fitness flag' + (injured.length > 1 ? 's' : ''),
      body: injured.slice(0, 4).map(nm).join(', ') + (injured.length > 4 ? '…' : ''),
      url: '/?panel=injuries' });
  }
  if (hadSnapshot && banEdge.length) {
    const top = banEdge.sort((a, c) => parseFloat(c.e.selected_by_percent) - parseFloat(a.e.selected_by_percent));
    /* Name the rung when everyone listed is on the same one; mid-season the
       list can mix a player closing on five with one closing on ten. */
    const rungs = new Set(top.map((x) => x.rung.at));
    const which = rungs.size === 1 ? 'the ' + top[0].rung.at + '-card ban' : 'a ban';
    alerts.push({ type: 'suspension', title: 'Suspension risk',
      body: top.slice(0, 4).map((x) => nm(x.e)).join(', ') + (top.length > 4 ? '…' : '') +
        (top.length > 1 ? ' are' : ' is') + ' now one yellow from ' + which + '.',
      url: '/?panel=injuries' });
  }

  /* Early-evening warning (once a day, ~18:00 UTC): linked squads whose
     players look likely to move tonight, from the threshold model. */
  const hour = new Date().getUTCHours();
  const today = new Date().toISOString().slice(0, 10);
  let priceRisk = null;
  if (hour === 18 && (await getState('pricerisk_sent')) !== today) {
    const movers = (boot.elements || [])
      .map((e) => ({ e, pc: priceChangeProb(e, boot.total_players) }))
      .filter((x) => x.pc.dir !== 'flat' && x.pc.prob >= 70);
    if (movers.length) priceRisk = movers;
    await setState('pricerisk_sent', today);
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

  if (!alerts.length && !priceRisk) return { statusCode: 200, body: 'nothing to send' };

  /* ── Deliver to opted-in subscribers ────────────────────── */
  const { data: subs } = await sb.from('gwedge_push_subs').select('*');
  let sent = 0;
  const push = async (s, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        await sb.from('gwedge_push_subs').delete().eq('endpoint', s.endpoint);  /* expired */
      }
    }
  };

  /* Squad lookup for the personalised alerts, fetched once per linked
     manager and capped/paced so we never hammer the FPL API. */
  const wantsSquad = (s) =>
    (alerts.some((a) => a.personal) && (!s.prefs || s.prefs.price !== false)) ||
    (priceRisk && (!s.prefs || s.prefs.pricerisk !== false));
  const mids = [...new Set((subs || []).filter((s) => s.manager_id && wantsSquad(s)).map((s) => s.manager_id))];
  const squads = {};
  if (mids.length && gwNow) {
    let first = true;
    for (const mid of mids.slice(0, 150)) {
      if (!first) await sleep(150);
      first = false;
      try {
        const r = await fetch('https://fantasy.premierleague.com/api/entry/' + mid + '/event/' + gwNow.id + '/picks/',
          { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        if (r.ok) { const p = await r.json(); squads[mid] = new Set((p.picks || []).map((x) => x.element)); }
      } catch (_) { /* squadless managers just get the global copy */ }
    }
  }

  for (const a of alerts) {
    const targets = (subs || []).filter((s) => !s.prefs || s.prefs[a.type] !== false);
    await Promise.allSettled(targets.map(async (s) => {
      let title = a.title, body = a.body;
      if (a.personal && s.manager_id && squads[s.manager_id]) {
        const hits = a.personal.changed.filter((x) => squads[s.manager_id].has(x.e.id)).slice(0, 4);
        if (hits.length) {
          title = 'Price changes in your squad';
          body = hits.map((x) => (x.up ? '▲ ' : '▼ ') + nm(x.e) + ' → £' + (x.e.now_cost / 10).toFixed(1) + 'm').join('  ');
        }
      }
      await push(s, { title, body, url: a.url, tag: a.type });
    }));
  }

  /* Evening price-risk warning: only to linked squads with a hit. */
  if (priceRisk) {
    const targets = (subs || []).filter((s) => s.manager_id && squads[s.manager_id] && (!s.prefs || s.prefs.pricerisk !== false));
    await Promise.allSettled(targets.map(async (s) => {
      const hits = priceRisk.filter((x) => squads[s.manager_id].has(x.e.id)).slice(0, 4);
      if (!hits.length) return;
      await push(s, {
        title: 'Price watch tonight',
        body: hits.map((x) => x.e.web_name + (x.pc.dir === 'rise' ? ' likely to rise' : ' likely to fall') + ' (~' + x.pc.prob + '%)').join('  '),
        url: '/?panel=price', tag: 'pricerisk'
      });
    }));
  }

  return { statusCode: 200, body: 'sent ' + sent + ' notifications across ' + alerts.length + ' alerts' + (priceRisk ? ' + evening price risk' : '') };
};
