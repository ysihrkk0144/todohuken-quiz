// ============================================================
// 都道府県クイズ - Service Worker
// 方針：Cache Only（オフライン完全優先）。自動更新は一切行わない。
// 更新はページ側の「最新版を確認」ボタンからのみ開始される。
// ============================================================

const CACHE_NAME = 'kenquiz-cache-v2';

// キャッシュ対象（service-worker.js自体は含めない）
const ASSETS = [
  './index.html',
  './manifest.json',
  './japan.topojson',
  './icon.svg'
];

const EXPECTED_COUNT = ASSETS.length;
const MAX_RETRY = 3;

// ---- ユーティリティ：完全URL化 ----
function toFullUrl(path) {
  return new URL(path, self.location).href;
}

// ---- ユーティリティ：リトライ付きキャッシュ追加 ----
async function cacheWithRetry(cache, path, maxRetry) {
  const fullUrl = toFullUrl(path);
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    try {
      // 奇数回目はno-store、偶数回目はデフォルト（no-storeがモバイルで
      // 不安定な場合のフォールバックとして交互に試す）
      const fetchOptions = (attempt % 2 === 1) ? { cache: 'no-store' } : {};
      const response = await fetch(fullUrl, fetchOptions);
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }
      await cache.put(fullUrl, response);
      return { path: path, ok: true, attempt: attempt };
    } catch (err) {
      lastError = err;
      console.warn('[SW] キャッシュ取得失敗(' + attempt + '/' + maxRetry + '回目): ' + path, err);
    }
  }
  return { path: path, ok: false, error: lastError ? (lastError.message || String(lastError)) : 'unknown', attempt: maxRetry };
}

// ---- 全クライアントへ通知 ----
async function notifyAllClients(message) {
  const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  clientsList.forEach(function (client) {
    client.postMessage(message);
  });
}

// ============================================================
// install イベント
// ============================================================
self.addEventListener('install', function (event) {
  event.waitUntil(
    (async function () {
      const cache = await caches.open(CACHE_NAME);

      const results = await Promise.allSettled(
        ASSETS.map(function (path) {
          return cacheWithRetry(cache, path, MAX_RETRY);
        })
      );

      const summary = results.map(function (r) {
        return r.status === 'fulfilled' ? r.value : { ok: false, error: 'rejected' };
      });

      const successCount = summary.filter(function (s) { return s.ok; }).length;
      const failedDetails = summary.filter(function (s) { return !s.ok; }).map(function (s) {
        return s.path + ' → ' + (s.error || 'unknown error');
      });

      console.log('[SW] install完了: 成功 ' + successCount + '/' + EXPECTED_COUNT);
      if (failedDetails.length) {
        console.warn('[SW] 失敗詳細:', failedDetails);
      }

      await notifyAllClients({
        type: 'INSTALL_RESULT',
        cacheName: CACHE_NAME,
        successCount: successCount,
        failedCount: failedDetails.length,
        expectedCount: EXPECTED_COUNT,
        failedFiles: failedDetails
      });

      // ★ skipWaiting() はここで呼ばない（手動更新方式のため）
    })()
  );
});

// ============================================================
// activate イベント
// ============================================================
self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      const keys = await caches.keys();
      const deleted = [];
      for (const key of keys) {
        if (key !== CACHE_NAME) {
          await caches.delete(key);
          deleted.push(key);
        }
      }
      if (deleted.length) {
        console.log('[SW] 古いキャッシュ削除:', deleted);
      }

      await self.clients.claim();

      await notifyAllClients({
        type: 'ACTIVATE_RESULT',
        cacheName: CACHE_NAME,
        deletedCaches: deleted
      });
    })()
  );
});

// ============================================================
// fetch イベント（Cache Only方式）
// ============================================================
self.addEventListener('fetch', function (event) {
  const req = event.request;

  // GET以外は無視
  if (req.method !== 'GET') return;

  // httpで始まらないリクエスト（chrome-extension等）は無視
  if (!req.url.startsWith('http')) return;

  // ナビゲーションリクエスト（ページ遷移そのもの）
  if (req.mode === 'navigate') {
    event.respondWith(
      (async function () {
        const cached = await caches.match(toFullUrl('./index.html'), { ignoreSearch: true });
        if (cached) {
          return cached;
        }
        // キャッシュに無い場合のみネットワークにフォールバック
        try {
          return await fetch(req);
        } catch (err) {
          console.warn('[SW] navigate失敗、キャッシュもネットワークも無し:', req.url);
          return new Response(
            '<h1>オフラインです</h1><p>一度オンラインで開いてキャッシュを作成してください。</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
      })()
    );
    return;
  }

  // その他のリソース：Cache Only（無ければネット試行、失敗時は何もしない）
  event.respondWith(
    (async function () {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) {
        return cached;
      }
      try {
        const response = await fetch(req);
        return response;
      } catch (err) {
        console.warn('[SW] 未キャッシュ・ネットワーク不可:', req.url);
        return new Response('', { status: 504 });
      }
    })()
  );
});

// ============================================================
// message イベント
// ============================================================
self.addEventListener('message', function (event) {
  const data = event.data || {};

  if (data.type === 'GET_DIAGNOSTIC') {
    event.waitUntil(
      (async function () {
        const cache = await caches.open(CACHE_NAME);
        const requests = await cache.keys();
        const urls = requests.map(function (r) { return r.url; });

        const payload = {
          type: 'DIAGNOSTIC_RESULT',
          cacheName: CACHE_NAME,
          cachedCount: urls.length,
          expectedCount: EXPECTED_COUNT,
          urls: urls
        };

        if (event.source) {
          event.source.postMessage(payload);
        } else {
          await notifyAllClients(payload);
        }
      })()
    );
    return;
  }

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
});
