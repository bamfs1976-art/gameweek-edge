/*
 * The Chips page renders, and the two things it now claims are true.
 *
 * Why this file exists: the leagues panel once went blank for every
 * league because nothing in the suite had ever OPENED it — unit tests
 * covered the helper that computes a row, nothing covered the function
 * that draws it. The Chips page had the same gap, and it just gained two
 * claims that a unit test cannot check:
 *
 *  1. "Chips played across the game" — a gameweek-by-gameweek table off
 *     bootstrap-static. Its whole point is that a week nobody has reached
 *     is ABSENT rather than shown as zero, so a table listing GW38 here is
 *     a fabrication, not a formatting slip.
 *  2. The Triple Captain row names the captain, read back from that
 *     gameweek's own picks. There is no field-wide figure for this — the
 *     bootstrap's most_captained is the armband across the whole game —
 *     so the number on the row must be YOUR pick and must be tripled.
 *
 * Drives the real app against dev/mock_fpl.py, whose GW1 is played and
 * whose GW2-38 are not. Skips (exit 0) when Playwright's browser or
 * python3 is unavailable.
 *
 * Run: node dev/test-chips-page.mjs   (wired into npm test)
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

let chromium;
try{ ({ chromium } = await import('playwright')); }
catch(_){ console.log('· chips page: playwright not installed, skipped'); process.exit(0); }

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8737;
const BASE = 'http://127.0.0.1:' + PORT;

if(spawnSync('python3', ['-c', 'import sys'], { stdio: 'ignore' }).status !== 0){
  console.log('· chips page: python3 unavailable, skipped'); process.exit(0);
}
if(!existsSync(join(REPO, 'dev', 'mock_fpl.py'))){
  console.log('· chips page: mock server missing, skipped'); process.exit(0);
}

let mock = null;
let up = false;
try{ up = (await fetch(BASE + '/api/fpl/bootstrap-static/')).ok; }catch(_){}
if(!up){
  mock = spawn('python3', [join(REPO, 'dev', 'mock_fpl.py')], {
    cwd: REPO, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
  });
  for(let i = 0; i < 40 && !up; i++){
    try{ up = (await fetch(BASE + '/api/fpl/bootstrap-static/')).ok; }
    catch(_){ await new Promise(r => setTimeout(r, 250)); }
  }
}
const stop = () => { if(mock){ try{ mock.kill(); }catch(_){} } };
process.on('exit', stop);
if(!up){ stop(); console.log('· chips page: mock server did not start, skipped'); process.exit(0); }

/* What the mock says, read back rather than restated, so this suite cannot
   drift away from the fixture it is measuring. */
const boot = await (await fetch(BASE + '/api/fpl/bootstrap-static/')).json();
const played = (boot.events || []).filter(e => (e.chip_plays || []).length);
const playedGws = played.map(e => e.id);
const grand = played.reduce((s, e) => s + e.chip_plays.reduce((t, c) => t + (c.num_played || 0), 0), 0);
const hist = await (await fetch(BASE + '/api/fpl/entry/123456/history')).json();
const tc = (hist.chips || []).filter(c => c.name === '3xc')[0];

let b;
try{
  b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}catch(err){
  stop();
  console.log('· chips page: no chromium available, skipped (' + String(err.message).split('\n')[0] + ')');
  process.exit(0);
}

const results = [];
const check = (name, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want;
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `\n    got ${JSON.stringify(got)}`));
};

const ctx = await b.newContext({ viewport: { width: 1280, height: 1600 } });
await ctx.addInitScript((base) => {
  try{
    localStorage.setItem('ge-api-base', base);
    localStorage.setItem('ge-visited', '1');
    localStorage.setItem('ge-mid', '123456');
  }catch(_){}
}, BASE);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).split('\n')[0]));

await page.goto(BASE + '/chips', { waitUntil: 'load' });
await page.waitForTimeout(6000);

/* ── the season-wide table ── */
const table = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#ge-data .card')];
  const card = cards.filter(c => /Chips played across the game/.test(
    c.querySelector('.card-title')?.textContent || ''))[0];
  if(!card) return null;
  const t = card.querySelector('table');
  if(!t) return null;
  const cell = (r) => [...r.children].map(c => c.textContent.trim());
  return {
    head: cell(t.querySelector('thead tr')),
    body: [...t.querySelectorAll('tbody tr')].map(cell),
    styled: !!t.classList.contains('ptable'),
  };
});

check('the Chips page renders the season-wide table at all', !!table, true);
if(table){
  const gwRows = table.body.filter(r => /^GW\d+$/.test(r[0]));
  const footer = table.body.filter(r => /Season/.test(r[0]))[0];

  check('it uses the app\'s own table styling, not a class invented for it',
    table.styled, true);
  check('the first column is the gameweek and the last is that week\'s total',
    table.head[0] + '|' + table.head[table.head.length - 1], 'GW|Total');
  check('every chip the fixture actually served gets a column',
    table.head.length, played[0].chip_plays.length + 2);

  /* The claim the card is built around. The mock serves 38 events and only
     GW1 has been played; a row for any other week is a week the table
     invented. */
  check('exactly the played gameweeks are listed',
    gwRows.map(r => r[0]).join(','), playedGws.map(g => 'GW' + g).join(','));
  check('no gameweek still to come appears as a row of zeroes',
    gwRows.some(r => r.slice(1).every(v => v === '0')), false);

  check('a gameweek row carries a number for each chip',
    gwRows[0].slice(1).every(v => v.length > 0), true);
  check('the footer totals the whole season',
    footer && footer[footer.length - 1].replace(/[^\d]/g, ''), String(grand));
}

/* ── the Triple Captain row ── */
const tcRow = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#ge-data .card')];
  const card = cards.filter(c => (c.querySelector('.card-title')?.textContent || '').trim() === 'Chips played')[0];
  if(!card) return null;
  const row = [...card.querySelectorAll('.dl-row')]
    .filter(r => /Triple Captain/.test(r.querySelector('.dl-nm')?.textContent || ''))[0];
  if(!row) return null;
  return { text: row.textContent.replace(/\s+/g, ' ').trim(),
    sub: (row.querySelector('.dl-sub')?.textContent || '').replace(/\s+/g, ' ').trim() };
});

check('the played-chips list shows the Triple Captain week', !!tcRow, true);
if(tcRow){
  check('and names the gameweek it was played in', tcRow.text, t => t.includes('GW' + tc.event));
  /* The point of the whole addition: a name, not just a week number. */
  check('the row names a player rather than only a week',
    tcRow.sub, s => /[A-Za-z]{3,}/.test(s));
  /* And it is a TRIPLE captain — a ×2 here would mean the row was read off
     an ordinary week's picks and quietly mislabelled. */
  check('the multiplier shown is the chip\'s, not an ordinary captaincy',
    tcRow.sub, s => /×3/.test(s) && !/×2/.test(s));
}

check('rendering the Chips page raises no page error', errors.join(' | '), '');

await b.close();
stop();
const pass = results.filter(Boolean).length;
console.log(`\nchips page — ${pass}/${results.length} checks passed`);
process.exit(pass === results.length ? 0 : 1);
