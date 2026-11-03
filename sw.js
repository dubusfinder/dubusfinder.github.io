
/* DU BUS FINDER - Optimized Service Worker */

const CACHE = "du-bus-finder-v20";

const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

/* ----------------------------------
   INSTALL
---------------------------------- */

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(error => {
        console.error("Cache installation failed:", error);
        throw error;
      })
  );
});

/* ----------------------------------
   ACTIVATE
---------------------------------- */

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key =>
              key.startsWith("du-bus-finder-") &&
              key !== CACHE
            )
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ----------------------------------
   FETCH STRATEGY
---------------------------------- */

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Ignore external requests and API requests
  if (url.origin !== self.location.origin) return;

  const isAppFile =
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/style.css") ||
    url.pathname.endsWith("/manifest.json") ||
    request.mode === "navigate";

  if (isAppFile) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();

            caches.open(CACHE)
              .then(cache => cache.put(request, copy))
              .catch(error => {
                console.warn("Cache update failed:", error);
              });
          }

          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);

          if (cached) return cached;

          if (request.mode === "navigate") {
            const offlinePage = await caches.match("./index.html");

            if (offlinePage) return offlinePage;
          }

          return new Response(
            "You are offline. Please check your internet connection.",
            {
              status: 503,
              statusText: "Service Unavailable",
              headers: {
                "Content-Type": "text/plain; charset=utf-8"
              }
            }
          );
        })
    );

    return;
  }

  // Cache first for other local assets
  event.respondWith(
    caches.match(request)
      .then(cached => cached || fetch(request))
  );
});
