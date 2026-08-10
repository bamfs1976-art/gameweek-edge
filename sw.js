/* Gameweek Edge — service worker (PWA)
   Precaches the app shell so it launches offline, and serves static
   assets cache-first. Live game data (/api/*) is never touched here —
   the app's own data layer decides what is fresh vs cached.

   THREE apps share this origin and therefore this service worker: Gameweek
   Edge at /, Euro Matchday Edge at /euro/ and Fantasy EFL at
   /fantasy-efl/. That has two consequences this file has to get right,
   because the worker's scope is the whole origin whether it wants it or
   not:

   1. The offline fallback must serve the shell of the app you asked for.
      Falling back to /index.html for a /euro/ navigation would put the
      wrong app on screen — which reads as a bug, not as being offline.
      Fantasy EFL is five separate pages rather than one shell, so its
      fallback is its own landing page: still the right app, and the tab
      strip on it gets you to the page you wanted once you are back online.
   2. /euro/engine.js is not a static asset; it is the model, rebuilt on
      every deploy. Cache-first would pin an old model in front of users
      who already have the worker installed, silently undoing the whole
      point of extracting the engine from one source of truth. Fantasy
      EFL's modules are the same kind of thing for the same reason. */

const VERSION = 'ge-v7';
const EURO = '/euro/';
const EFL = '/fantasy-efl/';
/* Fantasy EFL's five routes and the modules behind them. Listed here rather
   than derived, because addAll() rejects the whole install if a single URL
   404s — an explicit list fails loudly in dev instead of quietly on a
   user's phone. */
const EFL_SHELL = [
  '/fantasy-efl/',
  '/fantasy-efl/fixtures/',
  '/fantasy-efl/players/',
  '/fantasy-efl/clubs/',
  '/fantasy-efl/how-to-play/',
  '/fantasy-efl/assets/efl.css',
  '/fantasy-efl/assets/ui.js',
  '/fantasy-efl/assets/model.js',
  '/fantasy-efl/assets/provider.js',
  '/fantasy-efl/assets/sample-data.js',
  '/fantasy-efl/assets/page-home.js',
  '/fantasy-efl/assets/page-fixtures.js',
  '/fantasy-efl/assets/page-players.js',
  '/fantasy-efl/assets/page-clubs.js',
  '/fantasy-efl/assets/page-guide.js'
];
const SHELL = [
  '/',
  '/index.html',
  '/native.js',
  '/auth.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  /* Euro Matchday Edge's own shell, so it launches offline too. */
  '/euro/',
  '/euro/index.html',
  '/euro/engine.js',
  '/euro/manifest.webmanifest',
  ...EFL_SHELL
];
/* Code, not assets: always revalidated so a deploy reaches all three apps. */
const CODE = new Set(['/', '/index.html', '/native.js', '/auth.js', '/manifest.webmanifest',
  '/euro/', '/euro/index.html', '/euro/engine.js', '/euro/manifest.webmanifest',
  ...EFL_SHELL]);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Web Push: show the notification, and focus/route the app on click. */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title || 'Gameweek Edge', {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: d.tag || 'ge',
    data: { url: d.url || '/' }
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cls) => {
    for (const c of cls) { if ('focus' in c) { try { c.navigate(url); } catch (_) {} return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* Never intercept the API — freshness is the data layer's job. */
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  /* The page/app shell and every file that IS the app: network-first, so a
     deploy reaches both apps immediately, falling back to cache offline. */
  const isShell = req.mode === 'navigate' || CODE.has(url.pathname);

  if (isShell) {
    /* Offline, fall back to the shell of the app that was actually asked
       for — /euro/ must never resolve to Gameweek Edge's page. */
    const fallback = url.pathname.startsWith(EURO) ? '/euro/index.html'
      : url.pathname.startsWith(EFL) ? '/fantasy-efl/'
        : '/index.html';
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match(fallback)))
    );
    return;
  }

  /* Other static assets (icons): cache-first, then network. */
  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
    )
  );
});

