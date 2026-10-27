// Lets the app open without a connection. App files: network first (so updates show up right away), saved copy when offline.
// Pinned CDN files (sql.js, fonts) never change, so they come from the saved copy first. GitHub API calls are never stored here.
const CACHE = 'loan-payoff-v2';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'icons/icon-192.png',
  'js/app.js', 'js/engine.js', 'js/format.js', 'js/charts.js', 'js/report.js',
  'js/store/db.js', 'js/store/github.js', 'js/store/sync.js', 'js/store/local.js',
  'js/screens/today.js', 'js/screens/plan.js', 'js/screens/money.js', 'js/screens/loans.js', 'js/screens/history.js', 'js/screens/settings.js',
  'js/ui/sheet.js', 'js/ui/form-sheet.js', 'js/ui/log-payment.js'];
const CDN = /^https:\/\/(cdnjs\.cloudflare\.com\/ajax\/libs\/sql\.js\/|fonts\.googleapis\.com|fonts\.gstatic\.com)/;

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.github.com') return;
  if (CDN.test(req.url)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
    return;
  }
  if (url.origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))));
});
