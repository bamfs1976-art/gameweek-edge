/* Gameweek Edge — image proxy for canvas rendering.

   The Social Studio draws club crests and player photos onto a canvas and
   then calls toBlob() to produce a PNG. Drawing a cross-origin image taints
   the canvas and makes toBlob() throw a SecurityError, and whether the
   Premier League CDN sends the CORS header needed to avoid that is outside
   our control. Serving the bytes from our own origin sidesteps the problem
   entirely: a same-origin image never taints.

   In-app <img> tags still hit the CDN directly — tainting only matters for
   canvas readback, so the proxy is used by the card renderer alone.

   This is deliberately NOT a general-purpose proxy: the host allowlist below
   is the whole point, so it cannot be turned into an open relay. Responses
   are cached hard at the edge because crests and photos effectively never
   change within a season. */

const ALLOWED_HOSTS = ['resources.premierleague.com'];
const MAX_BYTES = 2 * 1024 * 1024;

const fail = (code, msg) => ({
  statusCode: code,
  headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=300' },
  body: msg,
});

exports.handler = async (event) => {
  const raw = (event.queryStringParameters || {}).u;
  if (!raw) return fail(400, 'missing u');

  let url;
  try { url = new URL(raw); } catch (_) { return fail(400, 'bad url'); }
  if (url.protocol !== 'https:') return fail(400, 'https only');
  if (!ALLOWED_HOSTS.includes(url.hostname)) return fail(403, 'host not allowed');

  let res;
  try {
    res = await fetch(url.toString(), { headers: { Accept: 'image/*' } });
  } catch (_) {
    return fail(502, 'upstream fetch failed');
  }
  /* A missing crest or photo is normal (new signings, promoted clubs), so a
     404 comes back as a 404 and the card falls back to its colour tile. */
  if (!res.ok) return fail(res.status === 404 ? 404 : 502, 'upstream ' + res.status);

  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return fail(415, 'not an image');

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) return fail(413, 'image too large');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=604800, stale-while-revalidate=2592000',
    },
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
};
