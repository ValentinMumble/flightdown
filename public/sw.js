/*
 * Flightdown's service worker: the app opens at the field with no signal. Pages come from the network first (a new
 * version shows as soon as it is out) and from the last copy when offline; built files, whose names change with each
 * version, come from the copy first. The log's data is not kept here: the app keeps it and its waiting changes itself.
 */
const SHELL = 'flightdown-shell-v1';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(names => Promise.all(names.filter(name => name !== SHELL).map(name => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(SHELL).then(cache => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        found =>
          found ??
          fetch(request).then(response => {
            const copy = response.clone();
            caches.open(SHELL).then(cache => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});
