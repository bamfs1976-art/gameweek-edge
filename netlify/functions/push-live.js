/* Gameweek Edge — live in-play push sender (Netlify Scheduled Function).
   Runs every 2 minutes. Only does work while a gameweek is actually in
   play. For each subscriber who linked their FPL team, it diffs the live
   feed against the last snapshot and pushes personal events:

     • scorer  — an owned XI player scored or assisted
     • defcon  — an owned XI player banked the 2025/26 defensive +2
     • bonus   — an owned XI player moved into (or up) the provisional 3-2-1

   Squad + snapshot are keyed per manager, so one live fetch serves every
   subscriber on that team. Respects each subscriber's prefs. No-ops (fast)
   when nothing is live or when unconfigured.

   Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…),
   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. */

const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

exports.config = { schedule: '*/2 * * * *' };

/* Warm-container fallback for the fan-out cursor (see below). */
let moduleCursor = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.app)';
const api = async (path) => {
  const r = await fetch('https://fantasy.premierleague.com/api/' + path, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + path);
  return r.json();
};

/* Provisional 3-2-1 for one fixture from live BPS, official tie rule. */
function fixtureBonus(elsByTeam, st, f) {
  const players = [...(elsByTeam[f.team_h] || []), ...(elsByTeam[f.team_a] || [])]
    .map((e) => ({ id: e.id, bps: (st[e.id] || {}).bps || 0, mins: (st[e.id] || {}).minutes || 0 }))
    .filter((x) => x.mins > 0);
  if (!players.length) return {};
  players.sort((a, c) => c.bps - a.bps);
  const groups = [];
  players.forEach((p) => { const g = groups[groups.length - 1]; if (g && g.bps === p.bps) g.items.push(p); else groups.push({ bps: p.bps, items: [p] }); });
  let slot = [3, 2, 1]; const out = {};
  for (const g of groups) { if (!slot.length) break; const val = slot[0]; g.items.forEach((p) => { out[p.id] = val; }); slot = slot.slice(g.items.length); }
  return out;
}

exports.handler = async () => {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:alerts@gameweekedge.app';
  const supaUrl = process.env.SUPABASE_URL, supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!pub || !priv || !supaUrl || !supaKey) return { statusCode: 200, body: 'not configured' };

  webpush.setVapidDetails(subject, pub, priv);
  const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
  const getState = async (k) => { const { data } = await sb.from('gwedge_push_state').select('value').eq('key', k).maybeSingle(); return data ? data.value : null; };
  const setState = (k, value) => sb.from('gwedge_push_state').upsert({ key: k, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });

  let boot, fixtures;
  try { boot = await api('bootstrap-static/'); } catch (_) { return { statusCode: 200, body: 'fpl unavailable' }; }
  const gw = (boot.events || []).find((e) => e.is_current);
  if (!gw) return { statusCode: 200, body: 'no current gameweek' };
  try { fixtures = await api('fixtures/?event=' + gw.id); } catch (_) { return { statusCode: 200, body: 'fixtures unavailable' }; }

  const inPlay = fixtures.filter((f) => f.started && !f.finished);
  if (!inPlay.length) return { statusCode: 200, body: 'nothing in play' };

  /* Which subscribers have a linked team and want live alerts. */
  const { data: subs } = await sb.from('gwedge_push_subs').select('*');
  const live = (subs || []).filter((s) => s.manager_id && (!s.prefs || s.prefs.scorer !== false || s.prefs.bonus !== false || s.prefs.defcon !== false));
  if (!live.length) return { statusCode: 200, body: 'no live-opted subscribers' };

  /* Reference maps. */
  const elMap = {}; const elsByTeam = {};
  (boot.elements || []).forEach((e) => { elMap[e.id] = e; (elsByTeam[e.team] = elsByTeam[e.team] || []).push(e); });
  const teams = {}; (boot.teams || []).forEach((t) => { teams[t.id] = t.short_name; });
  const thr = (t) => (t === 2 ? 10 : (t >= 3 ? 12 : null));   /* GK excluded */

  let liveData;
  try { liveData = await api('event/' + gw.id + '/live/'); } catch (_) { return { statusCode: 200, body: 'live unavailable' }; }
  const st = {}; (liveData.elements || []).forEach((e) => { st[e.id] = e.stats || {}; });
  const provBonus = {}; inPlay.forEach((f) => Object.assign(provBonus, fixtureBonus(elsByTeam, st, f)));

  const byMid = {};
  live.forEach((s) => { (byMid[s.manager_id] = byMid[s.manager_id] || []).push(s); });

  /* Cap the per-run fan-out so we never hammer the FPL API at scale:
     at most MAX_PER_RUN managers per invocation, resumed from a
     rotating cursor persisted in gwedge_push_state (module scope as a
     best-effort fallback on warm containers). With a 2-minute
     schedule every manager is still visited every few minutes. */
  const MAX_PER_RUN = 150;
  const mids = Object.keys(byMid).sort();
  let start = 0;
  if (mids.length > MAX_PER_RUN) {
    try {
      const c = await getState('live-cursor');
      start = c && Number.isFinite(Number(c.i)) ? Number(c.i) % mids.length : (moduleCursor % mids.length);
    } catch (_) { start = moduleCursor % mids.length; }
  }
  const batch = mids.length > MAX_PER_RUN
    ? Array.from({ length: MAX_PER_RUN }, (_, i) => mids[(start + i) % mids.length])
    : mids;
  if (mids.length > MAX_PER_RUN) {
    moduleCursor = (start + MAX_PER_RUN) % mids.length;
    try { await setState('live-cursor', { i: moduleCursor }); } catch (_) { /* best effort */ }
  }

  let sent = 0;
  let first = true;
  for (const mid of batch) {
    if (!first) await sleep(150);                 /* pace the per-manager FPL fetches */
    first = false;
    let picks;
    try { picks = await api('entry/' + mid + '/event/' + gw.id + '/picks/'); } catch (_) { continue; }
    const xi = (picks.picks || []).filter((p) => p.position <= 11);

    const stateKey = 'live:' + gw.id + ':' + mid;
    const prev = (await getState(stateKey)) || null;
    const cur = {};
    const events = [];   /* {type, body} */

    xi.forEach((p) => {
      const el = elMap[p.element]; if (!el) return;
      const s = st[p.element] || {};
      const g = s.goals_scored || 0, a = s.assists || 0;
      const dc = parseInt(s.defensive_contribution, 10) || 0;
      const t = thr(el.element_type);
      const dcHit = t != null && dc >= t;
      const bonus = provBonus[p.element] || 0;
      cur[p.element] = { g, a, dcHit, bonus };
      if (!prev) return;   /* seed silently on first pass */
      const pr = prev[p.element] || { g: 0, a: 0, dcHit: false, bonus: 0 };
      const who = el.web_name + (teams[el.team] ? ' (' + teams[el.team] + ')' : '');
      if (g > pr.g) events.push({ type: 'scorer', body: '⚽ ' + who + ' scored' + (g > 1 ? ' (' + g + ')' : '') + '!' });
      if (a > pr.a) events.push({ type: 'scorer', body: '🅰️ ' + who + ' assisted' + (a > 1 ? ' (' + a + ')' : '') + '!' });
      if (dcHit && !pr.dcHit) events.push({ type: 'defcon', body: '🛡️ ' + who + ' banked the defensive +2' });
      if (bonus > pr.bonus) events.push({ type: 'bonus', body: '✨ ' + who + ' now projected +' + bonus + ' bonus' });
    });

    await setState(stateKey, cur);
    if (!events.length) continue;

    /* One grouped notification per event type, per manager's subscribers. */
    const targets = byMid[mid];
    const types = ['scorer', 'defcon', 'bonus'];
    for (const type of types) {
      const msgs = events.filter((e) => e.type === type);
      if (!msgs.length) continue;
      const title = type === 'scorer' ? 'Your players are involved' : type === 'defcon' ? 'Defensive +2 banked' : 'Bonus movement';
      const body = msgs.slice(0, 4).map((m) => m.body).join('  ') + (msgs.length > 4 ? '  …' : '');
      const recip = targets.filter((s) => !s.prefs || s.prefs[type] !== false);
      await Promise.allSettled(recip.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title, body, url: '/?panel=liverank', tag: 'live-' + type })
          );
          sent++;
        } catch (err) {
          if (err && (err.statusCode === 404 || err.statusCode === 410)) await sb.from('gwedge_push_subs').delete().eq('endpoint', s.endpoint);
        }
      }));
    }
  }

  return { statusCode: 200, body: 'sent ' + sent + ' live notifications' };
};
