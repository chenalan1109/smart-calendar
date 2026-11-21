// 離線快取：App 本體與行事曆函式庫走快取優先；Google / Gemini API 一律走網路
const VERSION = 'sc-v2';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js',
  'https://cdn.jsdelivr.net/npm/@fullcalendar/core@6.1.15/locales/zh-tw.global.min.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const isShell = url.origin === location.origin || url.hostname === 'cdn.jsdelivr.net';
  if (!isShell) return; // googleapis、accounts.google.com 直接走網路
  // App 本體：網路優先（拿到新版），失敗才用快取
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
