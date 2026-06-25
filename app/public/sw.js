const CACHE_NAME = "incendio-v3-cache";
const URLS = [
  "/",
  "/index.html",
  "/login.html",
  "/dashboard.html",
  "/app.js",
  "/db.js",
  "/style.css",
  "/manifest.json",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css",
  "https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (e.request.url.includes("/api/") || e.request.url.includes("/dashboard") || e.request.url.includes("/fires")) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      return cached || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => cached);
    })
  );
});
