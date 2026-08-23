/* Gameweek Edge — enrichment endpoint (Netlify Function)
   GET /api/enrich?gameweek=1&players=1,2,3&news=1&recommendations=0

   READ-ONLY. This endpoint fetches and combines external data. It makes no
   transfer, no team change, no purchase and no post anywhere — there is no
   write path in this file or anything it imports.

   It returns 200 with a partial result whenever a non-core provider fails:
   the failure is named in data_quality rather than crashing the dashboard.
   The single 503 case is the authoritative FPL source being unavailable,
   because then there is nothing to enrich.
*/
const { buildFplEnrichment } = require('../lib/enrichment');

const json = (code, body) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' },
  body: JSON.stringify(body)
});

const idList = (raw) => String(raw || '')
  .split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);

const truthy = (v, dflt) => {
  if (v === undefined || v === null || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET only.' });

  const q = event.queryStringParameters || {};
  const gw = parseInt(q.gameweek, 10);

  try {
    const out = await buildFplEnrichment({
      fplPlayerIds: idList(q.players).length ? idList(q.players) : null,
      teamIds: idList(q.teams).length ? idList(q.teams) : null,
      gameweek: Number.isFinite(gw) ? gw : null,
      includeNews: truthy(q.news, true),
      includeRecommendations: truthy(q.recommendations, false)
    });
    return json(200, out);
  } catch (err) {
    if (err && err.code === 'CORE_UNAVAILABLE') {
      return json(503, {
        error: 'The official FPL source is unavailable, so no enrichment could be built.',
        data_quality: err.dataQuality || null
      });
    }
    console.error('enrich: unexpected failure —', (err && err.message) || err);
    return json(500, { error: 'Enrichment failed unexpectedly.' });
  }
};
