const CACHE_NAME = "fogo-branco-v2";
const TILE_CACHE = "fogo-branco-tiles-v2";

// Ouro Branco, MG – coordenadas do centro e raio offline
const OB_LAT = -20.52;
const OB_LNG = -43.69;
const OB_RADIUS_KM = 40;

const APP_URLS = [
  "/",
  "/index.html",
  "/login.html",
  "/dashboard.html",
  "/app.js",
  "/db.js",
  "/style.css",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/favicon-32.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css",
  "https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js"
];

// ──── Conversão lat/lng → número de tile ────────────────────────────────────
function lngToTileX(lng, z) {
  return Math.floor((lng + 180) / 360 * Math.pow(2, z));
}
function latToTileY(lat, z) {
  const r = lat * Math.PI / 180;
  return Math.floor(
    (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)
  );
}

// ──── Normaliza URL de tile OSM (subdomínios a/b/c → sem subdomínio) ────────
function normalizeTileUrl(url) {
  return url.replace(/https?:\/\/[abc]\.tile\.openstreetmap\.org/, "https://tile.openstreetmap.org");
}

// ──── Envia mensagem para todas as abas abertas ──────────────────────────────
async function broadcast(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(c => c.postMessage(msg));
}

// ──── Pré-carrega tiles de Ouro Branco (40 km) em segundo plano ─────────────
async function preloadOuroBrancoTiles() {
  const latOff = OB_RADIUS_KM / 111.0;
  const lngOff = OB_RADIUS_KM / (111.0 * Math.cos(OB_LAT * Math.PI / 180));

  const north = OB_LAT + latOff;
  const south = OB_LAT - latOff;
  const east  = OB_LNG + lngOff;
  const west  = OB_LNG - lngOff;

  let tileCache;
  try {
    tileCache = await caches.open(TILE_CACHE);
  } catch (_) { return; }

  // Monta lista completa de tiles a baixar
  const tilesToFetch = [];
  for (let z = 10; z <= 14; z++) {
    const xMin = lngToTileX(west, z);
    const xMax = lngToTileX(east, z);
    const yMin = latToTileY(north, z);
    const yMax = latToTileY(south, z);

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tilesToFetch.push({
          url: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
          type: "osm"
        });
        if (z <= 13) {
          tilesToFetch.push({
            url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
            type: "sat"
          });
        }
      }
    }
  }

  const total = tilesToFetch.length;
  let downloaded = 0;

  await broadcast({ type: "TILES_PROGRESS", downloaded: 0, total, region: "Ouro Branco 40km" });

  // Baixa em lotes de 6 em paralelo para não sobrecarregar a rede
  const BATCH = 6;
  for (let i = 0; i < tilesToFetch.length; i += BATCH) {
    const batch = tilesToFetch.slice(i, i + BATCH);
    await Promise.all(batch.map(async ({ url, type }) => {
      const cacheKey = type === "osm" ? normalizeTileUrl(url) : url;
      try {
        if (!(await tileCache.match(cacheKey))) {
          const r = await fetch(url, { mode: "cors" });
          if (r.ok) await tileCache.put(cacheKey, r);
        }
      } catch (_) {}
      downloaded++;
    }));

    // Envia progresso a cada lote
    await broadcast({ type: "TILES_PROGRESS", downloaded, total });
  }

  // Sinaliza conclusão
  await broadcast({ type: "TILES_CACHED", region: "Ouro Branco 40km", total });
}

// ──── MESSAGE: permite disparar o download de tiles sob demanda ──────────────
self.addEventListener("message", e => {
  if (e.data && e.data.type === "START_TILE_DOWNLOAD") {
    preloadOuroBrancoTiles();
  }
});

// ──── INSTALL: cache do shell do app ────────────────────────────────────────
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_URLS).catch(() => {}))
  );
  self.skipWaiting();
});

// ──── ACTIVATE: limpa caches antigos e inicia pré-cache dos tiles ───────────
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== TILE_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
  // Inicia em segundo plano sem bloquear o activate
  preloadOuroBrancoTiles();
});

// ──── FETCH: serve do cache, atualiza em background ─────────────────────────
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;

  const url = e.request.url;

  // Ignora chamadas de API (sempre precisam de rede)
  if (
    url.includes("/auth/") ||
    url.includes("/dashboard") ||
    url.includes("/fire") ||
    url.includes("/sync") ||
    url.includes("/login") ||
    url.includes("/report") ||
    url.includes("/export")
  ) return;

  // ── Tiles de mapa → usa TILE_CACHE ──
  const isTile =
    url.includes("tile.openstreetmap.org") ||
    url.includes("arcgisonline.com/ArcGIS");

  if (isTile) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async cache => {
        const key = normalizeTileUrl(url);

        // 1. Tenta cache normalizado
        const cached = await cache.match(key) || await cache.match(e.request);
        if (cached) return cached;

        // 2. Busca na rede e salva
        try {
          const res = await fetch(e.request);
          if (res.ok) cache.put(key, res.clone());
          return res;
        } catch (_) {
          return new Response("", { status: 503, statusText: "Offline" });
        }
      })
    );
    return;
  }

  // ── Shell do app → stale-while-revalidate ──
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      });
      return cached || network.catch(() =>
        new Response("Offline", { status: 503 })
      );
    })
  );
});
