const CACHE_VERSION = 'v1';
const CORE_CACHE = `wally-core-${CACHE_VERSION}`;
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './main.js',
  './config.json',
  './color.js',
  './debug.js',
  './db.js',
  './detector.worker.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CORE_CACHE).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (CORE_ASSETS.some((asset) => url.pathname.endsWith(asset.replace('./', '/')))) {
      event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
      return;
    }
    if (url.pathname.includes('/models/') || url.pathname.includes('/banks/') || url.pathname.includes('/tflite/')) {
      event.respondWith(cacheFirst(request));
      return;
    }
  }
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});

async function cacheFirst(request) {
  const cache = await caches.open(CORE_CACHE);
  const match = await cache.match(request);
  if (match) return match;
  const response = await fetch(request);
  cache.put(request, response.clone());
  return response;
}
