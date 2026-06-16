const CACHE_NAME = 'kenquiz-v3';

// インストール時：個別にキャッシュ（1つ失敗しても他は保存する）
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // addAll だと1つ失敗で全滅するため、個別にadd
      const urls = [
        './index.html',
        './manifest.json',
        './japan.topojson',
        './icon.svg'
        // service-worker.js 自体はブラウザが管理するためリスト不要
      ];
      return Promise.allSettled(
        urls.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] キャッシュ失敗:', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// アクティベート時：古いキャッシュを削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] 古いキャッシュ削除:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// フェッチ：キャッシュ優先、なければネット、両方ダメならオフラインページ
self.addEventListener('fetch', event => {
  // GETリクエスト以外は無視
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        console.log('[SW] キャッシュから返却:', event.request.url);
        return cached;
      }

      // キャッシュにない場合はネットワークから取得してキャッシュに保存
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone);
            console.log('[SW] 新規キャッシュ保存:', event.request.url);
          });
        }
        return response;
      }).catch(() => {
        // オフラインで未キャッシュのリソースへのアクセス
        console.warn('[SW] オフライン、未キャッシュ:', event.request.url);
        // HTMLリクエストならindex.htmlのキャッシュを返す
        if (event.request.headers.get('accept') &&
            event.request.headers.get('accept').includes('text/html')) {
          return caches.match('./index.html');
        }
        return new Response('', { status: 503 });
      });
    })
  );
});
