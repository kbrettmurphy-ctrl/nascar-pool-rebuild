const CACHE_NAME = "nascar-pool-pwa-v14";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/player-portal.css",
  "/player-portal.js",
  "/manifest.webmanifest",
  "/img/icon-192.png",
  "/img/icon-512.png",
  "/img/apple-touch-icon.png",
  "/img/buschlight.png",
  "/img/nascar-logo.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => {
        if (key !== CACHE_NAME) return caches.delete(key);
        return null;
      }))
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req));
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      return cached || fetch(req).then((res) => {
        if (req.method === "GET" && res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});

self.addEventListener("push", (event) => {
  event.waitUntil(showPushNotification_(event));
});

async function showPushNotification_(event) {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "NASCAR Pool";
  const options = {
    body: data.body || "New update available.",
    icon: "/img/icon-192.png",
    badge: "/img/icon-192.png",
    data: {
      url: data.url || "/"
    }
  };

  await self.registration.showNotification(title, options);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification?.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }

        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});
