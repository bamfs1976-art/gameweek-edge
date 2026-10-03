/* Gameweek Edge — public model-calibration read (P5).
   Returns AGGREGATE accuracy of the logged predictions vs actual returns:
   MAE, a haul-probability Brier score and reliability curve. No user data
   is exposed — gwedge_predictions is model analytics, keyed by gameweek
   and player only. Read with the service-role key; served publicly so the
   Model Accountability page can show the model graded in public.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. No-ops if unconfigured. */

const json = (o, maxAge) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + (maxAge || 1800) },
  body: JSON.stringify(o),
});

/* Page through every graded row. PostgREST caps each response (1,000 rows by
   default) whatever .limit() asks for, so a single .limit(50000) read came
   back with the first 1,000 rows in no set order and the public record was
   graded on that sample: n 1000 against 2,273 graded rows by GW5 of 2026/27.
   Ordering on the logger's upsert key (season, gw, element) keeps the pages
   stable, and a short page means the table is exhausted. */
const PAGE = 1000, MAX_PAGES = 200;
async function fetchGraded(sb) {
  const rows = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const from = p * PAGE;
    const { data, error } = await sb.from('gwedge_predictions')
      .select('season,gw,element,xp,haul_prob,actual').not('actual', 'is', null)
      .order('season').order('gw').order('element')
      .range(from, from + PAGE - 1);
    if (error) return { error };
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { rows };
}

/* Ranking, not just error. A manager acts on the ORDER of players (who to
   captain, who to bring in), and a model can have a decent average error
   while ordering them badly. Two reads per gameweek, then averaged:
     rank correlation  Spearman between projected and actual points;
     top-10 hit rate   of the model's ten highest projections, the share that
                       scored at least the tenth-best actual score that week
                       (so ties at the cut count as hits, never as misses).
   Gameweeks with fewer than 20 graded players are skipped as too thin. */
function ranks(a) {
  const o = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  for (let i = 0; i < o.length;) {
    let j = i; while (j < o.length && o[j][0] === o[i][0]) j++;
    for (let k = i; k < j; k++) r[o[k][1]] = (i + j - 1) / 2;
    i = j;
  }
  return r;
}
function spearman(x, y) {
  const a = ranks(x), b = ranks(y), n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let c = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
  return va && vb ? c / Math.sqrt(va * vb) : null;
}
function rankStats(rows) {
  const byGw = new Map();
  for (const r of rows) { if (!byGw.has(r.gw)) byGw.set(r.gw, []); byGw.get(r.gw).push(r); }
  let sp = 0, spN = 0, hit = 0, hitN = 0;
  for (const g of byGw.values()) {
    if (g.length < 20) continue;
    const s = spearman(g.map((r) => r.xp || 0), g.map((r) => r.actual));
    if (s != null) { sp += s; spN++; }
    const cut = g.map((r) => r.actual).sort((a, b) => b - a)[9];
    const top = g.slice().sort((a, b) => (b.xp || 0) - (a.xp || 0)).slice(0, 10);
    hit += top.filter((r) => r.actual >= cut).length / 10; hitN++;
  }
  return {
    rankCorr: spN ? Math.round(sp / spN * 1000) / 1000 : null,
    top10Hit: hitN ? Math.round(hit / hitN * 1000) / 1000 : null,
    rankGws: spN,
  };
}

exports.handler = async () => {
  const supaUrl = process.env.SUPABASE_URL, supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return json({ configured: false, n: 0 }, 60);

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { rows: all, error } = await fetchGraded(sb);
  if (error || !all || !all.length) return json({ n: 0 }, 300);

  /* Report the latest season that has graded data, so the accuracy card
     shows this season once it starts grading and last season until then —
     never a cross-season mix (gameweek numbers repeat every year). */
  const season = all.reduce((m, r) => (r.season > m ? r.season : m), all[0].season || '');
  const data = all.filter((r) => (r.season || '') === season);
  if (!data.length) return json({ n: 0, season }, 300);

  let ae = 0; const gws = new Set(); const rel = [];
  for (const r of data) {
    ae += Math.abs((r.xp || 0) - r.actual);
    gws.add(r.gw);
    if (r.haul_prob != null) rel.push({ p: r.haul_prob, y: r.actual >= 10 ? 1 : 0 });
  }
  const mae = ae / data.length;

  /* Brier + reliability curve on the haul probability (same maths as the
     app's calibration() helper). */
  let brier = 0; const B = 10, acc = Array.from({ length: B }, () => ({ sp: 0, sy: 0, n: 0 }));
  for (const r of rel) {
    const p = Math.max(0, Math.min(1, r.p)), y = r.y;
    brier += (p - y) * (p - y);
    const b = acc[Math.min(B - 1, Math.floor(p * B))]; b.sp += p; b.sy += y; b.n++;
  }
  const buckets = acc.filter((b) => b.n).map((b) => ({
    pMean: Math.round(b.sp / b.n * 1000) / 1000, oFreq: Math.round(b.sy / b.n * 1000) / 1000, n: b.n,
  }));

  return json({
    n: data.length,
    season,
    gws: gws.size,
    mae: Math.round(mae * 1000) / 1000,
    brier: rel.length ? Math.round(brier / rel.length * 10000) / 10000 : null,
    buckets,
    ...rankStats(data),
  }, 1800);
};

module.exports.fetchGraded = fetchGraded;
module.exports.rankStats = rankStats;
