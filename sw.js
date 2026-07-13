/* Gameweek Edge — service worker (PWA)
   Precaches the app shell so it launches offline, and serves static
   assets cache-first. Live FPL data (/api/fpl/*) is never touched here —
   the app's own data layer decides what is fresh vs cached. */

const VERSION = 'ge-v5';
const SHELL = [
  '/',
  '/index.html',
  '/native.js',
  '/auth.js',
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

  /* The page/app shell: network-first so deploys reach the app
     immediately, falling back to cache when offline. */
  const isShell = req.mode === 'navigate' ||
    url.pathname === '/' || url.pathname === '/index.html' ||
    url.pathname === '/native.js' || url.pathname === '/auth.js' ||
    url.pathname === '/manifest.webmanifest';

  if (isShell) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html')))
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

