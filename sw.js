/* Me & You service worker
   - Works under the /Me-and-you/ GitHub Pages folder (all paths are relative).
   - Pages and app files: network first (so your updates show straight away),
     falling back to the saved copy when offline.
   - Supabase requests are NEVER cached or touched, so logins and posts stay live and private.
   - intro.mp4 is not cached (large file).
   To force everyone to refresh after a big change, bump VERSION below. */

const VERSION = 'v1';
const SHELL_CACHE = 'meyou-shell-' + VERSION;
const RUNTIME_CACHE = 'meyou-runtime-' + VERSION;

const SHELL_FILES = [
  './',
  'index.html',
  'config.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png'
];

const SUPABASE_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const RUNTIME_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com', 'images.unsplash.com'];
const MAX_RUNTIME_ENTRIES = 80;

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const shell = await caches.open(SHELL_CACHE);
    // Add files one by one so a single missing file does not break the install.
    await Promise.all(SHELL_FILES.map(function (f) {
      return shell.add(f).catch(function () {});
    }));
    // The Supabase library lets the app start offline (opaque cross-site copy).
    try {
      const res = await fetch(new Request(SUPABASE_LIB, { mode: 'no-cors' }));
      await shell.put(SUPABASE_LIB, res);
    } catch (e) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys.filter(function (k) {
      return k !== SHELL_CACHE && k !== RUNTIME_CACHE;
    }).map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    const t = setTimeout(function () { reject(new Error('timeout')); }, ms);
    promise.then(function (v) { clearTimeout(t); resolve(v); },
                 function (e) { clearTimeout(t); reject(e); });
  });
}

async function networkFirst(request, isPage) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await withTimeout(fetch(request), 5000);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (isPage) {
      const page = (await cache.match('index.html')) || (await cache.match('./'));
      if (page) return page;
      return new Response(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<body style="font-family:Arial;background:#F4EBDD;color:#354B3B;text-align:center;padding:60px 24px">' +
        '<h2>You are offline</h2><p>Me &amp; You needs an internet connection the first time it opens. ' +
        'Please reconnect and try again.</p></body>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
    throw e;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(request);
  const fetching = fetch(request).then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(request, res.clone()).then(function () { trim(cache); });
    }
    return res;
  }).catch(function () { return hit; });
  return hit || fetching;
}

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_RUNTIME_ENTRIES) {
    await Promise.all(keys.slice(0, keys.length - MAX_RUNTIME_ENTRIES).map(function (k) { return cache.delete(k); }));
  }
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never touch Supabase (logins, posts, diary) or video / range requests.
  if (/\.supabase\.(co|in)$/.test(url.hostname)) return;
  if (request.headers.has('range')) return;
  if (url.pathname.endsWith('.mp4')) return;

  // Supabase library: use the saved copy first so the app can start offline.
  if (request.url === SUPABASE_LIB) {
    event.respondWith(
      caches.match(SUPABASE_LIB).then(function (hit) { return hit || fetch(request); })
    );
    return;
  }

  // Fonts, photos and library files from other sites.
  if (url.origin !== self.location.origin) {
    if (RUNTIME_HOSTS.indexOf(url.hostname) !== -1) {
      event.respondWith(staleWhileRevalidate(request));
    }
    return;
  }

  // The app's own files.
  event.respondWith(networkFirst(request, request.mode === 'navigate'));
});
