/* Gameweek Edge — write the tool pages into www/ from data/tool-pages.json.
   No snapshot yet (the first scheduled run has not happened) means no
   pages and no sitemap entries, said plainly rather than a build failure:
   a page that does not exist is better than one with no data. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderAll } from './pages.mjs';

export const SNAPSHOT = 'data/tool-pages.json';

export async function buildToolPages(root, out, links) {
  const file = join(root, SNAPSHOT);
  if (!existsSync(file)) return { pages: 0, urls: [], built: null, note: 'no snapshot at ' + SNAPSHOT + ' (the tool-pages workflow writes it)' };
  const snap = JSON.parse(readFileSync(file, 'utf8'));
  const pages = renderAll(snap, links);
  const urls = [];
  for (const [path, html] of pages) {
    const dir = join(out, path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), html);
    urls.push({ path, freq: 'daily', pri: path.split('/').filter(Boolean).length <= 2 ? '0.7' : '0.6' });
  }
  return { pages: pages.size, urls, built: snap.built };
}
