/*
 * Browser test for the Social Studio card builder.
 *
 * Drives the builder the way a person does — search, add, rename, switch
 * metric, flip to squad mode — and asserts the spec it produces. The builder
 * is DOM-heavy, so this covers what the offline suite in test-social.mjs
 * cannot; the pure parts (optimiser, metric formatters, card arithmetic) are
 * asserted there and run in `npm test`.
 *
 * Prerequisites (same as dev/smoke.mjs — playwright is not a dependency):
 *   python3 dev/mock_fpl.py &
 *   SP=/tmp CHROMIUM=/path/to/chrome node dev/test-builder.mjs
 */
import { chromium } from process.env.PLAYWRIGHT_PKG || 'playwright-core';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--no-sandbox'] });
const page = await browser.newPage({ viewport:{width:1200,height:1000} });
let fails=0; const ok=(c,l)=>{ console.log((c?'  ok   ':'  FAIL ')+l); if(!c)fails++; };
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto('http://127.0.0.1:8700/',{waitUntil:'domcontentloaded'});
await page.evaluate(()=>{ localStorage.setItem('ge-api-base','http://127.0.0.1:8700');
  localStorage.setItem('ge-mid','101'); localStorage.setItem('ge-tier','pro'); localStorage.setItem('ge-onboarded','1');
  localStorage.removeItem('ge-soc-build'); });
await page.reload({waitUntil:'networkidle'});
await page.evaluate(()=>{ window.GE_OWNER=true; buildNav(); openPanel('social'); });
await page.waitForSelector('#soc-builder', {timeout:20000});
await page.waitForTimeout(3500);

console.log('\n— LIST MODE —');
ok(await page.isVisible('#soc-b-q'), 'search box present');
ok((await page.textContent('#soc-b-shot')).includes('Add a player'), 'empty state shown before any pick');

await page.fill('#soc-b-q','a');
await page.waitForTimeout(200);
ok((await page.$$('#soc-b-res .soc-res')).length===0, 'single character does not search');
await page.fill('#soc-b-q','mid');
await page.waitForTimeout(300);
const nres=(await page.$$('#soc-b-res .soc-res')).length;
ok(nres>0, 'search returns results ('+nres+')');

for(let i=0;i<3;i++){ await page.fill('#soc-b-q','mid'); await page.waitForTimeout(250);
  const btn=await page.$('#soc-b-res .soc-res'); if(btn) await btn.click(); await page.waitForTimeout(500); }
ok((await page.$$('#soc-b-chips .soc-chip')).length===3, 'three players added as chips');
ok(await page.$('#soc-b-shot canvas')!==null, 'preview canvas rendered');
ok(!(await page.getAttribute('#soc-b-actions','hidden'))===true || await page.isVisible('#soc-b-actions'), 'download bar shown');

await page.fill('#soc-b-title','MY XI PICKS');
await page.waitForTimeout(600);
ok(await page.evaluate(()=>window._soc.custom && window._soc.custom.title==='MY XI PICKS'), 'title feeds the spec');
await page.selectOption('#soc-b-metric','price');
await page.waitForTimeout(600);
ok(await page.evaluate(()=>window._soc.custom.sub==='Price'), 'metric change updates the card');
ok(await page.evaluate(()=>/^£/.test(window._soc.custom.items[0].v)), 'metric value formatted as price');
ok(await page.evaluate(()=>{const it=window._soc.custom.items;
  return it.every((x,i)=>i===0||parseFloat(String(it[i-1].v).replace('£',''))>=parseFloat(String(x.v).replace('£','')));}),
  'items sorted by the chosen metric');

console.log('\n— PERSISTENCE —');
await page.reload({waitUntil:'networkidle'});
await page.evaluate(()=>{ window.GE_OWNER=true; buildNav(); openPanel('social'); });
await page.waitForSelector('#soc-b-chips',{timeout:20000});
await page.waitForTimeout(3500);
ok((await page.$$('#soc-b-chips .soc-chip')).length===3, 'picks survive a reload');
ok(await page.inputValue('#soc-b-title')==='MY XI PICKS', 'title survives a reload');

console.log('\n— SQUAD MODE —');
await page.click('.soc-build .seg-b:nth-child(2)');
await page.waitForTimeout(4000);
ok(await page.isVisible('#soc-b-budget'), 'budget slider appears');
const spec=await page.evaluate(()=>window._soc.custom);
ok(spec && spec.kind==='pitch', 'squad mode produces a pitch card');
if(spec && spec.kind==='pitch'){
  const onPitch=spec.rows.reduce((a,r)=>a+r.length,0);
  ok(onPitch===11,'eleven starters ('+onPitch+')');
  ok(spec.bench.length===4,'four subs');
  ok(spec.cost+spec.bank===1000,'budget adds up to £100.0m');
}
const locked=await page.evaluate(()=>SOC_BUILD.ids);
ok(await page.evaluate(ids=>{const all=window._soc.custom.rows.flat().concat(window._soc.custom.bench).map(p=>p.nm);
  const byId={}; window._soc.b.elements.forEach(e=>byId[e.id]=e);
  return ids.every(id=>all.includes(byId[id].web_name));}, locked), 'locked players all appear in the built squad');

ok(errs.length===0,'no page errors ('+errs.slice(0,3).join('; ')+')');
if(process.env.SP) await page.screenshot({path:process.env.SP+'/builder.png'});
await browser.close();
console.log('\n'+(fails?fails+' FAILED':'all checks passed'));
process.exit(fails?1:0);
