/**
 * Gameweek Edge — FPL API proxy
 * Whitelisted server-side proxy to the official Fantasy Premier League API.
 *
 * The FPL API does not allow direct browser calls. Every client request is
 * routed through this function so we can:
 *   - apply allow-listing on the endpoint path (no open relay)
 *   - set sensible CDN cache headers per endpoint
 *   - keep client code clean (single base URL)
 *
 * Calling pattern from the browser:
 *   fetch('/.netlify/functions/fpl?path=bootstrap-static/')
 *   fetch('/api/entry/56787/')   (via netlify.toml redirect)
 */

const FPL_BASE = 'https://fantasy.premierleague.com/api';

// Each entry: regex matching an allowed path, CDN cache TTL, stale-while-revalidate window.
// Live matchday data has the shortest TTL; bootstrap-static (squad lists, teams, fixtures
// pool) is large but changes only once a day so it gets the longest TTL.
const ALLOWED = [
  { re: /^bootstrap-static\/?$/,                           maxAge: 21600, swr: 86400 }, // 6h / 24h
  { re: /^fixtures\/?$/,                                   maxAge:  600,  swr: 1800 },  // 10m / 30m
  { re: /^fixtures\/\?event=\d+$/,                         maxAge:  120,  swr:  600 },  // 2m / 10m
  { re: /^entry\/\d+\/?$/,                                 maxAge:  180,  swr:  600 },  // 3m / 10m
  { re: /^entry\/\d+\/history\/?$/,                        maxAge:  180,  swr:  600 },  // 3m / 10m
  { re: /^entry\/\d+\/event\/\d+\/picks\/?$/,              maxAge:  120,  swr:  600 },  // 2m / 10m
  { re: /^entry\/\d+\/transfers\/?$/,                      maxAge:  300,  swr:  900 },  // 5m / 15m
  { re: /^event\/\d+\/live\/?$/,                           maxAge:   30,  swr:   60 },  // 30s / 60s
  { re: /^element-summary\/\d+\/?$/,                       maxAge:  600,  swr: 1800 },  // 10m / 30m
];

// Allow-listed paths are short and structured. Reject anything that looks like
// a traversal attempt, a protocol probe, or contains unexpected characters.
const SAFE_CHARS = /^[A-Za-z0-9/_\-?=&]+$/;

function jsonResponse(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
      extraHeaders || {}
    ),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

exports.handler = async function (event) {
  if (event.httpMethod && event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const raw = (event.queryStringParameters && event.queryStringParameters.path) || '';
  const path = raw.replace(/^\/+/, '').trim();

  if (!path) {
    return jsonResponse(400, { error: 'Missing path parameter' });
  }
  if (!SAFE_CHARS.test(path) || path.includes('..')) {
    return jsonResponse(400, { error: 'Path contains disallowed characters' });
  }

  const rule = ALLOWED.find(function (r) { return r.re.test(path); });
  if (!rule) {
    return jsonResponse(403, { error: 'Endpoint not allowed', path: path });
  }

  // Normalise: FPL endpoints expect a trailing slash before any query string.
  let normalised = path;
  const qIdx = normalised.indexOf('?');
  if (qIdx === -1 && !normalised.endsWith('/')) normalised += '/';

  const url = FPL_BASE + '/' + normalised;

  try {
    const upstream = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'GameweekEdge/0.2 (https://gameweek-edge.netlify.app sports-analytics)',
      },
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      return jsonResponse(upstream.status, {
        error: 'FPL API returned ' + upstream.status,
        status: upstream.status,
        path: path,
      });
    }

    return jsonResponse(200, text, {
      'Cache-Control': 'public, max-age=' + rule.maxAge +
        ', s-maxage=' + rule.maxAge +
        ', stale-while-revalidate=' + rule.swr,
      'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=' + rule.maxAge +
        ', stale-while-revalidate=' + rule.swr,
    });
  } catch (err) {
    return jsonResponse(502, {
      error: 'Upstream fetch failed',
      message: err && err.message ? err.message : 'Unknown error',
      path: path,
    });
  }
};
