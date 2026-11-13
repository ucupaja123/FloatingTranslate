const CACHE_NAME = "primsic-v9";
const ASSETS = ["/", "/index.html", "/manifest.json"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
  ));
  self.clients.claim();
});

// Network dulu: halaman & file terbaru selalu dimuat dari server.
// Cache hanya dipakai saat offline.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = e.request.url;
  if (url.includes("/api/") || url.includes("/socket.io/")) return;
  if (!url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
