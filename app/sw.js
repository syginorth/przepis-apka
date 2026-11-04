'use strict';
// Podnieś numer przy każdej zmianie plików aplikacji.
const CACHE = 'przepisy-mamy-v10';
const FILES = ['./', './index.html', './style.css', './config.js', './vendor/supabase-2.118.0.js', './core.js', './store.js', './sync.js', './cloud.js', './views.js', './app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('przepisy-mamy-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

// Pliki aplikacji z pamięci (działa offline); zapytania do Supabase idą zawsze do sieci.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cached => cached || fetch(event.request).catch(() =>
      event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
  );
});
