/* Headless smoke test: loads the app, walks every panel (free + Pro via
   the device preview), and fails on any page error or missing render.
   Run:  node raceweekedge/dev/smoke.mjs  (from the repo root) */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=process.env.RWE_ROOT||join(dirname(fileURLToPath(import.meta.url)),'..');
const server=createServer(async(req,res)=>{
  const path=req.url==='/'?'/index.html':req.url.split('?')[0];
  try{
    const body=await readFile(join(root,path));
    const type=path.endsWith('.html')?'text/html':path.endsWith('.js')?'text/javascript'
      :path.endsWith('.svg')?'image/svg+xml':path.endsWith('.webmanifest')?'application/manifest+json'
      :'application/octet-stream';
    res.writeHead(200,{'Content-Type':type});
    res.end(body);
  }catch(_){res.writeHead(404);res.end('not found');}
});
await new Promise(r=>server.listen(0,r));
const port=server.address().port;

const {chromium}=await import('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
const page=await browser.newPage();
const errors=[];
page.on('pageerror',e=>errors.push('pageerror: '+e.message));
/* Resource-load failures (fonts, /api proxy, sw) are environment-dependent
   and every consumer degrades gracefully — only real JS errors fail the run. */
page.on('console',m=>{
  if(m.type()!=='error')return;
  const t=m.text();
  if(/Failed to load resource|bad HTTP response|ERR_CONNECTION|ServiceWorker/i.test(t))return;
  errors.push('console: '+t);
});

await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'networkidle'});
await page.evaluate(()=>{localStorage.setItem('rwe-onboarded','true');localStorage.setItem('rwe-tier','"pro"');});
await page.reload({waitUntil:'networkidle'});

const panels=await page.evaluate(()=>Object.keys(PANELS));
let ok=0,fail=0;
for(const id of panels){
  await page.evaluate(pid=>openPanel(pid),id);
  await page.waitForTimeout(120);
  const hasContent=await page.evaluate(()=>{
    const m=document.getElementById('main');
    return !!m&&m.innerText.trim().length>40;
  });
  const status=hasContent&&!errors.length?'ok':'FAIL';
  if(status==='ok')ok++;else fail++;
  console.log(status.padEnd(5),id,errors.length?errors.join(' | '):'');
  errors.length=0;
}
/* Exercise the builder flow end to end. */
await page.evaluate(()=>{draftTemplate();});
await page.waitForTimeout(120);
const saved=await page.evaluate(()=>{draftSave();return !!localStorage.getItem('rwe-team');});
console.log(saved?'ok   ':'FAIL ','builder save flow');
if(!saved)fail++;
await page.evaluate(()=>openPanel('lineup'));
await page.waitForTimeout(120);
const lineupOk=await page.evaluate(()=>/projected/i.test(document.getElementById('main').innerText));
console.log(lineupOk?'ok   ':'FAIL ','lineup renders saved team');
if(!lineupOk)fail++;

await browser.close();
server.close();
console.log(`\n${ok+2-fail>=ok?'':''}${ok} panels ok, ${fail} failures`);
process.exit(fail?1:0);
