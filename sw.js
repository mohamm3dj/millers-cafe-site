const CACHE_NAME = "millers-static-v87";
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/offline.html",
  "/styles.css?v=20260715c",
  "/assets/millers-logo.webp",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(CORE_ASSETS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

async function networkFirst(request, options = {}) {
  const cache = await caches.open(CACHE_NAME);
  const cacheResponse = options.cacheResponse !== false;
  try {
    const response = await fetch(request);
    if (cacheResponse && response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = cacheResponse
      ? await cache.match(request, { ignoreSearch: true })
      : null;
    if (cached) return cached;
    const fallback = await cache.match("/offline.html");
    if (fallback) return fallback;
    throw error;
  }
}

async function refreshCachedAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch(request);
  if (response && response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, refresh) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    return (await refresh) || Response.error();
  } catch (error) {
    return (await cache.match(request, { ignoreSearch: true })) || Response.error();
  }
}

async function cachedNavigation(request, refresh) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    return (await refresh) || Response.error();
  } catch (error) {
    return (await cache.match("/offline.html")) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    // Query strings can contain short-lived payment/session credentials. Never
    // persist query-bearing navigation URLs or their responses in Cache Storage.
    if (requestUrl.search.length > 0) {
      event.respondWith(networkFirst(event.request, { cacheResponse: false }));
      return;
    }

    const refresh = refreshCachedAsset(event.request);
    event.waitUntil(refresh.catch(() => undefined));
    event.respondWith(cachedNavigation(event.request, refresh));
    return;
  }

  if (["style", "script", "image", "manifest"].includes(event.request.destination)) {
    const refresh = refreshCachedAsset(event.request);
    event.waitUntil(refresh.catch(() => undefined));
    event.respondWith(staleWhileRevalidate(event.request, refresh));
  }
});
