const CACHE = "baliza-v3";
const ASSETS = [
  "/baliza-boya.svg",
  "/baliza-logo-horizontal.svg",
  "/baliza-logo-icono.svg",
  "/baliza-logo-principal.svg",
  "/baliza-logo-icono-maskable.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(ASSETS.map((a) => cache.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  if (request.method !== "GET") return;

  // API: network-first con fallback a cache (offline)
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return res;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // Navegaciones (HTML): network-first — siempre intenta la versión nueva
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return res;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // Assets estáticos: stale-while-revalidate
  e.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      });
      return cached ?? network;
    })
  );
});
