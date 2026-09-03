/*
 * The Social Studio's personal cards actually get built.
 *
 * WHY THIS FILE EXISTS. Two of the studio's cards are about the reader's own
 * team — `your-gameweek` and `manager-report` — and both refuse to build
 * unless our arithmetic reproduces FPL's own total for the week. That guard
 * is right: a graphic is the one format nobody goes back and corrects, so a
 * card whose column disagrees with its headline must not be published.
 *
 * The failure mode it creates is SILENCE. socialSpecs() builds every card
 * inside a try/catch, so a card that throws, or one whose guard declines,
 * simply is not in the gallery — indistinguishable from a card that was
 * never written. Both personal cards were in exactly that state against the
 * mock and nothing said so: dev/mock_fpl.py declared entry_history.points as
 * a flat 55 while the eleven it described summed to 70, so `reconciles` was
 * false for every manager, forever.
 *
 * So this checks the thing no offline test can: that the cards come out.
 *
 *  1. A linked manager gets both personal cards.
 *  2. The manager report carries its six labelled figures.
 *  3. Its footer note fits the two lines the renderer keeps — measured in
 *     the renderer's own font, so "it fitted on my screen" is not the test.
 *  4. It renders to a canvas that is not blank.
 *  5. An UNLINKED visitor gets neither. There is no generic version of your
 *     own gameweek, and inventing one would be worse than omitting it.
 *
 * Run: node dev/test-social-cards.mjs   (wired into npm test)
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

let chromium;
try{ ({ chromium } = await import('playwright')); }
catch(_){ console.log('· social cards: playwright not installed, skipped'); process.exit(0); }

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8739;
const BASE = 'http://127.0.0.1:' + PORT;

if(spawnSync('python3', ['-c', 'import sys'], { stdio: 'ignore' }).status !== 0){
  console.log('· social cards: python3 unavailable, skipped'); process.exit(0);
}
if(!existsSync(join(REPO, 'dev', 'mock_fpl.py'))){
  console.log('· social cards: mock server missing, skipped'); process.exit(0);
}

let mock = null, up = false;
const ENV = { ...process.env, PORT: String(PORT), no_proxy: '127.0.0.1', NO_PROXY: '127.0.0.1' };
try{ up = (await fetch(BASE + '/api/fpl/bootstrap-static/')).ok; }catch(_){}
if(!up){
  mock = spawn('python3', [join(REPO, 'dev', 'mock_fpl.py')], { cwd: REPO, env: ENV, stdio: 'ignore' });
  for(let i = 0; i < 40 && !up; i++){
    try{ up = (await fetch(BASE + '/api/fpl/bootstrap-static/')).ok; }
    catch(_){ await new Promise(r => setTimeout(r, 250)); }
  }
}
const stop = () => { if(mock){ try{ mock.kill(); }catch(_){} } };
process.on('exit', stop);
if(!up){ stop(); console.log('· social cards: mock server did not start, skipped'); process.exit(0); }

let b;
try{
  b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}catch(err){
  stop();
  console.log('· social cards: no chromium available, skipped (' + String(err.message).split('\n')[0] + ')');
  process.exit(0);
}

const results = [];
const check = (name, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want;
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}` + (ok ? '' : `\n    got ${JSON.stringify(got)}`));
};

/* Everything the studio would build, for one audience. */
async function studio(mid){
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1400 } });
  await ctx.addInitScript(([base, m]) => {
    try{
      localStorage.setItem('ge-api-base', base);
      localStorage.setItem('ge-visited', '1');
      if(m) localStorage.setItem('ge-mid', m); else localStorage.removeItem('ge-mid');
    }catch(_){}
  }, [BASE, mid]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await page.goto(BASE + '/social', { waitUntil: 'load' });
  await page.waitForTimeout(9000);
  const got = await page.evaluate(async () => {
    const bb = await boot(), fx = await loadFixtures();
    const packEv = gwPackEvent(bb);
    if(!packEv) return { packEv: null };
    const live = await loadLive(packEv.id).catch(() => null);
    const me = getMid() ? await socMeGw(packEv.id).catch(() => null) : null;
    const specs = socialSpecs(bb, fx, live, me);
    const mr = specs.find(s => s.id === 'manager-report') || null;

    /* The footer keeps two wrapped lines and marks anything past them with
       an ellipsis. Wrap it here the way renderSocialCard does, in the same
       font, so a note that would be cut is a measured fact. */
    const noteLines = (() => {
      if(!mr || !mr.note) return 0;
      const cv = document.createElement('canvas');
      cv.width = 1080; cv.height = 1350;
      const x = cv.getContext('2d');
      x.font = '600 21px system-ui,sans-serif';
      let line = '', n = 0;
      String(mr.note).split(' ').forEach(w => {
        const t = line ? line + ' ' + w : w;
        if(x.measureText(t).width > 1080 - 140){ n++; line = w; } else line = t;
      });
      if(line) n++;
      return n;
    })();

    /* A card that draws nothing still produces a canvas. Sample the middle
       band for ink so "it rendered" means something was actually painted. */
    const painted = (() => {
      if(!mr) return 0;
      const cv = renderSocialCard(mr, 1);
      const x = cv.getContext('2d');
      const d = x.getImageData(0, Math.floor(cv.height * 0.3), cv.width,
        Math.floor(cv.height * 0.4)).data;
      let light = 0;
      for(let i = 0; i < d.length; i += 4){
        if(d[i] + d[i + 1] + d[i + 2] > 300) light++;
      }
      return light;
    })();

    return {
      packEv: packEv.id,
      ids: specs.map(s => s.id),
      report: mr && { kind: mr.kind, title: mr.title, sub: mr.sub,
        labels: (mr.groups || []).map(g => g.label),
        values: (mr.groups || []).map(g => (g.items[0] || {}).nm),
        subs: (mr.groups || []).map(g => (g.items[0] || {}).team) },
      noteLines, painted,
    };
  });
  await ctx.close();
  return { got, errors };
}

/* ── a linked manager ── */
console.log('\nthe linked manager gets a report card');
{
  const { got, errors } = await studio('123456');
  check('the gameweek stats pack is reachable at all', got.packEv, n => n != null);
  check('the manager report is in the gallery',
    (got.ids || []).includes('manager-report'), true);
  /* The other personal card shares the reconciliation guard, so it is the
     canary for the same failure. */
  check('and so is the squad card it sits beside',
    (got.ids || []).includes('your-gameweek'), true);
  check('the report is six labelled figures',
    got.report && got.report.labels.join(','),
    s => s === 'SCORE,VS AVERAGE,OVERALL RANK,CAPTAIN,BENCH,TRANSFERS');
  check('every figure carries a value', got.report && got.report.values,
    v => Array.isArray(v) && v.length === 6 && v.every(n => n != null && String(n) !== ''));
  check('and every figure says what it means', got.report && got.report.subs,
    v => Array.isArray(v) && v.every(t => t && String(t).trim() !== ''));
  check('it names itself and the gameweek', got.report && got.report.title, 'MANAGER REPORT');
  check('the sub-line carries the gameweek', got.report && got.report.sub, s => /^GW\d+/.test(s));
  /* The footer truncates past two lines, and a graphic cut mid-clause is
     the kind of thing nobody can correct after posting. */
  check('the footer note fits without being cut', got.noteLines, n => n > 0 && n <= 2);
  check('the card paints something', got.painted, n => n > 5000);
  check('building the studio raises no page error', errors.join(' | '), '');
}

/* ── a visitor with no team ── */
console.log('\na visitor with no team gets no personal card');
{
  const { got, errors } = await studio(null);
  check('the gallery still builds', (got.ids || []).length, n => n > 5);
  check('but the report is absent',
    (got.ids || []).includes('manager-report'), false);
  check('and so is the squad card',
    (got.ids || []).includes('your-gameweek'), false);
  check('the unlinked studio raises no page error', errors.join(' | '), '');
}

await b.close(); stop();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
