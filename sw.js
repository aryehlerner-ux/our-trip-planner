const CACHE_NAME = 'trip-planner-v16';
const ASSETS = [
  './',
  './index.html',
  './app.js?v=16',
  './style.css?v=16',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './hebcal-bundle.js?v=16',
  './country-data.js?v=16'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // IMPORTANT: cache.addAll() uses a normal fetch() under the hood, which
      // respects the browser's regular HTTP cache. That let some files (e.g.
      // style.css) get silently frozen into a NEW cache in a STALE state while
      // other files (e.g. app.js) updated — a mismatched set of files, which is
      // exactly what caused "the version number updated but nothing else did."
      // { cache: 'reload' } forces every single asset to be re-fetched from the
      // network for real, every time, so a version bump always ships a fully
      // matched set of files together.
      Promise.all(ASSETS.map((url) =>
        fetch(url, { cache: 'reload' }).then((resp) => cache.put(url, resp))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
