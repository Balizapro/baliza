const CACHE = "baliza-v1";
const ASSETS = [
  "/",
  "/dashboard",
  "/baliza-logo-horizontal.svg",
  "/baliza-logo-icono.svg",
  "/baliza-logo-principal.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  e.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request))
  );
});
