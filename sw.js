/* Gameweek Edge — service worker (PWA)
   Precaches the app shell so it launches offline, and serves static
   assets cache-first. Live FPL data (/api/fpl/*) is never touched here —
   the app's own data layer decides what is fresh vs cached. */

const VERSION = 'ge-v1';
const SHELL = [
  '/',
  '/index.html',
  '/native.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* Never intercept the API — freshness is the data layer's job. */
  if (url.pathname.startsWith('/api/')) return;

  /* Same-origin static: cache-first, then network (and cache the result).
     Navigations fall back to the cached shell when offline. */
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then((hit) =>
        hit || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        }).catch(() => req.mode === 'navigate' ? caches.match('/index.html') : undefined)
      )
    );
  }
});
