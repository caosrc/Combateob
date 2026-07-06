// ── Fogo Branco — Service Worker ──────────────────────────────────────────────
const VERSION     = 'v7-2026'
const APP_CACHE   = `fogo-branco-app-${VERSION}`
const TILES_CACHE = 'fogo-branco-tiles-osm'        // persiste entre versões
const SAT_CACHE   = 'fogo-branco-tiles-sat'         // persiste entre versões
const ASSETS_CACHE = `fogo-branco-assets-${VERSION}`

// Ouro Branco, MG
const OB_LAT = -20.52;
const OB_LNG = -43.69;
const OB_RADIUS_KM = 40;

// ─── App shell ───────────────────────────────────────────────────────────────
const APP_SHELL = [
  '/',
  '/index.html',
  '/login.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon-32.png',
];

const EXTERNAL_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css',
  'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js',
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
  return url.replace(/https?:\/\/[abc]\.tile\.openstreetmap\.org/, 'https://tile.openstreetmap.org');
}

// ─── Broadcast para todas as abas ─────────────────────────────────────────────
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
      if (res.status === 429) await sleep(delayMs * (attempt + 2));
    } catch (_) {}
    if (attempt < retries - 1) await sleep(delayMs * (attempt + 1));
  }
  return null;
}

// ─── Pré-cache de tiles ───────────────────────────────────────────────────────
// OSM z10–z13 (z14 cacheado on-demand), Satélite z10–z12
async function preloadOuroBrancoTiles(radiusKm) {
  const RADIUS = radiusKm || OB_RADIUS_KM;
  const latOff = RADIUS / 111.0;
  const lngOff = RADIUS / (111.0 * Math.cos(OB_LAT * Math.PI / 180));

  const north = OB_LAT + latOff, south = OB_LAT - latOff;
  const east  = OB_LNG + lngOff, west  = OB_LNG - lngOff;

  let osmCache, satCache;
  try {
    osmCache = await caches.open(TILES_CACHE);
    satCache = await caches.open(SAT_CACHE);
  } catch (_) { return; }

  const tiles = [];

  for (let z = 10; z <= 13; z++) {
    const xMin = lngToTileX(west, z),  xMax = lngToTileX(east, z);
    const yMin = latToTileY(north, z), yMax = latToTileY(south, z);
    for (let x = xMin; x <= xMax; x++)
      for (let y = yMin; y <= yMax; y++)
        tiles.push({ url: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, type: 'osm' });
  }

  for (let z = 10; z <= 12; z++) {
    const xMin = lngToTileX(west, z),  xMax = lngToTileX(east, z);
    const yMin = latToTileY(north, z), yMax = latToTileY(south, z);
    for (let x = xMin; x <= xMax; x++)
      for (let y = yMin; y <= yMax; y++)
        tiles.push({
          url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
          type: 'sat'
        });
  }

  const total = tiles.length;
  let downloaded = 0, failed = 0;
  const BATCH = 6, DELAY_MS = 800;

  for (let i = 0; i < tiles.length; i += BATCH) {
    const batch = tiles.slice(i, i + BATCH);
    await Promise.all(batch.map(async ({ url, type }) => {
      const cache = type === 'sat' ? satCache : osmCache;
      const key = type === 'osm' ? normalizeTileUrl(url) : url;
      if (await cache.match(key)) { downloaded++; return; }
      const res = await fetchWithRetry(url, {}, 2, 500);
      if (res) { await cache.put(key, res); downloaded++; }
      else failed++;
      broadcast({ type: 'TILES_PROGRESS', downloaded, total, failed });
    }));
    if (i + BATCH < tiles.length) await sleep(DELAY_MS);
  }
  broadcast({ type: 'TILES_CACHED', downloaded, total, failed });
}

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting(); // ativa imediatamente sem esperar fechar abas
  e.waitUntil(
    caches.open(APP_CACHE).then(cache =>
      Promise.all(
        APP_SHELL.map(url =>
          cache.add(new Request(url, { cache: 'reload' }))
               .catch(() => {/* tolera falhas em arquivos opcionais */})
        )
      )
    )
  );
});

// ─── Activate — limpa caches antigos (exceto tiles que persistem) ─────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== APP_CACHE && k !== TILES_CACHE && k !== SAT_CACHE && k !== ASSETS_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Mensagens (download mapa offline + atualização imediata) ─────────────────
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'START_TILE_DOWNLOAD') {
    // waitUntil garante que o SW não é encerrado no meio do download
    e.waitUntil(preloadOuroBrancoTiles(e.data.radiusKm));
  }
  // Ativa novo SW imediatamente quando o app pede (após updatefound)
  if (e.data?.tipo === 'SKIP_WAITING') self.skipWaiting();
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // ── NUNCA cacheia rotas de API/dados dinâmicos ────────────────────────────
  // Inclui todas as rotas do servidor que retornam dados frescos
  if (
    e.request.method !== 'GET' ||
    e.request.mode !== 'navigate' &&
    (
      url.includes('/auth/') ||
      url.includes('/dashboard') ||
      url.includes('/fire')  ||
      url.includes('/sync')  ||
      url.includes('/report/') ||
      url.includes('/export/') ||
      url.includes('/api/')
    )
  ) {
    return; // deixa o browser fazer o fetch normalmente
  }

  // ── Tiles OSM — cache-first ───────────────────────────────────────────────
  const isOsmTile = url.includes('tile.openstreetmap.org');
  const isSatTile = url.includes('arcgisonline.com');

  if (isOsmTile || isSatTile) {
    const cacheKey = isOsmTile ? normalizeTileUrl(url) : url;
    const cacheName = isSatTile ? SAT_CACHE : TILES_CACHE;
    e.respondWith(
      caches.open(cacheName).then(async cache => {
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
        try {
          const res = await fetch(e.request);
          if (res.ok) cache.put(cacheKey, res.clone());
          return res;
        } catch (_) {
          return new Response('', { status: 503, statusText: 'Offline' });
        }
      })
    );
    return;
  }

  // ── Assets externos (Leaflet CDN) — stale-while-revalidate ───────────────
  const isExternal = url.includes('unpkg.com') || url.includes('cdnjs.com');
  if (isExternal) {
    e.respondWith(
      caches.open(ASSETS_CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        const net = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => null);
        return cached || net || new Response('', { status: 503 });
      })
    );
    return;
  }

  // ── Navegação SPA — network-first com fallback cache → index.html ─────────
  if (e.request.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(e.request);
          if (res.ok) {
            caches.open(APP_CACHE).then(c => c.put(e.request, res.clone()));
          }
          return res;
        } catch (_) {
          const cached = await caches.match(e.request);
          if (cached) return cached;
          // fallback para shell
          return (
            (await caches.match('/login.html')) ||
            (await caches.match('/index.html')) ||
            new Response('Offline', { status: 503 })
          );
        }
      })()
    );
    return;
  }

  // ── Demais recursos do shell — stale-while-revalidate ────────────────────
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => {
        if (res.ok) caches.open(APP_CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      });
      return cached || net.catch(() => new Response('Offline', { status: 503 }));
    })
  );
});
