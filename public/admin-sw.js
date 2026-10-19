const CACHE_NAME = 'playbar-admin-v1';
const ADMIN_ASSETS = [
  '/admin-manifest.json',
  '/css/admin.css',
  '/js/admin.js',
  '/images/icone.png',
  '/images/playbar-logo.webp'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ADMIN_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('playbar-admin-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isAdminAsset =
    url.origin === self.location.origin &&
    (
      url.pathname === '/admin-manifest.json' ||
      url.pathname.startsWith('/css/admin.css') ||
      url.pathname.startsWith('/js/admin.js') ||
      url.pathname.startsWith('/images/')
    );

  if (!isAdminAsset) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request))
  );
});
