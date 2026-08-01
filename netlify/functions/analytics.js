/* Gameweek Edge — owner analytics (Netlify Function)
   GET /api/analytics?days=14 -> daily external visitors and area usage.

   OWNER ONLY, AND THE GATE IS SERVER-SIDE. window.GE_OWNER is a client
   flag — anyone can set it in a console — so it cannot protect an endpoint
   that reads the event table. The caller sends its Supabase access token,
   this function verifies the token against Supabase (which signed it, so the
   email cannot be forged), hashes the verified email and checks it against
   the same owner allowlist the app uses. Anything else gets 403.

   What counts as an EXTERNAL user, and why:

     BOTS      identified by user agent. Crawlers were 82% of all traffic in
               the first sample, so leaving them in makes every number a lie.
     OWNER     the ids that have opened an owner-gated panel. That is an
               objective test — only the owner can open one — rather than
               "these sessions look like mine".

   Aggregates only: counts per day, per panel, per area. No anon_ids and no
   user agents are returned, so the response cannot be used to follow an
   individual around the app even by the person allowed to read it.
*/

const OWNER_HASHES = (process.env.OWNER_EMAIL_HASHES ||
  '3030acf5031d5b815d5e50e0db6cac1beaf3ea9209300ac42fc42bbf2d81fab6')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/* Panel -> nav area. Kept here rather than derived from the app so the
   endpoint has no dependency on the bundle; a test reads NAV out of
   index.html and fails if the two ever drift apart. */
const AREA = {
  /* `design` and `glossary` are registered straight onto PANELS rather than
     NAV — free tier, areaId home, reachable by hash by anyone who finds them,
     so they record views like any other panel. */
  home: ['dashboard', 'myweek', 'gw-actions', 'blog', 'scout', 'methodology', 'accountability',
    'design', 'glossary'],
  'my team': ['squad', 'transfers', 'captain', 'chips', 'draft', 'gwreport', 'gwhistory'],
  live: ['liverank'],
  players: ['allplayers', 'scoutboard', 'compare', 'price', 'setpiece', 'rotation', 'news'],
  planner: ['fixtures', 'seasonsim', 'whatif', 'watchlist', 'alerts'],
  rivals: ['leagues', 'rivals', 'eo', 'template'],
  'match centre': ['results', 'matchforecast', 'lineups', 'titlerace', 'dossier', 'clubform'],
  studio: ['social', 'analytics']
};
const AREA_OF = {};
for (const a of Object.keys(AREA)) for (const p of AREA[a]) AREA_OF[p] = a;

const BOT = /bot|crawl|spider|headless|preview|slurp|python|curl|monitor|lighthouse|http|scan|fetch|wget/i;
/* Opening one of these proves the session is the owner's — they are the only
   owner-tier panels in the app. `design` is NOT one of them despite living
   outside the nav: it is free, so treating it as an owner signal would drop a
   real visitor who deep-linked to it. */
const OWNER_PANELS = new Set(['social', 'analytics']);

const json = (code, body) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body)
});

async function sha256Hex(s) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');
}

/* Verify the token with Supabase and return the signed-in email, or null. */
async function verifyEmail(supaUrl, serviceKey, token) {
  try {
    const r = await fetch(supaUrl + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: serviceKey }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.email ? u.email : null;
  } catch (_) { return null; }
}

/* Page through the events table — PostgREST caps a response, and a silent
   truncation here would read as "traffic fell off a cliff". */
async function fetchEvents(supaUrl, serviceKey, sinceIso) {
  const rows = [];
  const page = 1000;
  for (let from = 0; from < 50000; from += page) {
    const url = supaUrl + '/rest/v1/gwedge_events' +
      '?select=event,props,anon_id,ua,ts' +
      '&ts=gte.' + encodeURIComponent(sinceIso) +
      '&order=ts.asc';
    const r = await fetch(url, {
      headers: {
        apikey: serviceKey, Authorization: 'Bearer ' + serviceKey,
        Range: from + '-' + (from + page - 1), 'Range-Unit': 'items'
      }
    });
    if (!r.ok) throw new Error('events HTTP ' + r.status);
    const batch = await r.json();
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

function summarise(rows, days) {
  /* Owner ids first: anyone who opened an owner-gated panel is the owner. */
  const owner = new Set();
  for (const r of rows) {
    if (r.event === 'panel_view' && r.props && OWNER_PANELS.has(r.props.panel)) owner.add(r.anon_id);
  }
  const uaOf = {};
  for (const r of rows) if (r.ua && !uaOf[r.anon_id]) uaOf[r.anon_id] = r.ua;

  const external = (id) => id && !owner.has(id) && uaOf[id] && !BOT.test(uaOf[id]);

  const ext = rows.filter((r) => external(r.anon_id));
  const day = (ts) => String(ts).slice(0, 10);

  const byDay = {};
  const firstSeen = {};
  const seenDays = {};
  for (const r of ext) {
    const d = day(r.ts);
    const b = byDay[d] || (byDay[d] = { date: d, visitors: new Set(), newVisitors: 0,
      opens: 0, views: 0, deeper: new Set(), linked: 0 });
    b.visitors.add(r.anon_id);
    if (!firstSeen[r.anon_id] || d < firstSeen[r.anon_id]) firstSeen[r.anon_id] = d;
    (seenDays[r.anon_id] || (seenDays[r.anon_id] = new Set())).add(d);
    if (r.event === 'app_open') b.opens++;
    if (r.event === 'team_linked') b.linked++;
    if (r.event === 'panel_view') {
      b.views++;
      if (r.props && r.props.panel !== 'dashboard') b.deeper.add(r.anon_id);
    }
  }
  for (const id of Object.keys(firstSeen)) {
    const b = byDay[firstSeen[id]];
    if (b) b.newVisitors++;
  }

  const panels = {}, areas = {};
  for (const r of ext) {
    if (r.event !== 'panel_view' || !r.props || !r.props.panel) continue;
    const p = r.props.panel;
    const pe = panels[p] || (panels[p] = { panel: p, views: 0, people: new Set() });
    pe.views++; pe.people.add(r.anon_id);
    const a = AREA_OF[p] || 'other';
    const ae = areas[a] || (areas[a] = { area: a, views: 0, people: new Set(), panels: new Set() });
    ae.views++; ae.people.add(r.anon_id); ae.panels.add(p);
  }

  const people = new Set(ext.map((r) => r.anon_id));
  const returned = Object.keys(seenDays).filter((id) => seenDays[id].size > 1).length;
  const panelsPer = {};
  for (const r of ext) {
    if (r.event === 'panel_view' && r.props && r.props.panel) {
      (panelsPer[r.anon_id] || (panelsPer[r.anon_id] = new Set())).add(r.props.panel);
    }
  }
  const dashboardOnly = Object.keys(panelsPer)
    .filter((id) => panelsPer[id].size === 1 && panelsPer[id].has('dashboard')).length;

  const totalViews = Object.values(panels).reduce((s, p) => s + p.views, 0);

  return {
    windowDays: days,
    generated: new Date().toISOString(),
    totals: {
      externalVisitors: people.size,
      botsExcluded: new Set(rows.filter((r) => uaOf[r.anon_id] && BOT.test(uaOf[r.anon_id]))
        .map((r) => r.anon_id)).size,
      ownerIdsExcluded: owner.size,
      panelViews: totalViews,
      returnedAnotherDay: returned,
      dashboardOnly,
      teamsLinked: ext.filter((r) => r.event === 'team_linked').length
    },
    daily: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)).map((b) => ({
      date: b.date, visitors: b.visitors.size, newVisitors: b.newVisitors,
      opens: b.opens, views: b.views, pastDashboard: b.deeper.size, teamsLinked: b.linked
    })),
    areas: Object.values(areas).map((a) => ({
      area: a.area, views: a.views, people: a.people.size, panels: a.panels.size,
      pct: totalViews ? +(100 * a.views / totalViews).toFixed(1) : 0
    })).sort((a, b) => b.views - a.views),
    panels: Object.values(panels).map((p) => ({ panel: p.panel, views: p.views, people: p.people.size }))
      .sort((a, b) => b.people - a.people || b.views - a.views),
    /* Areas nobody touched are the finding, so they are returned explicitly
       rather than left as an absence the caller has to notice. */
    untouchedAreas: Object.keys(AREA).filter((a) => a !== 'studio' && !areas[a])
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'method' });

  const supaUrl = process.env.SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) return json(503, { error: 'analytics not configured' });

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = /^Bearer\s+(.+)$/i.test(auth) ? auth.replace(/^Bearer\s+/i, '') : '';
  if (!token) return json(401, { error: 'sign in required' });

  const email = await verifyEmail(supaUrl, serviceKey, token);
  if (!email) return json(401, { error: 'invalid session' });
  if (OWNER_HASHES.indexOf(await sha256Hex(email)) < 0) return json(403, { error: 'owner only' });

  const days = Math.max(1, Math.min(90, parseInt((event.queryStringParameters || {}).days, 10) || 14));
  const since = new Date(Date.now() - days * 86400e3).toISOString();

  try {
    return json(200, summarise(await fetchEvents(supaUrl, serviceKey, since), days));
  } catch (e) {
    return json(502, { error: String(e.message || e) });
  }
};

exports._internal = { summarise, AREA, AREA_OF, BOT, OWNER_PANELS };
