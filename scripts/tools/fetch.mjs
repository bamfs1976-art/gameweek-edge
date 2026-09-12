/* Gameweek Edge — refresh data/tool-pages.json from the official FPL API.

   Run on a schedule by .github/workflows/tool-pages.yml, which commits the
   file when it changed; the next deploy renders the tool pages from it.

     node scripts/tools/fetch.mjs
     FPL_API=http://127.0.0.1:8700/api/fpl SITE_API=http://127.0.0.1:8700 node scripts/tools/fetch.mjs --out /tmp/snap.json

   The price feed (our own /api/price-feed on the live site) supplies the
   day-by-day price changes; it is optional, and a miss leaves the page
   with the gameweek's changes only. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildSnapshot } from './snapshot.mjs';

const API = (process.env.FPL_API || 'https://fantasy.premierleague.com/api').replace(/\/$/, '');
const SITE_API = (process.env.SITE_API || 'https://gameweekedge.co.uk').replace(/\/$/, '');
const argOut = process.argv.indexOf('--out');
const OUT = argOut > 0 ? process.argv[argOut + 1] : join(process.cwd(), 'data', 'tool-pages.json');
const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)';

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
    }
  }
}

const [boot, fixtures] = await Promise.all([get(API + '/bootstrap-static/'), get(API + '/fixtures/')]);
let feed = null;
try { feed = await get(SITE_API + '/api/price-feed', 1); } catch (e) { console.log('price feed unavailable (' + e.message + '); gameweek changes only'); }
const snap = buildSnapshot(boot, fixtures, feed && feed.configured ? feed : null);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(snap) + '\n');
console.log('tool-pages snapshot → ' + OUT + ': ' + snap.teams.length + ' teams, ' + snap.fixtures.length + ' fixtures, ' + snap.players.length + ' players, ' + snap.flags.length + ' flagged, movers on ' + (snap.movers.day || 'no feed day'));
