const CACHE = "baliza-v4";
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

// Notificación Web Push
self.addEventListener("push", (e) => {
  let data = { title: "Baliza", body: "", url: "/dashboard" };
  try {
    data = e.data ? e.data.json() : data;
  } catch {
    data = { title: "Baliza", body: e.data?.text?.() ?? "", url: "/dashboard" };
  }

  e.waitUntil(
    self.registration.showNotification(data.title || "Baliza", {
      body: data.body || "Nuevo estado del río en San Fernando",
      icon: "/baliza-boya.svg",
      badge: "/baliza-boya.svg",
      data: { url: data.url || "/dashboard" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/dashboard";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      return clients.openWindow(url);
    })
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
