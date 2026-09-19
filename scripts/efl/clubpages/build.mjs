/* Fantasy EFL — write the club pages into www/ from efl/data/club-pages.json.

   No snapshot yet means no pages and no sitemap entries, said plainly
   rather than a build failure. Same arrangement as the FPL tool pages
   (scripts/tools/build.mjs) and for the same reason: a page that does not
   exist is better than one with no data, and a deploy that fails because
   somebody else's feed is down is worse than both. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderAll } from './pages.mjs';

export const SNAPSHOT = 'efl/data/club-pages.json';

export async function buildEflClubPages(root, out) {
  const file = join(root, SNAPSHOT);
  if (!existsSync(file)) {
    return { pages: 0, urls: [], built: null, note: 'no snapshot at ' + SNAPSHOT + ' (the efl-ledger workflow writes it)' };
  }
  const snap = JSON.parse(readFileSync(file, 'utf8'));
  const pages = renderAll(snap);
  const urls = [];
  for (const [path, html] of pages) {
    const dir = join(out, path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), html);
    urls.push({ path, freq: 'daily', pri: '0.6' });
  }
  return { pages: pages.size, urls, built: snap.built };
}
