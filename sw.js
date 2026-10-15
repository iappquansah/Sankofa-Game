// Change the version number every time you redeploy, so phones fetch the new files.
const CACHE = "sankofa-v18";
const FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./data.js",
  "./game.js",
  "./race.js",
  "./peerjs.min.js",
  "./manifest.json",
  "./images/icon-192.png",
  "./images/icon-512.png",
  "./fonts/fredoka-v17-latin-500.woff2",
  "./fonts/fredoka-v17-latin-600.woff2",
  "./fonts/fredoka-v17-latin-700.woff2",
  "./fonts/nunito-v32-latin-regular.woff2",
  "./fonts/nunito-v32-latin-700.woff2"
];
// Puzzle images and map art are not listed here. The fetch handler below
// saves each one the first time it loads, so they work offline afterwards.

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match("./index.html"));
    })
  );
});