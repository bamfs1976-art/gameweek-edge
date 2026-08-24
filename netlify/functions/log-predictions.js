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
    /* plsimPrior consults an Elo-derived prior for clubs with no offline fit.
       The logger now supplies the same Elo map the client does, so promoted
       clubs are graded on the prior the app actually shows them. */
    ...['ELO_SCALE', 'ELO_ATT', 'ELO_DEF', 'ELO_CLAMP']
      .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
    grabFn(html, 'eloMean'), grabFn(html, 'eloPrior'),
    grabFn(html, 'plsimPrior'), grabFn(html, 'plsimMatch'),
    grabFn(html, 'recencyWeight'), grabFn(html, 'availAttackMult'), grabFn(html, 'plsimRatings'),
    grabFn(html, 'plsimDiff'), grabFn(html, 'teamShort'),
    /* Fixture congestion: buildNextFix scores it onto each fixture and
       minutesModel discounts a start for it. The logger now supplies the same
       European calendar the client does, so a club playing Thursday is graded
       with the rotation discount the app shows rather than without it. */
    ...['CONGEST_FULL', 'CONGEST_FADE', 'CONGEST_MAX', 'CONGEST_NAILED', 'CONGEST_TO_BENCH']
      .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
    grabFn(html, 'euroIndex'), grabFn(html, 'congestionLoad'), grabFn(html, 'congestionFactor'),
    /* The shared "still to be played" rule both fixture builders filter
       through — a match at full time waiting on bonus is not upcoming. */
    grabFn(html, 'fixtureOver'), grabFn(html, 'fixtureToCome'),
    grabFn(html, 'buildNextFix'), grabFn(html, 'buildGwFixtures'),
    grabFn(html, 'minutesModel'), grabFn(html, 'concedePts'), grabFn(html, 'savePts'),
    grabFn(html, 'dcHitProb'), grabFn(html, 'effGoalRate'), grabFn(html, 'negRate90'),
    grabFn(html, 'nativeXP'), grabFn(html, 'xP'), grabFn(html, 'fixtureXP'), grabFn(html, 'pointsDist'),
  ];
  // eslint-disable-next-line no-new-func
  return new Function('const MEM={};\n'
    /* The points table. nativeXP and pointsDist used to restate it inline as
       `type<=2?6:...`; they now read SCORING, so the logger has to supply the
       same binding the app does or it throws on the first projection. It gets
       the fallback rather than a derived table: this logger is handed a
       bootstrap by its caller and grades the model, not the game's config, so
       a constant here keeps every logged prediction on one known ruleset. */
    + [...['SCORING_FALLBACK'].map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
       'let SCORING = SCORING_FALLBACK;'].join('\n') + '\n'
    + pieces.join('\n')
    + '\nreturn {buildNextFix,buildGwFixtures,euroIndex,xP,fixtureXP,pointsDist};')();
}

/* Index the bootstrap the way boot() does, minimally. `elo` and `euroFeed`
   are the same two side inputs the client attaches (idx.elo / idx.euro): the
   match model reads b.elo for clubs with no fitted prior, and buildNextFix
   reads b.euro for midweek European load. Omitting them was silently grading
   a different model than the one that ships — promoted clubs on the generic
   prior, and every club in Europe with no congestion discount. Both stay
   optional, so a failed fetch degrades to the old behaviour rather than
   blocking the run. */
function indexBoot(boot, elo, euro) {
  const teams = {}, els = {};
  (boot.teams || []).forEach((t) => { teams[t.id] = t; });
  (boot.elements || []).forEach((e) => { els[e.id] = e; });
  const upcoming = (boot.events || []).find((e) => !e.finished) || null;
  const cur = (boot.events || []).find((e) => e.is_current)
    || (boot.events || []).find((e) => e.is_next)
    || (boot.events || [])[(boot.events || []).length - 1] || null;
  const b = { raw: boot, teams, els, elements: boot.elements || [], events: boot.events || [], upcoming, cur };
  if (elo && Object.keys(elo).length) b.elo = elo;
  if (euro && Object.keys(euro).length) b.euro = euro;
  return b;
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
   rows for the upcoming gameweek. No network, no database — unit-tested.
   `elo` and `euroFeed` are optional and mirror the client. */
function computePredictions(html, boot, fixtures, elo, euroFeed) {
  const M = buildModel(html);
  const euro = euroFeed && euroFeed.rows && euroFeed.rows.length ? M.euroIndex(euroFeed) : null;
  const b = indexBoot(boot, elo, euro);
  const gw = b.upcoming ? b.upcoming.id : null;
  const deadline = b.upcoming ? b.upcoming.deadline_time : null;
  const season = seasonLabel(boot);
  if (!gw) return { gw: null, deadline: null, season, rows: [] };
  const nf = M.buildNextFix(b, fixtures);
  /* buildNextFix keeps only a team's NEXT fixture, but the actual we grade
     against is the whole gameweek. On a double that compares one match to
     two and books a large phantom under-forecast. Take the extra legs from
     buildGwFixtures — the same per-gameweek view the multi-week solver uses
     — and add them on the same per-fixture basis. A single gameweek is
     therefore byte-identical to before, so the logged series stays
     continuous. */
  const gwFx = M.buildGwFixtures(b, fixtures, [gw]);
  const rows = [];
  for (const el of b.elements) {
    const f = nf[el.team];
    if (!f || f.event !== gw) continue;                 // only players with a fixture this GW
    const legs = (gwFx[el.team] || {})[gw] || [];
    let xp = M.xP(b, el, f);
    if (!(xp > 0)) continue;
    for (let i = 1; i < legs.length; i++) xp += M.fixtureXP(b, el, legs[i]);
    /* A haul probability is not additive across matches, and the model does
       not simulate a two-match gameweek — so on a double it is left null
       rather than logged as a single-match number the grader would then
       score as if it covered both. xP is additive, so it is not. */
    const dbl = legs.length > 1;
    const d = dbl ? null : M.pointsDist(el, f);
    rows.push({ season, gw, element: el.id,
      fixtures: Math.max(1, legs.length),
      xp: Math.round(xp * 100) / 100,
      haul_prob: d ? Math.round(d.haul * 1000) / 1000 : null,
      blank_prob: d ? Math.round(d.blank * 1000) / 1000 : null });
  }
  return { gw, deadline, season, rows };
}

/* Schema changes in this project are a manual step in the Supabase SQL editor
   (see supabase/gwedge_predictions.sql), so a deploy can land before the
   migration does. `fixtures` is the newest column; if it is not there yet,
   write the rows without it rather than losing the gameweek entirely — the
   only cost is that doubles are not marked until the migration runs. Every
   other feature in this app degrades this way rather than failing shut. */
async function upsertPredictions(sb, rows) {
  const r = await sb.from('gwedge_predictions').upsert(rows, { onConflict: 'season,gw,element' });
  if (!r || !r.error) return r;
  const msg = String((r.error && r.error.message) || '');
  if (!/fixtures/i.test(msg)) return r;
  const trimmed = rows.map(({ fixtures, ...rest }) => rest);
  return sb.from('gwedge_predictions').upsert(trimmed, { onConflict: 'season,gw,element' });
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

  /* The two side inputs the client attaches to its bootstrap. Invoked
     in-process rather than over HTTP (same deploy, no round trip), and each
     is best-effort: without them the model still runs, it just runs the way
     it did before these data sources existed — which is exactly the drift
     this is here to stop.
     The requires are static string literals because esbuild traces the
     bundle statically: a computed module path would not be bundled and
     would throw at runtime in production, having passed every local test. */
  const sideInput = async (handler, event) => {
    try {
      const r = await handler(event || {});
      return r && r.statusCode === 200 ? JSON.parse(r.body) : null;
    } catch (_) { return null; }
  };
  const upcomingId = ((boot.events || []).find((e) => !e.finished) || {}).id || 1;
  const [eloRes, euroRes] = await Promise.all([
    sideInput(require('./team-elo.js').handler),
    sideInput(require('./euro-fixtures.js').handler,
      { queryStringParameters: { from: String(Math.max(1, upcomingId - 1)), n: '3' } }),
  ]);
  const elo = (eloRes && eloRes.elo) || null;

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  let logged = 0, graded = 0;

  /* 1) Log the upcoming gameweek's predictions, but only while the
        deadline is still ahead (freeze once the GW locks). */
  const season = seasonLabel(boot);
  try {
    const { gw, deadline, rows } = computePredictions(html, boot, fixtures, elo, euroRes);
    if (gw && deadline && Date.now() < new Date(deadline).getTime() && rows.length) {
      for (let i = 0; i < rows.length; i += 500) {
        await upsertPredictions(sb, rows.slice(i, i + 500));
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
      /* Fill in the actuals in batches rather than one round trip per player
         (a full gameweek is 500-plus otherwise). Grouped by score and applied
         with UPDATE ... IN: an FPL return spans maybe thirty distinct values,
         so this is a couple of dozen calls. Deliberately not an upsert — that
         would replace the whole row, so every prediction column would have to
         be read back and echoed, and any column this function did not know
         about would be reset to its default. Filling one column in place
         cannot do that. */
      const { data: preds } = await sb.from('gwedge_predictions')
        .select('element').eq('season', season).eq('gw', gw).is('actual', null);
      const byScore = new Map();
      for (const p of preds || []) {
        const v = pts[p.element];
        if (v == null) continue;
        if (!byScore.has(v)) byScore.set(v, []);
        byScore.get(v).push(p.element);
      }
      for (const [actual, ids] of byScore) {
        for (let i = 0; i < ids.length; i += 500) {
          await sb.from('gwedge_predictions').update({ actual })
            .eq('season', season).eq('gw', gw).in('element', ids.slice(i, i + 500));
        }
        graded += ids.length;
      }
    }
  } catch (e) { /* leave graded at 0 */ }

  return { statusCode: 200, body: JSON.stringify({ logged, graded }) };
};

module.exports.computePredictions = computePredictions;
module.exports.buildModel = buildModel;
module.exports.seasonLabel = seasonLabel;
