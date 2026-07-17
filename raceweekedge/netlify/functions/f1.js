/* RaceWeek Edge — results-feed proxy.
   Proxies the community Jolpica-F1 API (the Ergast successor) so the
   client can pull real 2026 standings and results with CORS + caching.
   Same shape as Gameweek Edge's FPL proxy: endpoint allowlist, tidy
   errors, edge-cache for slow-moving data. */
const BASE='https://api.jolpi.ca/ergast/f1/';
const ALLOW=[
  /^current\/driverstandings\.json$/i,
  /^current\/constructorstandings\.json$/i,
  /^current\/results\.json$/i,
  /^current\/last\/results\.json$/i,
  /^current\.json$/i,
  /^\d{4}\/\d{1,2}\/results\.json$/i
];

exports.handler=async function(event){
  const path=(event.path||'').replace(/^.*\/api\/f1\//,'').replace(/^\/+/,'');
  const qs=event.rawQuery?('?'+event.rawQuery):'';
  const headers={
    'Access-Control-Allow-Origin':'*',
    'Content-Type':'application/json; charset=utf-8'
  };
  if(!ALLOW.some(rx=>rx.test(path))){
    return {statusCode:400,headers,body:JSON.stringify({error:'endpoint not allowed',path})};
  }
  try{
    const res=await fetch(BASE+path+qs,{headers:{'Accept':'application/json','User-Agent':'raceweek-edge/1.0'}});
    const body=await res.text();
    return {
      statusCode:res.status,
      headers:{...headers,'Cache-Control':'public, max-age=300, stale-while-revalidate=600'},
      body
    };
  }catch(err){
    return {statusCode:502,headers,body:JSON.stringify({error:'upstream unavailable'})};
  }
};
