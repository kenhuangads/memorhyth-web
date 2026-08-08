/* 最小 Service Worker：讓 PWA 可安裝；API 一律走網路，殼層檔案網路優先、離線時回快取
   路徑一律相對（本機在 /、雲端在 /functions/v1/app/ 底下都能動）

   BUILD 由發佈腳本（publish-web / gen-webassets）置換成當次版本戳記：
   檔案內容因此每次都不同 → 瀏覽器一定會安裝新的 SW → 舊快取被清掉，
   資產網址也帶 ?v=<build> → HTTP 快取不可能餵回舊版程式。 */
const BUILD = '20260808T131801'; // 發佈時置換
const CACHE = `memorhyth-shell-${BUILD}`;
const V = BUILD === 'dev' ? '' : `?v=${BUILD}`;
const SHELL = ['./', `./style.css${V}`, `./app.js${V}`, './manifest.webmanifest', './icon.svg', `./vendor/jsQR.js${V}`];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
