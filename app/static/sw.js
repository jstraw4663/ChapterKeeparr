const CACHE = 'chapterkeeparr-shell-v9';
// Keep in sync with app/static (tests/test_frontend.py checks this list).
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/static/icon-180.png',
  '/static/icon-192.png',
  '/static/icon-512.png',
  '/static/icon.svg',
  '/static/js/api.js',
  '/static/js/audio.js',
  '/static/js/books.js',
  '/static/js/covers.js',
  '/static/js/events.js',
  '/static/js/format.js',
  '/static/js/history.js',
  '/static/js/icons.js',
  '/static/js/main.js',
  '/static/js/morph.js',
  '/static/js/notify.js',
  '/static/js/overlay.js',
  '/static/js/player.js',
  '/static/js/prefs.js',
  '/static/js/router.js',
  '/static/js/screens/book.js',
  '/static/js/screens/common.js',
  '/static/js/screens/evidence.js',
  '/static/js/screens/library.js',
  '/static/js/screens/newjob.js',
  '/static/js/screens/queue.js',
  '/static/js/screens/review.js',
  '/static/js/screens/settings.js',
  '/static/js/screens/suggestions.js',
  '/static/js/search.js',
  '/static/js/shell.js',
  '/static/js/status.js',
  '/static/js/store.js',
  '/static/js/ui.js',
  '/static/styles.css',
  '/static/tokens.css',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('chapterkeeparr-shell-') && key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }
  if (SHELL.includes(url.pathname)) event.respondWith(fetch(request).then(async response => {
    if (response.ok) {
      const copy = response.clone();
      const cache = await caches.open(CACHE);
      await cache.put(request, copy);
    }
    return response;
  }).catch(() => caches.match(request)));
});
