/* 교인앱 서비스 워커 — 화면을 바꾸면 아래 VERSION 숫자와 index.html의 ?v= 숫자를 같이 올려 주세요(폰의 예전 화면 방지) */
const VERSION = 'jjc-gyoin-v5';
const SHELL = [
  './', 'index.html', 'app.css?v=5', 'app.js?v=5', 'config.js?v=5', 'apps.json', 'manifest.json',
  'vendor/html5-qrcode.min.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 같은 주소(우리 앱) 파일만 처리: 인터넷이 되면 최신 것, 안 되면 저장본.
// 구글 시트(GAS) 등 다른 주소 요청은 건드리지 않음.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() =>
      caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))
    )
  );
});
