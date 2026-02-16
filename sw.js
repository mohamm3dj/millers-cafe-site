const CACHE_NAME = "millers-v30";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./page-transitions.js",
  "./home.js",
  "./manifest.webmanifest",
  "./menu/",
  "./menu/index.html",
  "./menu/menu.js",
  "./collection/",
  "./collection/index.html",
  "./delivery/",
  "./delivery/index.html",
  "./bookings/",
  "./bookings/index.html"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
