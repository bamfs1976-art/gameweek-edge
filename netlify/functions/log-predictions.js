/* Gameweek Edge — scheduled model-prediction logger (P5 calibration loop).
   Runs hourly. Before each deadline it logs the shipping model's forecast
   (xP + haul/blank probabilities) for every player with a fixture in the
   upcoming gameweek into public.gwedge_predictions; once a gameweek
   finishes it backfills each row's actual return. The Model Accountability
   page then grades the model in public.

   Fidelity: rather than re-implement the model, the exact functions are
   EXTRACTED from index.html at runtime (the file ships with the function
   via netlify.toml included_files) and run on live FPL data — so what is
   graded is precisely what the app shows. No model duplication.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. No-ops if unconfigured. */

const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (compatible; GameweekEdge/1.0; +https://gameweekedge.co.uk)';

/* ── extract the model cluster from index.html ──────────── */
/* Comment-aware brace matcher: skips // and block comments and string
   literals so apostrophes in comments cannot throw off the balance. */
function extractBlock(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0, inStr = null, esc = false, com = 0;
  for (let j = open; j < src.length; j++) {
    const ch = src[j], nx = src[j + 1];
    if (com) { if (com === 1 && ch === '\n') com = 0; else if (com === 2 && ch === '*' && nx === '/') { com = 0; j++; } continue; }
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && nx === '/') { com = 1; j++; continue; }
    if (ch === '/' && nx === '*') { com = 2; j++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced block');
}
const grabFn = (h, n) => extractBlock(h, h.indexOf('function ' + n + '('));
const grabConst = (h, n) => extractBlock(h, h.indexOf('const ' + n + '=')) + ';';

/* Build a model module from the app source — the same functions the
   browser runs. `MEM` is stubbed so plsimRatings can memoise harmlessly. */
function buildModel(html) {
  const pieces = [
    grabConst(html, 'PLSIM'), grabConst(html, 'PLSIM_ALIAS'),
    /* PLSIM_PROMOTED is an array literal, not a {} block, so grab it by line
       (extractBlock only balances braces). plsimPrior references it. */
    (html.match(/const PLSIM_PROMOTED=\[[\d.,]+\];/) || [''])[0],
    grabFn(html, 'poisson'),
    /* plsimPrior consults an Elo-derived prior for clubs with no offline
       fit; the logger passes no Elo map, so it takes the old path. */
    ...['ELO_SCALE', 'ELO_ATT', 'ELO_DEF', 'ELO_CLAMP']
      .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
    grabFn(html, 'eloMean'), grabFn(html, 'eloPrior'),
    grabFn(html, 'plsimPrior'), grabFn(html, 'plsimMatch'),
    grabFn(html, 'recencyWeight'), grabFn(html, 'availAttackMult'), grabFn(html, 'plsimRatings'),
    grabFn(html, 'plsimDiff'), grabFn(html, 'teamShort'),
    /* Fixture congestion: buildNextFix scores it onto each fixture and
       minutesModel discounts a start for it. The logger passes no European
       calendar (`b.euro` is undefined), so the load is 0 everywhere and the
       logged projections match what the app computes without one. */
    ...['CONGEST_FULL', 'CONGEST_FADE', 'CONGEST_MAX', 'CONGEST_NAILED', 'CONGEST_TO_BENCH']
      .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
    grabFn(html, 'congestionLoad'), grabFn(html, 'congestionFactor'),
    grabFn(html, 'buildNextFix'),
    grabFn(html, 'minutesModel'), grabFn(html, 'concedePts'), grabFn(html, 'effGoalRate'), grabFn(html, 'negRate90'),
    grabFn(html, 'nativeXP'), grabFn(html, 'xP'), grabFn(html, 'pointsDist'),
  ];
  // eslint-disable-next-line no-new-func
  return new Function('const MEM={};\n' + pieces.join('\n') + '\nreturn {buildNextFix,xP,pointsDist};')();
}

/* Index the bootstrap the way boot() does, minimally. */
function indexBoot(boot) {
  const teams = {}, els = {};
  (boot.teams || []).forEach((t) => { teams[t.id] = t; });
  (boot.elements || []).forEach((e) => { els[e.id] = e; });
  const upcoming = (boot.events || []).find((e) => !e.finished) || null;
  const cur = (boot.events || []).find((e) => e.is_current)
    || (boot.events || []).find((e) => e.is_next)
    || (boot.events || [])[(boot.events || []).length - 1] || null;
  return { raw: boot, teams, els, elements: boot.elements || [], events: boot.events || [], upcoming, cur };
}

/* The season label, derived from the earliest gameweek deadline. FPL
   renumbers gameweeks from 1 each August, so predictions MUST carry the
   season or the new campaign's GW1 would overwrite last season's GW1 rows.
   A season that kicks off in August of year Y is labelled "Y/Y+1". */
function seasonLabel(boot) {
  const evs = (boot && boot.events) || [];
  let ms = Infinity;
  for (const e of evs) { const t = Date.parse(e.deadline_time); if (Number.isFinite(t) && t < ms) ms = t; }
  if (!Number.isFinite(ms)) return 'unknown';
  const y = new Date(ms).getUTCFullYear();
  return y + '/' + String((y + 1) % 100).padStart(2, '0');
}

/* Pure core: given the app source + live data, produce the prediction
   rows for the upcoming gameweek. No network, no database — unit-tested. */
function computePredictions(html, boot, fixtures) {
  const M = buildModel(html);
  const b = indexBoot(boot);
  const gw = b.upcoming ? b.upcoming.id : null;
  const deadline = b.upcoming ? b.upcoming.deadline_time : null;
  const season = seasonLabel(boot);
  if (!gw) return { gw: null, deadline: null, season, rows: [] };
  const nf = M.buildNextFix(b, fixtures);
  const rows = [];
  for (const el of b.elements) {
    const f = nf[el.team];
    if (!f || f.event !== gw) continue;                 // only players with a fixture this GW
    const xp = M.xP(b, el, f);
    if (!(xp > 0)) continue;
    const d = M.pointsDist(el, f);
    rows.push({ season, gw, element: el.id,
      xp: Math.round(xp * 100) / 100,
      haul_prob: Math.round(d.haul * 1000) / 1000,
      blank_prob: Math.round(d.blank * 1000) / 1000 });
  }
  return { gw, deadline, season, rows };
}

/* Locate index.html (shipped alongside the function via included_files). */
function readIndexHtml() {
  const candidates = [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, '..', '..', 'index.html'),
    path.join(process.cwd(), 'index.html'),
  ];
  for (const p of candidates) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { /* next */ } }
  return null;
}
const fplGet = (p) => fetch('https://fantasy.premierleague.com/api/' + p, { headers: { 'User-Agent': UA, Accept: 'application/json' } }).then((r) => r.json());

exports.config = { schedule: '@hourly' };

exports.handler = async () => {
  const supaUrl = process.env.SUPABASE_URL, supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return { statusCode: 200, body: 'not configured' };
  const html = readIndexHtml();
  if (!html) return { statusCode: 200, body: 'index.html not bundled' };

  let boot, fixtures;
  try { [boot, fixtures] = await Promise.all([fplGet('bootstrap-static/'), fplGet('fixtures/')]); }
  catch (_) { return { statusCode: 200, body: 'fpl unavailable' }; }

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  let logged = 0, graded = 0;

  /* 1) Log the upcoming gameweek's predictions, but only while the
        deadline is still ahead (freeze once the GW locks). */
  const season = seasonLabel(boot);
  try {
    const { gw, deadline, rows } = computePredictions(html, boot, fixtures);
    if (gw && deadline && Date.now() < new Date(deadline).getTime() && rows.length) {
      for (let i = 0; i < rows.length; i += 500) {
        await sb.from('gwedge_predictions').upsert(rows.slice(i, i + 500), { onConflict: 'season,gw,element' });
      }
      logged = rows.length;
    }
  } catch (e) { /* leave logged at 0 */ }

  /* 2) Backfill actuals for this season's finished gameweeks still missing
        them. Scoped to the current season so last season's rows (same gw
        numbers) are never touched. */
  try {
    const finishedGws = (boot.events || []).filter((e) => e.finished).map((e) => e.id);
    const { data: pending } = await sb.from('gwedge_predictions')
      .select('gw').eq('season', season).is('actual', null).in('gw', finishedGws);
    const toGrade = [...new Set((pending || []).map((r) => r.gw))].sort((a, c) => c - a).slice(0, 3);
    for (const gw of toGrade) {
      let live; try { live = await fplGet('event/' + gw + '/live/'); } catch (_) { continue; }
      const pts = {}; (live.elements || []).forEach((e) => { pts[e.id] = e.stats ? e.stats.total_points : null; });
      const { data: preds } = await sb.from('gwedge_predictions').select('element').eq('season', season).eq('gw', gw).is('actual', null);
      for (const p of preds || []) {
        if (pts[p.element] == null) continue;
        await sb.from('gwedge_predictions').update({ actual: pts[p.element] }).eq('season', season).eq('gw', gw).eq('element', p.element);
        graded++;
      }
    }
  } catch (e) { /* leave graded at 0 */ }

  return { statusCode: 200, body: JSON.stringify({ logged, graded }) };
};

module.exports.computePredictions = computePredictions;
module.exports.buildModel = buildModel;
module.exports.seasonLabel = seasonLabel;
