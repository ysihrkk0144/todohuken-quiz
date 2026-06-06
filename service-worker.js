const CACHE_NAME = 'todohuken-quiz-v2';
const ASSETS = [
  './todohukenquiz.html',
  './manifest.json',
  './service-worker.js',
  './japan.topojson'
];

// インストール時：全ファイルをキャッシュ
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 古いキャッシュを削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// キャッシュ優先で返す（オフライン対応）
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // 成功したレスポンスはキャッシュに追加
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // オフラインでキャッシュもない場合
      return new Response('オフラインです。先にオンラインで一度アクセスしてください。',
        { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })
  );
});
