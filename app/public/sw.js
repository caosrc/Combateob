const CACHE_NAME  = "fogo-branco-v6";
const TILE_CACHE  = "fogo-branco-tiles-v6";

// Ouro Branco, MG
const OB_LAT = -20.52;
const OB_LNG = -43.69;
const OB_RADIUS_KM = 40;

// ─── App shell ───────────────────────────────────────────────────────────────
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

// ─── Tile math ────────────────────────────────────────────────────────────────
function lngToTileX(lng, z) {
  return Math.floor((lng + 180) / 360 * (1 << z));
}
function latToTileY(lat, z) {
  const r = lat * Math.PI / 180;
  return Math.floor(
    (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (1 << z)
  );
}
function normalizeTileUrl(url) {
  return url.replace(/https?:\/\/[abc]\.tile\.openstreetmap\.org/, "https://tile.openstreetmap.org");
}

// ─── Broadcast para todas as abas ────────────────────────────────────────────
async function broadcast(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(c => c.postMessage(msg));
}

// ─── Sleep utilitário ─────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Fetch com retry ──────────────────────────────────────────────────────────
async function fetchWithRetry(url, options = {}, retries = 3, delayMs = 600) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      // 429 = rate limited — espera mais antes de tentar novamente
      if (res.status === 429) await sleep(delayMs * (attempt + 2));
    } catch (_) {}
    if (attempt < retries - 1) await sleep(delayMs * (attempt + 1));
  }
  return null;
}

// ─── Pré-cache de tiles ───────────────────────────────────────────────────────
// Estratégia de zoom:
//   OSM (rua)      → z10 a z13  (z14 é cacheado on-demand ao usar o mapa)
//   Satélite       → z10 a z12  (imagens pesadas; detalhe cacheado on-demand)
// Isso reduz o pré-cache para ~550 tiles (raio 40km) e evita o rate-limit do OSM.
async function preloadOuroBrancoTiles(radiusKm) {
  const RADIUS = radiusKm || OB_RADIUS_KM;
  const latOff = RADIUS / 111.0;
  const lngOff = RADIUS / (111.0 * Math.cos(OB_LAT * Math.PI / 180));

  const north = OB_LAT + latOff;
  const south = OB_LAT - latOff;
  const east  = OB_LNG + lngOff;
  const west  = OB_LNG - lngOff;

  let tileCache;
  try { tileCache = await caches.open(TILE_CACHE); }
  catch (_) { return; }

  // Monta lista de todos os tiles a baixar
  const tiles = [];

  for (let z = 10; z <= 13; z++) {           // OSM: z10–z13
    const xMin = lngToTileX(west, z),  xMax = lngToTileX(east, z);
    const yMin = latToTileY(north, z), yMax = latToTileY(south, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ url: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, type: "osm" });
      }
    }
  }

  for (let z = 10; z <= 12; z++) {           // Satélite: z10–z12
    const xMin = lngToTileX(west, z),  xMax = lngToTileX(east, z);
    const yMin = latToTileY(north, z), yMax = latToTileY(south, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({
          url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
          type: "sat"
        });
      }
    }
  }

  const total = tiles.length;
  let downloaded = 0;
  let failed = 0;

  await broadcast({ type: "TILES_PROGRESS", downloaded: 0, total });

  // Baixa em lotes pequenos com pausa entre lotes para não ser bloqueado
  const BATCH    = 3;    // 3 requisições em paralelo
  const DELAY_MS = 250;  // 250 ms entre lotes

  for (let i = 0; i < tiles.length; i += BATCH) {
    const batch = tiles.slice(i, i + BATCH);

    await Promise.all(batch.map(async ({ url, type }) => {
      const key = type === "osm" ? normalizeTileUrl(url) : url;
      try {
        // Já está em cache? Pula.
        if (await tileCache.match(key)) { downloaded++; return; }

        const res = await fetchWithRetry(url, { mode: "cors" }, 3, 500);
        if (res) {
          await tileCache.put(key, res);
          downloaded++;
        } else {
          failed++;
          downloaded++; // conta como processado para a barra avançar
        }
      } catch (_) {
        failed++;
        downloaded++;
      }
    }));

    // Envia progresso a cada lote
    await broadcast({ type: "TILES_PROGRESS", downloaded, total });

    // Pausa entre lotes para não saturar o servidor
    if (i + BATCH < tiles.length) await sleep(DELAY_MS);
  }

  await broadcast({ type: "TILES_CACHED", region: "Ouro Branco 40km", total, failed });
}

// ─── INSTALL ──────────────────────────────────────────────────────────────────
// Cacheia cada arquivo individualmente — se um CDN externo falhar, os arquivos
// locais essenciais ainda são salvos (addAll falha tudo-ou-nada, por isso evitamos).
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c =>
      Promise.all(
        APP_URLS.map(url =>
          fetch(url, { cache: "no-cache" })
            .then(res => { if (res.ok) return c.put(url, res); })
            .catch(() => {})
        )
      )
    )
  );
  self.skipWaiting();
});

// ─── ACTIVATE ────────────────────────────────────────────────────────────────
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── MESSAGE: download sob demanda (botão "Instalar App") ────────────────────
self.addEventListener("message", e => {
  if (e.data && e.data.type === "START_TILE_DOWNLOAD") {
    e.waitUntil(preloadOuroBrancoTiles(e.data.radiusKm || OB_RADIUS_KM));
  }
});

// ─── FETCH: serve cache → rede ───────────────────────────────────────────────
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;

  const url = e.request.url;

  // Rotas de API que precisam sempre de rede — mas só para fetch/XHR, nunca para navegação de página.
  // Se for navegação (mode === "navigate"), cai direto no handler de navigate abaixo para servir do cache.
  if (
    e.request.mode !== "navigate" &&
    (
      url.includes("/auth/") || url.includes("/dashboard") ||
      url.includes("/fire")  || url.includes("/sync")      ||
      url.includes("/login") || url.includes("/report")    ||
      url.includes("/export")
    )
  ) return;

  // ── Tiles de mapa ────────────────────────────────────────────────────────
  const isTile = url.includes("tile.openstreetmap.org") ||
                 url.includes("arcgisonline.com/ArcGIS");

  if (isTile) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async cache => {
        const key    = normalizeTileUrl(url);
        const cached = await cache.match(key) || await cache.match(e.request);
        if (cached) return cached;

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

  // ── Navegação (abrir o app) – cache primeiro, com fallback garantido ─────
  if (e.request.mode === "navigate") {
    e.respondWith(
      caches.match(e.request).then(async cached => {
        if (cached) {
          fetch(e.request).then(res => {
            if (res.ok) caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
          }).catch(() => {});
          return cached;
        }
        try {
          const res = await fetch(e.request);
          if (res.ok) caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
          return res;
        } catch (_) {
          // Sem rede e sem cache exato: usa a shell principal como fallback
          const fallback = await caches.match("/index.html") || await caches.match("/login.html");
          return fallback || new Response("Offline", { status: 503 });
        }
      })
    );
    return;
  }

  // ── Demais recursos do shell – stale-while-revalidate ────────────────────
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => {
        if (res.ok) {
          caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
        }
        return res;
      });
      return cached || net.catch(() => new Response("Offline", { status: 503 }));
    })
  );
});
