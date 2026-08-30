/*
 * The leagues panel renders. All the way in.
 *
 * Why this file exists: a one-line change added a reference to a variable
 * that was not in scope, and the whole mini-league panel went blank —
 * every league, both views. The full suite stayed green, because nothing
 * in it had ever OPENED a league. Unit tests covered the helper that
 * computes a row's score; no test covered the function that renders the
 * row. So the panel's most load-bearing property — it draws at all — was
 * the one property nothing checked.
 *
 * What must hold:
 *  1. The league index lists the manager's leagues.
 *  2. Clicking a classic league renders standings rows, with no page error.
 *  3. The Detailed view renders manager cards with a gameweek score.
 *  4. A head-to-head league renders too — it takes a different branch.
 *  5. No uncaught error at any step. A ReferenceError anywhere in the
 *     render aborts it silently, which is exactly how this shipped.
 *
 * Drives the real app against dev/mock_fpl.py. Skips (exit 0) when
 * Playwright's browser or python3 is unavailable.
 *
 * Run: node dev/test-leagues.mjs   (wired into npm test)
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

let chromium;
try{ ({ chromium } = await import('playwright')); }
catch(_){ console.log('· leagues panel: playwright not installed, skipped'); process.exit(0); }

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8733;
const BASE = 'http://127.0.0.1:' + PORT;

if(spawnSync('python3', ['-c', 'import sys'], { stdio: 'ignore' }).status !== 0){
  console.log('· leagues panel: python3 unavailable, skipped'); process.exit(0);
}
if(!existsSync(join(REPO, 'dev', 'mock_fpl.py'))){
  console.log('· leagues panel: mock server missing, skipped'); process.exit(0);
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
if(!up){ stop(); console.log('· leagues panel: mock server did not start, skipped'); process.exit(0); }

let b;
try{
  b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}catch(err){
  stop();
  console.log('· leagues panel: no chromium available, skipped (' + String(err.message).split('\n')[0] + ')');
  process.exit(0);
}

const results = [];
const check = (name, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want;
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `\n    got ${JSON.stringify(got)}`));
};

const ctx = await b.newContext({ viewport: { width: 1280, height: 1400 } });
await ctx.addInitScript((base) => {
  try{
    localStorage.setItem('ge-api-base', base);
    localStorage.setItem('ge-visited', '1');   /* never bounce to /welcome */
    localStorage.setItem('ge-mid', '123456');  /* a linked team, or the panel is a link box */
  }catch(_){}
}, BASE);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).split('\n')[0]));

await page.goto(BASE + '/leagues', { waitUntil: 'load' });
await page.waitForTimeout(4000);

/* ── the index ── */
{
  const got = await page.evaluate(() => ({
    titles: [...document.querySelectorAll('#ge-data .card-title')].map(e => e.textContent.trim()),
    leagues: document.querySelectorAll('#ge-data [data-league]').length,
  }));
  check('the league index lists classic leagues', got.titles.join('|'), t => /Classic leagues/.test(t));
  check('the league index lists head-to-head leagues', got.titles.join('|'), t => /Head-to-head/.test(t));
  check('every league is a row you can open', got.leagues, n => n >= 2);
}

/* ── into a classic league: the render that went blank ── */
const openLeague = async (type) => {
  await page.evaluate(() => { LEAGUE_SEL = null; renderPage('leagues'); });
  await page.waitForTimeout(1500);
  await page.click(`#ge-data [data-league][data-type="${type}"]`);
  await page.waitForTimeout(3500);
};

{
  await openLeague('classic');
  const got = await page.evaluate(() => ({
    table: !!document.getElementById('league-standings'),
    rows: document.querySelectorAll('#league-standings .dl-row:not(.head)').length,
    names: [...document.querySelectorAll('#league-standings .dl-nm')].map(e => e.textContent.trim()),
    back: !!document.querySelector('#ge-data .btn-ghost'),
    empty: (document.getElementById('ge-data')?.textContent || '').trim().length,
  }));
  check('a classic league renders its standings table', got.table, true);
  check('the table has manager rows', got.rows, n => n >= 2);
  check('the rows carry team names', got.names.length, n => n >= 2);
  check('the panel is not blank', got.empty, n => n > 200);
  check('opening a classic league raises no page error', errors.join(' | '), '');
}

/* ── the detailed view ── */
{
  await page.evaluate(() => lgSetView('detailed'));
  await page.waitForTimeout(5000);
  /* The progress line lives inside the collapsed squad box. */
  await page.evaluate(() => [...document.querySelectorAll('.lg-mgr .lg-head')]
    .forEach(el => el.click()));
  await page.waitForTimeout(1200);
  const got = await page.evaluate(() => ({
    cards: document.querySelectorAll('.lg-mgr').length,
    score: document.querySelector('.lg-mgr .lg-head .lg-num b')?.textContent.trim(),
    titled: document.querySelector('.lg-mgr .lg-head .lg-num')?.getAttribute('title') || '',
    total: document.querySelector('.lg-mgr .lg-head .lg-tot b')?.textContent.trim(),
    totalTitle: document.querySelector('.lg-mgr .lg-head .lg-tot')?.getAttribute('title') || '',
    labels: [...document.querySelectorAll('.lg-mgr .lg-head .lg-num small')]
      .slice(0, 2).map(e => e.textContent.trim()),
    /* The whole point of the column: it must not read as last week's
       total sitting beside this week's live score. */
    /* Keyed to BOTH the entry and the gameweek: the mock's history
       returns overall_rank = 1000000 + entry + event, so a rank pulled
       from the wrong manager, or from the wrong week of the right
       manager, is caught rather than merely looking plausible. */
    ors: [...document.querySelectorAll('.lg-mgr')]
      .map(el => (el.querySelector('.lg-pill[title*="overall rank"]') || {}).textContent || '')
      .filter(Boolean),
    orMismatches: [...document.querySelectorAll('.lg-mgr')].map(el => {
      const entry = ((el.querySelector('.lg-head')?.getAttribute('onclick') || '')
        .match(/lgToggle\((\d+)\)/) || [])[1];
      const pill = el.querySelector('.lg-pill[title*="overall rank"]');
      if(!entry || !pill) return 'missing:' + entry;
      const want = (1000000 + Number(entry) + 1).toLocaleString('en-GB');
      return pill.textContent.includes(want) ? '' : entry + ':' + pill.textContent;
    }).filter(Boolean),
    orTitle: document.querySelector('.lg-mgr .lg-pill[title*="overall rank"]')
      ?.getAttribute('title') || '',
    settledPill: [...document.querySelectorAll('.lg-mgr')].every(el =>
      [...el.querySelectorAll('.lg-pill')].some(x => /^SETTLED/.test(x.textContent.trim()))),
    /* Open every card, read "Settled a/b" and the named buckets, and
       require a = b once the buckets are added back. */
    progressMismatch: [...document.querySelectorAll('.lg-mgr')].map(el => {
      const t = (el.querySelector('.lg-prog')?.nextElementSibling?.textContent || '');
      const head = t.match(/Settled\s+(\d+)\/(\d+)/);
      if(!head) return 'no progress line';
      const grab = (re) => { const m = t.match(re); return m ? Number(m[1]) : 0; };
      const sum = Number(head[1]) + grab(/(\d+)(?:\s*\([^)]*\))?\s+still to play/) +
        grab(/(\d+)(?:\s*\([^)]*\))?\s+on the pitch/) +
        grab(/(\d+)(?:\s*\([^)]*\))?\s+with no fixture/);
      return sum === Number(head[2]) ? '' : head[0] + ' but buckets sum to ' + sum;
    }).filter(Boolean),
    totalsAscendWithRank: (() => {
      const t = [...document.querySelectorAll('.lg-mgr .lg-tot b')]
        .map(e => parseInt(e.textContent.replace(/[^0-9-]/g, ''), 10));
      return t.length >= 2 && t.every(n => Number.isFinite(n)) &&
        t.every((n, i) => i === 0 || t[i - 1] >= n);
    })(),
  }));
  check('Detailed renders manager cards', got.cards, n => n >= 1);
  check('each card prints a gameweek score', got.score, s => s != null && /\d/.test(s));
  check('and says what that score is', got.titled, s => /gameweek|live/i.test(s));
  /* The rows are ordered on the season total, so a card that shows only
     the gameweek score is sorted by a number it never prints. */
  check('each card prints the season total too', got.total, s => s != null && /\d/.test(s));
  check('both score columns are labelled', got.labels.join('|'), 'gw|total');
  check('the total says which season figure it is', got.totalTitle, s => /season total/i.test(s));
  check('totals fall with rank, so the ordering reads', got.totalsAscendWithRank, true);
  /* The OR column had no coverage at all — the mock carried no
     overall_rank field, so the pill never rendered under test while it
     was on every card in production. It now does, keyed to the entry id
     so a misattributed rank cannot pass. */
  check('every card prints an overall rank', got.ors.length, n => n >= 2);
  check('and each rank is the one belonging to that manager',
    got.orMismatches.join('|'), '');
  check('the rank says whose figure it is and when', got.orTitle, s => /overall rank after gameweek/i.test(s));
  check('every card labels the progress pill SETTLED, not PLAYED', got.settledPill, true);
  /* The property the report was about: the sentence under the bar has to
     reconcile against its own denominator. It did not, because half of it
     was counted in players and half in scoring slots. */
  check('the progress breakdown adds up to its denominator',
    got.progressMismatch.join('|'), '');
  check('the detailed view raises no page error', errors.join(' | '), '');
  await page.evaluate(() => lgSetView('compact'));
  await page.waitForTimeout(2500);
}

/* ── head-to-head takes the other branch ── */
{
  await openLeague('h2h');
  const got = await page.evaluate(() => ({
    rows: document.querySelectorAll('#league-standings .dl-row:not(.head)').length,
    head: document.querySelector('#league-standings .dl-row.head')?.textContent.trim() || '',
  }));
  check('a head-to-head league renders its standings', got.rows, n => n >= 2);
  check('with the W-D-L header, not the classic one', got.head, s => /W-D-L/.test(s));
  check('the h2h render raises no page error', errors.join(' | '), '');
}

await ctx.close();
await b.close(); stop();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
