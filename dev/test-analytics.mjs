/*
 * Tests for the owner analytics endpoint (netlify/functions/analytics.js).
 *
 * The whole value of this panel is that its numbers are honest. In the first
 * real sample 82% of "visitors" were crawlers and three of the rest were the
 * owner's own devices — an unfiltered figure would have been off by an order
 * of magnitude. So what is tested here is the filtering and the arithmetic,
 * not the rendering:
 *
 *   1. bots are excluded, and by user agent rather than by volume;
 *   2. the owner is excluded, by the objective test (opened an owner panel);
 *   3. days, areas and retention are counted correctly;
 *   4. the area map covers every panel the app actually has;
 *   5. nothing identifying leaves the function.
 *
 * Run: node dev/test-analytics.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { _internal } = require(join(ROOT, 'netlify/functions/analytics.js'));
const { summarise, AREA, AREA_OF, BOT } = _internal;
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let failures = 0, passes = 0;
const ok = (c, label) => { if (c) passes++; else { failures++; console.error('  ✗ ' + label); } };

const CHROME = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17 Mobile Safari';
const ev = (anon, event, panel, ts, ua = CHROME) =>
  ({ anon_id: anon, event, props: panel ? { panel } : null, ts, ua });

console.log('• bots and the owner are removed before anything is counted');
{
  const rows = [
    /* the owner: identified by opening an owner-gated panel, not by volume */
    ev('owner1', 'panel_view', 'social', '2026-07-20T09:00:00Z'),
    ev('owner1', 'panel_view', 'dashboard', '2026-07-20T09:01:00Z'),
    /* crawlers, which out-number the humans exactly as they do in production */
    ev('bot1', 'panel_view', 'dashboard', '2026-07-20T09:02:00Z', 'Googlebot/2.1 (+http://google.com/bot.html)'),
    ev('bot2', 'panel_view', 'dashboard', '2026-07-20T09:03:00Z', 'python-requests/2.31'),
    ev('bot3', 'panel_view', 'dashboard', '2026-07-20T09:04:00Z', 'HeadlessChrome/120'),
    /* one real person */
    ev('humanA', 'app_open', null, '2026-07-20T10:00:00Z'),
    ev('humanA', 'panel_view', 'dashboard', '2026-07-20T10:00:01Z')
  ];
  const s = summarise(rows, 14);
  ok(s.totals.externalVisitors === 1, 'one external visitor from seven ids (' + s.totals.externalVisitors + ')');
  ok(s.totals.ownerIdsExcluded === 1, 'the owner id is identified and excluded');
  ok(s.totals.botsExcluded === 3, 'three crawlers excluded (' + s.totals.botsExcluded + ')');
  ok(!JSON.stringify(s).includes('owner1'), 'the owner never appears in the output');
  ok(!JSON.stringify(s).includes('humanA'), 'and neither does a visitor id');
  ok(!JSON.stringify(s).includes('Mozilla'), 'no user agents leave the function either');

  /* The owner test must be the owner PANEL, not traffic volume — the owner is
     the heaviest user, and "busiest id is me" would exclude a real power user
     the day one shows up. */
  const heavy = [];
  for (let i = 0; i < 40; i++) heavy.push(ev('keen', 'panel_view', 'fixtures', '2026-07-20T10:00:00Z'));
  heavy.push(ev('owner1', 'panel_view', 'social', '2026-07-20T09:00:00Z'));
  const h = summarise(heavy, 14);
  ok(h.totals.externalVisitors === 1, 'a heavy real user is still counted as external');
  ok(h.panels.some((p) => p.panel === 'fixtures' && p.views === 40), 'with all their views');

  /* A missing user agent is not evidence of a human. */
  const noUa = summarise([ev('ghost', 'panel_view', 'dashboard', '2026-07-20T10:00:00Z', null)], 14);
  ok(noUa.totals.externalVisitors === 0, 'an id with no user agent is not counted as a person');

  ok(BOT.test('Mozilla/5.0 (compatible; bingbot/2.0)'), 'bingbot is caught');
  ok(BOT.test('Mozilla/5.0 ... Chrome-Lighthouse'), 'Lighthouse is caught');
  ok(!BOT.test(CHROME) && !BOT.test(IPHONE), 'real browsers are not');
}

console.log('• the daily counts say what they claim');
{
  const rows = [
    /* day 1: two people, one goes deeper */
    ev('a', 'app_open', null, '2026-07-20T10:00:00Z'),
    ev('a', 'panel_view', 'dashboard', '2026-07-20T10:00:01Z'),
    ev('b', 'app_open', null, '2026-07-20T11:00:00Z'),
    ev('b', 'panel_view', 'dashboard', '2026-07-20T11:00:01Z', IPHONE),
    ev('b', 'panel_view', 'fixtures', '2026-07-20T11:00:20Z', IPHONE),
    /* day 2: `a` returns, `c` is new and links a team */
    ev('a', 'panel_view', 'dashboard', '2026-07-21T10:00:00Z'),
    ev('c', 'panel_view', 'dashboard', '2026-07-21T12:00:00Z'),
    { anon_id: 'c', event: 'team_linked', props: null, ts: '2026-07-21T12:01:00Z', ua: CHROME }
  ];
  const s = summarise(rows, 14);
  const [d1, d2] = s.daily;
  ok(s.daily.length === 2, 'two days (' + s.daily.length + ')');
  ok(d1.date === '2026-07-20' && d1.visitors === 2 && d1.newVisitors === 2, 'day one: two new visitors');
  ok(d1.pastDashboard === 1, 'and one of them went past the dashboard');
  ok(d1.opens === 2 && d1.views === 3, 'opens and views counted separately (' + d1.opens + '/' + d1.views + ')');
  ok(d2.visitors === 2 && d2.newVisitors === 1, 'day two: two visitors, only one of them new');
  ok(d2.teamsLinked === 1, 'and the team link lands on the right day');

  ok(s.totals.returnedAnotherDay === 1, 'exactly one person came back (' + s.totals.returnedAnotherDay + ')');
  ok(s.totals.dashboardOnly === 2, 'two people saw only the dashboard (' + s.totals.dashboardOnly + ')');
  ok(s.totals.externalVisitors === 3, 'three people across the window');
  ok(s.totals.panelViews === 5, 'five panel views (' + s.totals.panelViews + ')');

  /* Per-day visitors must not be summed into the window total — the same
     person on two days is one person, and getting this wrong would have
     reported 5 visitors where there are 3. */
  const summed = s.daily.reduce((n, x) => n + x.visitors, 0);
  ok(summed === 4 && s.totals.externalVisitors === 3,
    'the window total de-duplicates people across days (' + summed + ' day-visits, 3 people)');
}

console.log('• areas roll up, and an untouched area is reported as a finding');
{
  const rows = [
    ev('a', 'panel_view', 'dashboard', '2026-07-20T10:00:00Z'),
    ev('a', 'panel_view', 'blog', '2026-07-20T10:01:00Z'),
    ev('b', 'panel_view', 'fixtures', '2026-07-20T10:02:00Z'),
    ev('b', 'panel_view', 'points5', '2026-07-20T10:03:00Z'),
    ev('c', 'panel_view', 'eo', '2026-07-20T10:04:00Z')
  ];
  const s = summarise(rows, 14);
  const byArea = Object.fromEntries(s.areas.map((a) => [a.area, a]));
  ok(byArea.home && byArea.home.views === 2 && byArea.home.people === 1, 'home rolls up dashboard + blog');
  ok(byArea.planner && byArea.planner.panels === 2, 'planner counts its distinct panels');
  ok(byArea.rivals && byArea.rivals.views === 1, 'a Pro panel rolls into the area it now lives in');
  const pct = s.areas.reduce((n, a) => n + a.pct, 0);
  ok(Math.abs(pct - 100) < 0.5, 'area shares total 100% (' + pct.toFixed(1) + ')');
  ok(s.areas[0].views >= s.areas[s.areas.length - 1].views, 'areas are ordered by views');

  /* The Planner having zero external views was the sharpest finding in the
     first sample, and an absent row is easy to miss. */
  ok(s.untouchedAreas.includes('players') && s.untouchedAreas.includes('match centre'),
    'areas nobody opened are listed explicitly (' + s.untouchedAreas.join(', ') + ')');
  ok(!s.untouchedAreas.includes('home'), 'and a touched area is not');
  ok(!s.untouchedAreas.includes('studio'), 'studio is owner-only, so it is never a finding');
}

console.log('• the area map matches the app');
{
  /* A new panel that nobody categorised would silently land in "other" and
     quietly under-report whichever area it belongs to. */
  const balanced = (src, from, open, close) => {
    const s = src.indexOf(open, from);
    let d = 0, inStr = null, esc = false, com = 0;
    for (let j = s; j < src.length; j++) {
      const ch = src[j], nx = src[j + 1];
      if (com) { if (com === 1 && ch === '\n') com = 0; else if (com === 2 && ch === '*' && nx === '/') { com = 0; j++; } continue; }
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; continue; }
      if (ch === '/' && nx === '/') { com = 1; j++; continue; }
      if (ch === '/' && nx === '*') { com = 2; j++; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
      if (ch === open) d++; else if (ch === close) { d--; if (!d) return src.slice(s, j + 1); }
    }
    throw new Error('unbalanced');
  };
  const NAV = new Function('return ' + balanced(html, html.indexOf('const NAV ='), '[', ']'))();
  /* Not every panel lives in NAV: a few are registered straight onto PANELS
     (PANELS.design is one) and are reachable by hash, so they still record
     panel_view events and still have to be categorised. */
  const extra = [...html.matchAll(/PANELS\.([a-z0-9-]+)\s*=\s*\{id:'([a-z0-9-]+)'/gi)].map((m) => m[2]);
  const reachable = NAV.flatMap((a) => a.panels.map((p) => p.id)).concat(extra);
  ok(extra.length > 0, 'the directly-registered panels are found (' + extra.join(', ') + ')');

  const uncategorised = reachable.filter((id) => !AREA_OF[id]);
  ok(uncategorised.length === 0,
    'every panel in the app has an area' + (uncategorised.length ? ' — missing: ' + uncategorised.join(', ') : ''));

  const stale = Object.values(AREA).flat().filter((id) => !reachable.includes(id));
  ok(stale.length === 0,
    'and the map has no panels the app no longer has' + (stale.length ? ' — stale: ' + stale.join(', ') : ''));

  /* The owner signal has to be an owner-TIER panel. PANELS.design sits outside
     the nav but is free, so counting it as proof of ownership would silently
     drop any visitor who deep-linked to #design. */
  const tierOf = Object.fromEntries(NAV.flatMap((a) => a.panels.map((p) => [p.id, p.tier])));
  const { _internal: fn } = require(join(ROOT, 'netlify/functions/analytics.js'));
  const ownerPanels = [...fn.OWNER_PANELS];
  ok(ownerPanels.length > 0, 'there is at least one owner signal');
  for (const p of ownerPanels) ok(tierOf[p] === 'owner', p + ': the owner signal is an owner-tier panel');
  ok(!ownerPanels.includes('design'), 'a free panel outside the nav is not treated as an owner signal');

  /* The areas themselves must line up with the nav, or "Planner untouched"
     names something the user cannot find. */
  const navAreas = NAV.map((a) => a.label.toLowerCase());
  const mapAreas = Object.keys(AREA);
  for (const a of mapAreas) ok(navAreas.includes(a), a + ': is a real nav area');
}

console.log('• the owner gate is server-side');
{
  const src = readFileSync(join(ROOT, 'netlify/functions/analytics.js'), 'utf8');
  /* GE_OWNER is a client flag anyone can set; it hides the panel and nothing
     more. The endpoint reads the event table, so it has to check for itself. */
  ok(/auth\/v1\/user/.test(src), 'the token is verified against Supabase, not trusted');
  ok(/OWNER_HASHES\.indexOf\(await sha256Hex\(email\)\)\s*<\s*0/.test(src),
    'the verified email is hashed and checked against the allowlist');
  ok(/return json\(403/.test(src) && /return json\(401/.test(src),
    'non-owners get 403 and unauthenticated callers 401');
  /* Strip comments first — the file explains WHY GE_OWNER cannot be the gate,
     and a bare grep would read that explanation as the offence. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ok(!/GE_OWNER/.test(code), 'the client flag is not used as the gate');

  /* Compare CALL sites inside the handler, not declaration order — fetchEvents
     is defined near the top of the file, so an indexOf against its definition
     would pass no matter where the check actually happened. */
  const handler = code.slice(code.indexOf('exports.handler'));
  ok(handler.indexOf('OWNER_HASHES.indexOf') > -1 && handler.indexOf('fetchEvents(') > -1,
    'the handler both checks and fetches');
  ok(handler.indexOf('OWNER_HASHES.indexOf') < handler.indexOf('fetchEvents('),
    'and the check happens before any data is read');
  ok(handler.indexOf('verifyEmail(') < handler.indexOf('fetchEvents('),
    'the token is verified before any data is read too');

  const idx = html.indexOf("{id:'analytics'");
  ok(idx > 0 && /tier:'owner'/.test(html.slice(idx, idx + 120)), 'the panel is owner-tier in the nav');
  ok(/analytics:hydrateAnalytics/.test(html), 'and it is wired');
  ok(/from = "\/api\/analytics"/.test(readFileSync(join(ROOT, 'netlify.toml'), 'utf8')),
    'the route exists');
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
