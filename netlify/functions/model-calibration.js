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

exports.handler = async () => {
  const supaUrl = process.env.SUPABASE_URL, supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return json({ configured: false, n: 0 }, 60);

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { data: all, error } = await sb.from('gwedge_predictions')
    .select('season,gw,xp,haul_prob,actual').not('actual', 'is', null).limit(50000);
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
  }, 1800);
};
