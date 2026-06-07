// キャッシュを全削除して古いService Workerを無効化する
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// キャッシュを使わず毎回ネットワークから取得
self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});
