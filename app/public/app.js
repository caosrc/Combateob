// ==================== INIT ====================
const token = localStorage.getItem("token");
if (!token) window.location.href = "/login.html";

document.getElementById("user-badge").textContent =
  (localStorage.getItem("username") || "–") + " · " + (localStorage.getItem("team") || "–");

// ==================== MAP ====================
const map = L.map("map").setView([-20.5, -43.85], 13);

const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors"
});

const sat = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "Tiles © Esri" }
);

osm.addTo(map);
L.control.layers({ "🗺️ OSM": osm, "🛰️ Satélite": sat }).addTo(map);

const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

const drawControl = new L.Control.Draw({
  draw: {
    polygon: {
      allowIntersection: false,
      showArea: true,
      shapeOptions: { color: "#ff4444", weight: 2, fillOpacity: 0.2 }
    },
    polyline: false,
    rectangle: { shapeOptions: { color: "#ff4444", fillOpacity: 0.2 } },
    circle: false,
    marker: false,
    circlemarker: false
  },
  edit: { featureGroup: drawnItems }
});

let currentPolygon = null;
let drawControlAdded = false;
let modoAtivo = null;

// ==================== MODO DE MARCAÇÃO ====================
function ativarModo(modo) {
  // Desativa modo anterior
  desativarModoAtual();

  modoAtivo = modo;

  document.querySelectorAll(".btn-area-mode").forEach(b => b.classList.remove("active"));
  document.getElementById("btn-modo-" + modo).classList.add("active");

  if (modo === "poligono") {
    ativarPoligono();
  } else if (modo === "gps") {
    ativarGPS();
  } else if (modo === "coords") {
    ativarCoordenadas();
  }
}

function desativarModoAtual() {
  pararGPS();
  document.getElementById("gps-panel").style.display = "none";
  document.getElementById("coords-panel").style.display = "none";
  if (drawControlAdded) {
    map.removeControl(drawControl);
    drawControlAdded = false;
  }
  document.querySelectorAll(".btn-area-mode").forEach(b => b.classList.remove("active"));
  modoAtivo = null;
}

// ---------- MODO POLÍGONO ----------
function ativarPoligono() {
  document.getElementById("gps-panel").style.display = "none";
  document.getElementById("coords-panel").style.display = "none";

  if (!drawControlAdded) {
    map.addControl(drawControl);
    drawControlAdded = true;
  }

  // Inicia automaticamente o desenho de polígono
  setTimeout(() => {
    const btn = document.querySelector(".leaflet-draw-draw-polygon");
    if (btn) btn.click();
  }, 200);
}

map.on("draw:created", function(e) {
  drawnItems.clearLayers();
  drawnItems.addLayer(e.layer);
  currentPolygon = e.layer.getLatLngs()[0].map(p => [p.lng, p.lat]);
  atualizarAreaDisplay();
});

map.on("draw:edited", function(e) {
  e.layers.eachLayer(layer => {
    currentPolygon = layer.getLatLngs()[0].map(p => [p.lng, p.lat]);
  });
  atualizarAreaDisplay();
});

map.on("draw:deleted", function() {
  currentPolygon = null;
  resetAreaDisplay();
});

// ---------- MODO GPS ----------
let gpsWatchId = null;
let gpsPoints = [];
let gpsMarkers = [];
let gpsPolyline = null;

function ativarGPS() {
  document.getElementById("gps-panel").style.display = "block";
  document.getElementById("coords-panel").style.display = "none";
  gpsPoints = [];
  gpsMarkers = [];
  document.getElementById("gps-points-count").textContent = "0 pontos registrados";
  document.getElementById("gps-status-text").textContent = "Aguardando GPS...";

  if (!navigator.geolocation) {
    alert("Geolocalização não suportada neste dispositivo.");
    return;
  }

  gpsWatchId = navigator.geolocation.watchPosition(
    pos => {
      const { latitude, longitude, accuracy } = pos.coords;
      document.getElementById("gps-status-text").textContent =
        `📍 ${latitude.toFixed(5)}, ${longitude.toFixed(5)} (±${accuracy.toFixed(0)}m)`;

      // Adiciona ponto automaticamente a cada ~5m de distância
      if (gpsPoints.length === 0 || distanciaMetros(gpsPoints[gpsPoints.length - 1], [latitude, longitude]) > 5) {
        adicionarPontoGPS(latitude, longitude);
      }
    },
    err => {
      document.getElementById("gps-status-text").textContent = "❌ Erro: " + err.message;
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
}

function distanciaMetros([lat1, lng1], [lat2, lng2]) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function adicionarPontoGPS(lat, lng) {
  gpsPoints.push([lat, lng]);

  const marker = L.circleMarker([lat, lng], { radius: 5, color: "#ff4444", fillColor: "#ff4444", fillOpacity: 0.8 }).addTo(map);
  marker.bindPopup(`Ponto ${gpsPoints.length}<br>${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  gpsMarkers.push(marker);

  if (gpsPolyline) map.removeLayer(gpsPolyline);
  if (gpsPoints.length > 1) {
    gpsPolyline = L.polyline(gpsPoints, { color: "#ff4444", weight: 2, dashArray: "5,5" }).addTo(map);
  }

  map.setView([lat, lng], map.getZoom());
  document.getElementById("gps-points-count").textContent = `${gpsPoints.length} pontos registrados`;
}

function adicionarPontoGPSManual() {
  navigator.geolocation.getCurrentPosition(pos => {
    adicionarPontoGPS(pos.coords.latitude, pos.coords.longitude);
  }, () => alert("Não foi possível obter a posição."), { enableHighAccuracy: true });
}

function pararGPS() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  if (gpsPoints.length >= 3) {
    // Fecha o polígono
    currentPolygon = gpsPoints.map(([lat, lng]) => [lng, lat]);

    // Limpa markers e polyline
    gpsMarkers.forEach(m => map.removeLayer(m));
    if (gpsPolyline) map.removeLayer(gpsPolyline);
    gpsMarkers = [];
    gpsPolyline = null;

    // Desenha polígono fechado
    drawnItems.clearLayers();
    const latlngs = gpsPoints.map(([lat, lng]) => [lat, lng]);
    const poly = L.polygon(latlngs, { color: "#ff4444", weight: 2, fillOpacity: 0.2 });
    drawnItems.addLayer(poly);
    map.fitBounds(poly.getBounds(), { padding: [30, 30] });

    atualizarAreaDisplay();
    document.getElementById("gps-panel").style.display = "none";
  }
}

// ---------- MODO COORDENADAS ----------
let coordsManual = [];

function ativarCoordenadas() {
  document.getElementById("gps-panel").style.display = "none";
  document.getElementById("coords-panel").style.display = "block";
  coordsManual = [];
  renderizarListaCoords();
}

function adicionarCoordenada() {
  const lat = parseFloat(document.getElementById("coord-lat").value);
  const lng = parseFloat(document.getElementById("coord-lng").value);

  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    alert("Coordenadas inválidas. Latitude: -90 a 90, Longitude: -180 a 180");
    return;
  }

  coordsManual.push([lat, lng]);
  document.getElementById("coord-lat").value = "";
  document.getElementById("coord-lng").value = "";

  // Marca no mapa
  L.circleMarker([lat, lng], { radius: 6, color: "#ff4444", fillColor: "#ff4444", fillOpacity: 0.8 })
    .addTo(map)
    .bindPopup(`Ponto ${coordsManual.length}: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);

  map.setView([lat, lng], 14);
  renderizarListaCoords();
}

function renderizarListaCoords() {
  const el = document.getElementById("coords-lista");
  if (coordsManual.length === 0) {
    el.textContent = "Nenhum ponto adicionado.";
    return;
  }
  el.innerHTML = coordsManual.map((c, i) =>
    `<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #eee;">
      <span>📍 ${i+1}: ${c[0].toFixed(5)}, ${c[1].toFixed(5)}</span>
      <span style="cursor:pointer;color:#c0392b;" onclick="removerCoord(${i})">✕</span>
    </div>`
  ).join("");
}

function removerCoord(i) {
  coordsManual.splice(i, 1);
  renderizarListaCoords();
}

function fecharCoordsPanel() {
  document.getElementById("coords-panel").style.display = "none";
  document.getElementById("btn-modo-coords").classList.remove("active");
  modoAtivo = null;
}

function finalizarCoordenadas() {
  if (coordsManual.length < 3) {
    alert("Adicione pelo menos 3 pontos para formar a área.");
    return;
  }

  currentPolygon = coordsManual.map(([lat, lng]) => [lng, lat]);

  drawnItems.clearLayers();
  const latlngs = coordsManual.map(([lat, lng]) => [lat, lng]);
  const poly = L.polygon(latlngs, { color: "#ff4444", weight: 2, fillOpacity: 0.2 });
  drawnItems.addLayer(poly);
  map.fitBounds(poly.getBounds(), { padding: [30, 30] });

  atualizarAreaDisplay();
  document.getElementById("coords-panel").style.display = "none";
  document.getElementById("btn-modo-coords").classList.remove("active");
  modoAtivo = null;
}

// ---------- ÁREA DISPLAY ----------
function atualizarAreaDisplay() {
  if (!currentPolygon || currentPolygon.length < 3) return;

  const ha = calcularHectares(currentPolygon);

  document.getElementById("coords-display").style.display = "block";
  document.getElementById("coords-display").textContent =
    `✅ ${currentPolygon.length} pontos · ~${ha.toFixed(2)} ha (estimativa)`;

  const badge = document.getElementById("area-badge");
  badge.textContent = `~${ha.toFixed(2)} ha`;
  badge.className = "area-badge ok";

  document.getElementById("btn-limpar-area").style.display = "block";
}

function resetAreaDisplay() {
  document.getElementById("coords-display").style.display = "none";
  document.getElementById("coords-display").textContent = "";
  const badge = document.getElementById("area-badge");
  badge.textContent = "Não marcada";
  badge.className = "area-badge";
  document.getElementById("btn-limpar-area").style.display = "none";
}

function calcularHectares(polygon) {
  const p = polygon;
  let area = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    area += p[i][0] * p[j][1];
    area -= p[j][0] * p[i][1];
  }
  return Math.abs(area) / 2 * 1230800;
}

function clearDrawing() {
  drawnItems.clearLayers();
  currentPolygon = null;
  gpsPoints = [];
  coordsManual = [];
  gpsMarkers.forEach(m => map.removeLayer(m));
  if (gpsPolyline) map.removeLayer(gpsPolyline);
  gpsMarkers = [];
  gpsPolyline = null;
  resetAreaDisplay();
  desativarModoAtual();
}

function logout() {
  localStorage.clear();
  window.location.href = "/login.html";
}

// ==================== HEATMAP ====================
let heatLayer = null;

async function loadHeatmap() {
  try {
    const res = await fetch("/dashboard");
    const data = await res.json();
    const points = (data.rows || []).map(f => {
      try {
        const poly = JSON.parse(f.polygon || "[]");
        if (poly.length > 0) {
          const avgLat = poly.reduce((s, p) => s + p[1], 0) / poly.length;
          const avgLng = poly.reduce((s, p) => s + p[0], 0) / poly.length;
          return [avgLat, avgLng, Math.min(f.area || 1, 10)];
        }
      } catch {}
      return null;
    }).filter(Boolean);

    if (heatLayer) map.removeLayer(heatLayer);
    if (points.length > 0 && L.heatLayer) {
      heatLayer = L.heatLayer(points, { radius: 30, blur: 15, maxZoom: 17 }).addTo(map);
    }
  } catch (e) {
    console.log("Heatmap error:", e);
  }
}

loadHeatmap();

// ==================== SIGNATURE ====================
let sigCanvas, sigCtx, sigDrawing = false;

function initSignature() {
  sigCanvas = document.getElementById("signature-canvas");
  sigCtx = sigCanvas.getContext("2d");
  sigCtx.lineWidth = 2;
  sigCtx.lineCap = "round";
  sigCtx.strokeStyle = "#000";

  sigCanvas.addEventListener("mousedown", e => { sigDrawing = true; sigCtx.beginPath(); sigCtx.moveTo(getPos(e).x, getPos(e).y); });
  sigCanvas.addEventListener("mousemove", e => { if (!sigDrawing) return; sigCtx.lineTo(getPos(e).x, getPos(e).y); sigCtx.stroke(); });
  sigCanvas.addEventListener("mouseup", () => sigDrawing = false);
  sigCanvas.addEventListener("mouseleave", () => sigDrawing = false);
  sigCanvas.addEventListener("touchstart", e => { e.preventDefault(); sigDrawing = true; sigCtx.beginPath(); const t = getTouch(e); sigCtx.moveTo(t.x, t.y); });
  sigCanvas.addEventListener("touchmove", e => { e.preventDefault(); if (!sigDrawing) return; const t = getTouch(e); sigCtx.lineTo(t.x, t.y); sigCtx.stroke(); });
  sigCanvas.addEventListener("touchend", () => sigDrawing = false);
}

function getPos(e) {
  const rect = sigCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function getTouch(e) {
  const rect = sigCanvas.getBoundingClientRect();
  const t = e.touches[0];
  return { x: t.clientX - rect.left, y: t.clientY - rect.top };
}

function clearSignature() {
  if (sigCtx) sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
}

function getSignatureData() {
  if (!sigCanvas) return null;
  return sigCanvas.toDataURL("image/png");
}

initSignature();

// ==================== MODAL ====================
function openSaveModal() {
  if (!currentPolygon || currentPolygon.length < 3) {
    alert("Marque a área queimada no mapa antes de registrar.\n\nUse um dos botões: Desenhar no Mapa, Rastrear por GPS ou Por Coordenadas.");
    return;
  }
  const ha = calcularHectares(currentPolygon);
  document.getElementById("modal-area").textContent = ha.toFixed(4) + " ha";
  document.getElementById("save-modal").classList.add("active");
}

function closeModal() {
  document.getElementById("save-modal").classList.remove("active");
}

// ==================== SAVE FIRE ====================
async function salvarIncendio() {
  if (!currentPolygon || currentPolygon.length < 3) {
    alert("Polígono inválido.");
    return;
  }

  const municipio = document.getElementById("municipio").value.trim();
  const causa = document.getElementById("causa").value;
  const descricao = document.getElementById("descricao").value.trim();
  const signature = getSignatureData();

  const fireData = {
    data: { municipio, causa, descricao },
    polygon: currentPolygon,
    signature
  };

  if (navigator.onLine) {
    try {
      const res = await fetch("/fire", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": token },
        body: JSON.stringify(fireData)
      });
      const r = await res.json();
      if (r.error) { alert("Erro: " + r.error); return; }

      closeModal();
      alert(`✅ Incêndio registrado!\nÁrea: ${r.area.toFixed(4)} hectares\nID: #${r.id}`);
      clearDrawing();
      clearSignature();
      document.getElementById("municipio").value = "";
      document.getElementById("causa").value = "";
      document.getElementById("descricao").value = "";
      loadHeatmap();
    } catch (e) {
      await savePendingFire(fireData);
      closeModal();
      alert("⚠️ Sem conexão. Registro salvo localmente e será sincronizado quando online.");
      updatePendingCount();
    }
  } else {
    await savePendingFire(fireData);
    closeModal();
    alert("⚠️ Modo offline. Registro salvo localmente.");
    updatePendingCount();
  }
}

// ==================== PHOTOS ====================
let selectedPhotos = [];

function handlePhotoSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude, longitude } = pos.coords;
    const reader = new FileReader();
    reader.onload = e => {
      selectedPhotos.push({ file, lat: latitude, lng: longitude, preview: e.target.result });
      renderPhotoList();
      L.marker([latitude, longitude]).addTo(map).bindPopup("📸 Foto capturada aqui").openPopup();
    };
    reader.readAsDataURL(file);
  }, () => {
    const reader = new FileReader();
    reader.onload = e => {
      selectedPhotos.push({ file, lat: null, lng: null, preview: e.target.result });
      renderPhotoList();
    };
    reader.readAsDataURL(file);
  });
}

function renderPhotoList() {
  const list = document.getElementById("photo-list");
  list.innerHTML = selectedPhotos.map((p, i) =>
    `<img src="${p.preview}" class="photo-thumb" title="Foto ${i+1}${p.lat ? ` (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})` : ''}">`
  ).join("");
}

// ==================== SYNC ====================
async function syncData() {
  if (!navigator.onLine) { document.getElementById("sync-status").textContent = "❌ Sem conexão"; return; }
  document.getElementById("sync-status").textContent = "Sincronizando...";
  const synced = await syncPendingFires(token);
  document.getElementById("sync-status").textContent =
    synced > 0 ? `✅ ${synced} registro(s) sincronizados` : "✅ Nada pendente";
  updatePendingCount();
}

async function updatePendingCount() {
  const pending = await getPendingFires();
  document.getElementById("pending-count").textContent =
    `${pending.length} pendente${pending.length !== 1 ? "s" : ""}`;
}

updatePendingCount();

// ==================== OFFLINE ====================
function updateOnlineStatus() {
  const dot = document.getElementById("online-dot");
  const text = document.getElementById("online-text");
  const banner = document.getElementById("offline-banner");

  if (navigator.onLine) {
    dot.className = "dot dot-green";
    text.textContent = "Online";
    banner.classList.remove("show");
    syncData();
  } else {
    dot.className = "dot dot-red";
    text.textContent = "Offline";
    banner.classList.add("show");
  }
}

window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

// ==================== SERVICE WORKER ====================
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(console.error);
}

// ==================== GPS LOCATE ====================
map.on("locationfound", e => {
  L.marker(e.latlng).addTo(map).bindPopup("📍 Você está aqui").openPopup();
  map.setView(e.latlng, 15);
});
map.locate({ watch: false });
