/* PigeonMesh service worker.
 *
 * A caveat worth stating plainly: this only registers in a secure context.
 * A mesh node serves over plain http, because there is no certificate
 * authority to reach when the internet is down and no domain to validate
 * pigeon.mesh against. So on a real deployment this file usually never runs.
 *
 * It is here anyway because it costs 2 KB and it does run in the two places
 * that matter: when a node is reached over https (some deployments put a
 * self-signed certificate on uhttpd and pre-install the CA on volunteers'
 * phones), and during development on localhost. When it does run, the app
 * opens with no node in range at all -- which is the difference between a
 * phone that shows a dinosaur and a phone that still shows you the shelter
 * map and everything it is carrying.
 *
 * Strategy:
 *   app shell   cache-first, revalidated in the background
 *   /api/*      network-only, never cached (stale mesh state is dangerous)
 */

// Bump on every shell change. The shell is served cache-first, so a stale
// version here is a phone running last week's app.
const VERSION = 'pigeonmesh-v2';
const SHELL = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'crypto.js',
  'i18n.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // Individual misses must not fail the whole install: an icon that is
      // absent should not cost the user their offline app shell.
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
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
  if (url.origin !== location.origin) return;

  // Never serve mesh state from cache. A cached "no active alerts" shown
  // during a live emergency would be worse than an error.
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit || caches.match('index.html'));

      return hit || net;
    })
  );
});
