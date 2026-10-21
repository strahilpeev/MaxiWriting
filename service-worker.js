const CACHE_NAME = 'uchebni-igri-v14';
const APP_SHELL = [
  './',
  './index.html',
  './app.html',
  './manifest.json',
  './srichki-razmer.html',
  './matematika_sbor_login_preminavane.html',
  './matematika_izvazhdane_login_zaemane.html',
  './bulgarian-typing-login.html',
  './firebase-shared.js',
  './maxi-common.js',
  './maxi-common.css',
  './chetene.html',
  './chisla-i-pari.html',
  './vnimanie.html',
  './govorya.html',
  './dvizhenie.html',
  './icons/icon-96.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

// При инсталация кешираме цялото приложение, за да работи и офлайн.
// cache: reload/no-cache = винаги взимаме най-новия файл от сървъра, не стар от кеша на браузъра.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// При активация чистим стари версии на кеша
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Стратегия: cache-first, с обновяване във фонов режим (stale-while-revalidate)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      // навигациите не позволяват промяна на заявката, затова ги правим наново по URL
      let fresh = event.request;
      try {
        fresh = event.request.mode === 'navigate'
          ? new Request(event.request.url, { cache: 'no-cache' })
          : new Request(event.request, { cache: 'no-cache' });
      } catch (e) { /* оставяме оригиналната заявка */ }
      const fetchPromise = fetch(fresh).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
