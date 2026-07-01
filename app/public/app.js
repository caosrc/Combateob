// ==================== AUTH ====================
const token = localStorage.getItem("token");
if (!token) window.location.href = "/login.html";

function atualizarBadgeEquipe() {
  const nomeEquipe = document.getElementById("nomeEquipe");
  const badge = document.getElementById("user-badge");
  if (nomeEquipe && nomeEquipe.value.trim()) {
    badge.textContent = "Equipe " + nomeEquipe.value.trim();
  } else {
    badge.textContent = "Equipe " + (localStorage.getItem("team") || "–");
  }
}

atualizarBadgeEquipe();

function logout() {
  localStorage.clear();
  window.location.href = "/login.html";
}

// ==================== TABS ====================
let currentTab = "registrar";
let mapInitialized = false;
let drawMapInitialized = false;

function switchTab(tab) {
  document.querySelectorAll(".tab-content").forEach(el => el.style.display = "none");
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));

  document.getElementById("tab-" + tab).style.display = "flex";
  document.getElementById("nav-" + tab).classList.add("active");
  currentTab = tab;

  if (tab === "mapa") {
    initMainMap();
  }
  if (tab === "dashboard") {
    loadDashboard();
  }
}

function toggleSobre() {
  const body = document.getElementById("sobre-body");
  const chevron = document.getElementById("sobre-chevron");
  const open = body.style.display !== "none";
  body.style.display = open ? "none" : "block";
  chevron.textContent = open ? "▼" : "▲";
}

// ==================== TOGGLES ====================
const toggleState = { local: null, uc: null, alim: null };

function setToggle(group, value) {
  toggleState[group] = value;
  const buttons = document.querySelectorAll(`[id^="${group}-"]`);
  buttons.forEach(b => b.classList.remove("active"));
  const el = document.getElementById(group + "-" + value);
  if (el) el.classList.add("active");
}

// ==================== CHIPS DETECÇÃO ====================
const selectedChips = new Set();

function toggleChip(btn, value) {
  if (selectedChips.has(value)) {
    selectedChips.delete(value);
    btn.classList.remove("active");
  } else {
    selectedChips.add(value);
    btn.classList.add("active");
  }
  const outroInput = document.getElementById("formaOutro");
  if (selectedChips.has("Outro")) {
    outroInput.style.display = "block";
  } else {
    outroInput.style.display = "none";
  }
}

// ==================== COORDENADAS DO LOCAL ====================
let coordCapturada = { lat: null, lng: null, coordStr: null };

function decimalParaGMS(decimal, isLat) {
  const abs = Math.abs(decimal);
  const graus = Math.floor(abs);
  const minFrac = (abs - graus) * 60;
  const min = Math.floor(minFrac);
  const seg = ((minFrac - min) * 60).toFixed(1);
  const dir = isLat
    ? (decimal >= 0 ? "N" : "S")
    : (decimal >= 0 ? "L" : "O");
  return `${graus}°${String(min).padStart(2,"0")}'${String(seg).padStart(4,"0")}"${dir}`;
}

function capturarGPS() {
  if (!navigator.geolocation) { alert("Geolocalização não suportada."); return; }
  const btn = document.querySelector(".btn-gps-capture");
  btn.innerHTML = "<span>📡</span> Obtendo GPS...";
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    const gmsLat = decimalParaGMS(lat, true);
    const gmsLng = decimalParaGMS(lng, false);
    const coordStr = `${gmsLat}  ${gmsLng}`;
    coordCapturada = { lat, lng, coordStr };
    const el = document.getElementById("gps-coord-result");
    el.style.display = "block";
    el.innerHTML = `✅ ${gmsLat} &nbsp;|&nbsp; ${gmsLng}`;
    btn.innerHTML = "<span>📡</span> Ativar GPS";
    btn.disabled = false;
  }, err => {
    alert("Erro ao obter GPS: " + err.message);
    btn.innerHTML = "<span>📡</span> Ativar GPS";
    btn.disabled = false;
  }, { enableHighAccuracy: true, timeout: 15000 });
}

// ==================== MAP PRINCIPAL (aba Mapa) ====================
let mainMap = null;
let fireLayerGroup = null;
let osmLayer = null;
let satLayer = null;

function initMainMap() {
  if (mapInitialized) {
    setTimeout(() => mainMap.invalidateSize(), 100);
    return;
  }
  osmLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap", maxZoom: 19, crossOrigin: "anonymous"
  });
  satLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "© Esri World Imagery", maxZoom: 19, crossOrigin: "anonymous" }
  );
  mainMap = L.map("map", { layers: [osmLayer] }).setView([-20.52, -43.69], 12);
  L.control.layers(
    { "🗺️ Mapa": osmLayer, "🛰️ Satélite": satLayer },
    {},
    { position: "topright" }
  ).addTo(mainMap);
  fireLayerGroup = L.featureGroup().addTo(mainMap);
  mapInitialized = true;
  loadFiresOnMap();
}

let gpsMapMarker = null;
let gpsWatchId = null;
let gpsAtivo = false;
let gpsPrimeiraFix = false;

function toggleGPSMapa() {
  if (!mainMap) return;
  if (!navigator.geolocation) { alert("Geolocalização não suportada neste dispositivo."); return; }
  const btn = document.getElementById("map-gps-btn");
  const icon = document.getElementById("map-gps-icon");

  if (gpsAtivo) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
    gpsAtivo = false;
    gpsPrimeiraFix = false;
    if (gpsMapMarker) { mainMap.removeLayer(gpsMapMarker); gpsMapMarker = null; }
    btn.classList.remove("gps-on");
    icon.textContent = "📍";
    return;
  }

  gpsAtivo = true;
  gpsPrimeiraFix = false;
  btn.classList.add("gps-on");
  icon.textContent = "⏳";

  gpsWatchId = navigator.geolocation.watchPosition(
    pos => {
      if (!gpsAtivo) return;
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;

      if (!gpsPrimeiraFix) {
        mainMap.setView([lat, lng], 16);
        gpsPrimeiraFix = true;
        icon.textContent = "📡";
      }

      if (gpsMapMarker) mainMap.removeLayer(gpsMapMarker);
      gpsMapMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: "",
          html: `<div class="gps-dot"></div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        }),
        zIndexOffset: 1000
      }).addTo(mainMap);
      gpsMapMarker.bindPopup(`<b>📡 GPS Ativo</b><br>Precisão: ±${accuracy.toFixed(0)} m`);
    },
    err => {
      if (!gpsAtivo) return;
      gpsAtivo = false;
      gpsWatchId = null;
      gpsPrimeiraFix = false;
      btn.classList.remove("gps-on");
      icon.textContent = "📍";
      if (err.code !== 1) alert("Erro de GPS: " + err.message);
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
  );
}

async function loadFiresOnMap() {
  if (!mainMap || !fireLayerGroup) return;
  fireLayerGroup.clearLayers();
  try {
    const res = await fetch("/dashboard");
    const data = await res.json();
    (data.rows || []).forEach(r => {
      const d = (() => { try { return JSON.parse(r.data); } catch { return {}; } })();
      let poly = (() => { try { return JSON.parse(r.polygon || "[]"); } catch { return []; } })();
      if (poly.length > 0 && Array.isArray(poly[0]) && Array.isArray(poly[0][0])) poly = poly[0];
      const info = `<b>Incêndio #${r.id}</b><br>
        Município: ${d.municipio || "–"}<br>
        Equipe: ${r.team}<br>
        Área: ${r.area ? r.area.toFixed(4) + " ha" : "–"}<br>
        Data: ${new Date(r.createdAt).toLocaleString("pt-BR")}<br>
        Causa: ${d.causa || "–"}`;
      if (poly.length >= 3) {
        const latlngs = poly.map(([lng, lat]) => [lat, lng]);
        const polygon = L.polygon(latlngs, { color: "#c0392b", weight: 2, fillOpacity: 0.3, fillColor: "#e74c3c" });
        polygon.bindPopup(info);
        fireLayerGroup.addLayer(polygon);
      } else if (d.lat && d.lng) {
        const marker = L.circleMarker([d.lat, d.lng], { radius: 4, color: "#c0392b", fillColor: "#e74c3c", fillOpacity: 0.6 });
        marker.bindPopup(info);
        fireLayerGroup.addLayer(marker);
      }
    });
    if (fireLayerGroup.getLayers().length > 0) {
      mainMap.fitBounds(fireLayerGroup.getBounds(), { padding: [40, 40] });
    }
  } catch (e) { console.log("Erro ao carregar mapa:", e); }
}

// ==================== MAPA DE DESENHO (no mapa principal) ====================
let currentPolygon = null;
let drawMainItems = null;
let modoDesenhoAtivo = false;
let polygonHandler = null;
let isDrawingPolygon = false;
let mapSnapshotData = null;

function abrirMapaDesenho() {
  switchTab("mapa");
  setTimeout(() => {
    mainMap.invalidateSize();
    if (osmLayer && satLayer && mainMap.hasLayer(osmLayer)) {
      mainMap.removeLayer(osmLayer);
      mainMap.addLayer(satLayer);
    }
    if (coordCapturada.lat) {
      mainMap.setView([coordCapturada.lat, coordCapturada.lng], 16);
    } else {
      mainMap.setView([-20.52, -43.69], 13);
    }
    if (!gpsAtivo) toggleGPSMapa();
    iniciarDesenhoNoMapaPrincipal();
  }, 400);
}

function iniciarDesenhoNoMapaPrincipal() {
  if (!mainMap) return;
  modoDesenhoAtivo = true;

  if (!drawMainItems) {
    drawMainItems = new L.FeatureGroup();
    mainMap.addLayer(drawMainItems);
  }

  mainMap.off("draw:created").on("draw:created", function(e) {
    drawMainItems.clearLayers();
    drawMainItems.addLayer(e.layer);
    let latlngs = e.layer.getLatLngs()[0];
    if (latlngs[0] && Array.isArray(latlngs[0])) latlngs = latlngs[0];
    currentPolygon = latlngs.map(p => [p.lng, p.lat]);
    isDrawingPolygon = false;
    atualizarBtnDesenhar();
  });

  document.getElementById("map-draw-confirm").style.display = "flex";
}

function toggleDesenharPoligono() {
  if (!mainMap) return;
  if (!drawMainItems) {
    drawMainItems = new L.FeatureGroup();
    mainMap.addLayer(drawMainItems);
  }
  if (isDrawingPolygon) {
    if (polygonHandler) polygonHandler.disable();
    drawMainItems.clearLayers();
    currentPolygon = null;
    isDrawingPolygon = false;
  } else {
    if (!polygonHandler) {
      polygonHandler = new L.Draw.Polygon(mainMap, {
        allowIntersection: false,
        showArea: true,
        shapeOptions: { color: "#ff4444", weight: 2, fillOpacity: 0.2 }
      });
    }
    polygonHandler.enable();
    isDrawingPolygon = true;
  }
  atualizarBtnDesenhar();
}

function atualizarBtnDesenhar() {
  const btn = document.getElementById("btn-desenhar");
  if (!btn) return;
  if (isDrawingPolygon) {
    btn.textContent = "✋ Parar Desenho";
    btn.classList.add("btn-desenhar-ativo");
  } else {
    btn.textContent = "✏️ Desenhar Polígono";
    btn.classList.remove("btn-desenhar-ativo");
  }
}

async function captureMapSnapshot() {
  try {
    if (!mainMap || !currentPolygon || currentPolygon.length < 3) return null;
    const latlngs = currentPolygon.map(([lng, lat]) => [lat, lng]);
    mainMap.fitBounds(latlngs, { padding: [50, 50], animate: false });
    await new Promise(r => setTimeout(r, 600));

    const container = mainMap.getContainer();
    const size = mainMap.getSize();
    const canvas = document.createElement("canvas");
    canvas.width = size.x;
    canvas.height = size.y;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#aaa";
    ctx.fillRect(0, 0, size.x, size.y);

    const tiles = container.querySelectorAll(".leaflet-tile");
    for (const img of tiles) {
      if (!img.complete || !img.naturalWidth) continue;
      const rect = img.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      try { ctx.drawImage(img, rect.left - cRect.left, rect.top - cRect.top, rect.width, rect.height); } catch(_) {}
    }

    // Polígono vermelho
    ctx.beginPath();
    ctx.strokeStyle = "#ff2222";
    ctx.fillStyle = "rgba(255, 50, 50, 0.25)";
    ctx.lineWidth = 3;
    currentPolygon.forEach(([lng, lat], i) => {
      const pt = mainMap.latLngToContainerPoint([lat, lng]);
      if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Vértices
    ctx.fillStyle = "#ff2222";
    currentPolygon.forEach(([lng, lat]) => {
      const pt = mainMap.latLngToContainerPoint([lat, lng]);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      ctx.fill();
    });

    return canvas.toDataURL("image/jpeg", 0.75);
  } catch(e) {
    console.warn("Snapshot falhou:", e);
    return null;
  }
}

async function confirmarDesenhoMapaPrincipal() {
  if (!currentPolygon || currentPolygon.length < 3) {
    alert("Desenhe um polígono no mapa antes de confirmar.");
    return;
  }
  if (polygonHandler) { polygonHandler.disable(); }
  isDrawingPolygon = false;

  const btnConf = document.querySelector("#map-draw-confirm .btn-primary");
  if (btnConf) { btnConf.textContent = "⏳ Capturando..."; btnConf.disabled = true; }
  mapSnapshotData = await captureMapSnapshot();
  if (btnConf) { btnConf.textContent = "✅ Confirmar Área"; btnConf.disabled = false; }

  encerrarModoDesenho();
  atualizarAreaDisplay();
  switchTab("registrar");
}

function encerrarModoDesenho() {
  if (polygonHandler) { polygonHandler.disable(); polygonHandler = null; }
  isDrawingPolygon = false;
  document.getElementById("map-draw-confirm").style.display = "none";
  modoDesenhoAtivo = false;
}

// ==================== MODO GPS (polígono) ====================
let gpsAreaWatchId = null;
let gpsPoints = [];
let gpsMarkers = [];
let gpsPolyline = null;

function ativarModo(modo) {
  desativarModoAtual();
  document.querySelectorAll(".btn-area-mode").forEach(b => b.classList.remove("active"));
  if (modo === "gps") {
    document.getElementById("btn-modo-gps").classList.add("active");
    document.getElementById("gps-panel").style.display = "block";
    ativarGPS();
  } else if (modo === "coords") {
    document.getElementById("btn-modo-coords").classList.add("active");
    document.getElementById("coords-panel").style.display = "block";
    ativarCoordenadas();
  }
}

function desativarModoAtual() {
  pararGPS();
  document.getElementById("gps-panel").style.display = "none";
  document.getElementById("coords-panel").style.display = "none";
  document.querySelectorAll(".btn-area-mode").forEach(b => b.classList.remove("active"));
}

function ativarGPS() {
  gpsPoints = []; gpsMarkers = [];
  document.getElementById("gps-points-count").textContent = "0 pontos";
  document.getElementById("gps-status-text").textContent = "Aguardando GPS...";
  if (!navigator.geolocation) { alert("Geolocalização não suportada."); return; }
  gpsAreaWatchId = navigator.geolocation.watchPosition(
    pos => {
      const { latitude, longitude, accuracy } = pos.coords;
      document.getElementById("gps-status-text").textContent =
        `📍 ${latitude.toFixed(5)}, ${longitude.toFixed(5)} (±${accuracy.toFixed(0)}m)`;
      if (gpsPoints.length === 0 || distanciaMetros(gpsPoints[gpsPoints.length - 1], [latitude, longitude]) > 5) {
        adicionarPontoGPS(latitude, longitude);
      }
    },
    err => { document.getElementById("gps-status-text").textContent = "❌ " + err.message; },
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
  document.getElementById("gps-points-count").textContent = `${gpsPoints.length} ponto(s)`;
}

function adicionarPontoGPSManual() {
  navigator.geolocation.getCurrentPosition(pos => {
    adicionarPontoGPS(pos.coords.latitude, pos.coords.longitude);
  }, () => alert("Não foi possível obter a posição."), { enableHighAccuracy: true });
}

function pararGPS() {
  if (gpsAreaWatchId !== null) {
    navigator.geolocation.clearWatch(gpsAreaWatchId);
    gpsAreaWatchId = null;
  }
  if (gpsPoints.length >= 3) {
    currentPolygon = gpsPoints.map(([lat, lng]) => [lng, lat]);
    atualizarAreaDisplay();
    document.getElementById("gps-panel").style.display = "none";
  }
}

// ==================== MODO COORDENADAS ====================
let coordsManual = [];

function ativarCoordenadas() {
  coordsManual = [];
  renderizarListaCoords();
}

function dmsParaDecimal(g, m, s, dir) {
  const dec = Math.abs(parseFloat(g) || 0) + (parseFloat(m) || 0) / 60 + (parseFloat(s) || 0) / 3600;
  return (dir === "S" || dir === "O" || dir === "W") ? -dec : dec;
}

function decimalParaDMS(dec, isLng) {
  const neg = dec < 0;
  const abs = Math.abs(dec);
  const g = Math.floor(abs);
  const mf = (abs - g) * 60;
  const m = Math.floor(mf);
  const sf = ((mf - m) * 60).toFixed(2);
  const dir = isLng ? (neg ? "O" : "L") : (neg ? "S" : "N");
  return `${g}°${m}'${sf}"${dir}`;
}

function adicionarCoordenada() {
  const latG = document.getElementById("lat-g").value;
  const latM = document.getElementById("lat-m").value;
  const latS = document.getElementById("lat-s").value;
  const latDir = document.getElementById("lat-dir").value;
  const lngG = document.getElementById("lng-g").value;
  const lngM = document.getElementById("lng-m").value;
  const lngS = document.getElementById("lng-s").value;
  const lngDir = document.getElementById("lng-dir").value;

  if (latG === "" || lngG === "") { alert("Preencha os graus de Latitude e Longitude."); return; }

  const lat = dmsParaDecimal(latG, latM, latS, latDir);
  const lng = dmsParaDecimal(lngG, lngM, lngS, lngDir);
  if (isNaN(lat) || isNaN(lng)) { alert("Coordenadas inválidas."); return; }

  coordsManual.push([lat, lng]);
  ["lat-g","lat-m","lat-s","lng-g","lng-m","lng-s"].forEach(id => document.getElementById(id).value = "");
  renderizarListaCoords();
}

function renderizarListaCoords() {
  const el = document.getElementById("coords-lista");
  if (coordsManual.length === 0) { el.textContent = "Nenhum ponto adicionado."; return; }
  el.innerHTML = coordsManual.map((c, i) =>
    `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #eee;">
      <span>📍 ${i+1}: ${decimalParaDMS(c[0], false)} / ${decimalParaDMS(c[1], true)}</span>
      <span style="cursor:pointer;color:#c0392b;padding:0 4px;" onclick="removerCoord(${i})">✕</span>
    </div>`
  ).join("");
}

function removerCoord(i) { coordsManual.splice(i, 1); renderizarListaCoords(); }
function fecharCoordsPanel() {
  document.getElementById("coords-panel").style.display = "none";
  document.getElementById("btn-modo-coords").classList.remove("active");
}

function finalizarCoordenadas() {
  if (coordsManual.length < 3) { alert("Adicione pelo menos 3 pontos."); return; }
  currentPolygon = coordsManual.map(([lat, lng]) => [lng, lat]);
  atualizarAreaDisplay();
  fecharCoordsPanel();
}

// ==================== ÁREA DISPLAY ====================
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
  currentPolygon = null;
  gpsPoints = []; coordsManual = [];
  gpsMarkers.forEach(m => { if (mainMap) mainMap.removeLayer(m); });
  if (gpsPolyline && mainMap) mainMap.removeLayer(gpsPolyline);
  gpsMarkers = []; gpsPolyline = null;
  if (drawMainItems) drawMainItems.clearLayers();
  resetAreaDisplay();
  desativarModoAtual();
}

// ==================== FOTOS ====================
let fotosCapturadas = [];

async function comprimirFoto(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        let w = img.width, h = img.height;
        if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);

        // Marca d'água: data/hora + GPS na parte inferior direita
        const now = new Date();
        const dateStr = now.toLocaleString("pt-BR");
        let gpsStr = "";
        if (coordCapturada.lat && coordCapturada.lng) {
          gpsStr = `\n${decimalParaGMS(coordCapturada.lat, true)}  ${decimalParaGMS(coordCapturada.lng, false)}`;
        }
        const linhas = (dateStr + gpsStr).split("\n");
        const fs = Math.max(11, Math.round(w / 45));
        ctx.font = `bold ${fs}px Arial`;
        const pad = 6;
        const lh = fs * 1.35;
        const boxH = linhas.length * lh + pad * 2;
        const boxW = Math.max(...linhas.map(l => ctx.measureText(l).width)) + pad * 2;
        const bx = w - boxW - 6;
        const by = h - boxH - 6;
        ctx.fillStyle = "rgba(0,0,0,0.52)";
        ctx.fillRect(bx, by, boxW, boxH);
        ctx.fillStyle = "#fff";
        ctx.textAlign = "left";
        linhas.forEach((ln, i) => ctx.fillText(ln, bx + pad, by + pad + (i + 1) * lh - 3));

        resolve(canvas.toDataURL("image/jpeg", 0.65));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function adicionarFotos(input) {
  const files = Array.from(input.files);
  for (const file of files) {
    if (fotosCapturadas.length >= 20) { alert("Máximo de 20 fotos."); break; }
    const b64 = await comprimirFoto(file);
    fotosCapturadas.push(b64);
  }
  input.value = "";
  renderFotoPreview();
}

function removerFoto(idx) {
  fotosCapturadas.splice(idx, 1);
  renderFotoPreview();
}

function renderFotoPreview() {
  const grid = document.getElementById("fotos-preview");
  if (!grid) return;
  grid.innerHTML = "";
  fotosCapturadas.forEach((src, i) => {
    const div = document.createElement("div");
    div.className = "foto-thumb";
    div.innerHTML = `<img src="${src}" alt="Foto ${i+1}"><button class="foto-remove" onclick="removerFoto(${i})">✕</button><span class="foto-num">${i+1}</span>`;
    grid.appendChild(div);
  });
  const cnt = document.getElementById("fotos-count");
  if (cnt) cnt.textContent = fotosCapturadas.length > 0 ? `${fotosCapturadas.length} foto(s) selecionada(s)` : "";
}

// ==================== SIGNATURE ====================
let sigCanvas, sigCtx, sigDrawing = false;

function initSignature() {
  sigCanvas = document.getElementById("signature-canvas");
  sigCtx = sigCanvas.getContext("2d");
  sigCtx.lineWidth = 2; sigCtx.lineCap = "round"; sigCtx.strokeStyle = "#000";
  sigCanvas.addEventListener("mousedown", e => { sigDrawing = true; sigCtx.beginPath(); sigCtx.moveTo(getPos(e).x, getPos(e).y); });
  sigCanvas.addEventListener("mousemove", e => { if (!sigDrawing) return; sigCtx.lineTo(getPos(e).x, getPos(e).y); sigCtx.stroke(); });
  sigCanvas.addEventListener("mouseup", () => sigDrawing = false);
  sigCanvas.addEventListener("mouseleave", () => sigDrawing = false);
  sigCanvas.addEventListener("touchstart", e => { e.preventDefault(); sigDrawing = true; sigCtx.beginPath(); const t = getTouch(e); sigCtx.moveTo(t.x, t.y); }, { passive: false });
  sigCanvas.addEventListener("touchmove", e => { e.preventDefault(); if (!sigDrawing) return; const t = getTouch(e); sigCtx.lineTo(t.x, t.y); sigCtx.stroke(); }, { passive: false });
  sigCanvas.addEventListener("touchend", () => sigDrawing = false);
}

function getPos(e) { const r = sigCanvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function getTouch(e) { const r = sigCanvas.getBoundingClientRect(); const t = e.touches[0]; return { x: t.clientX - r.left, y: t.clientY - r.top }; }
function clearSignature() { if (sigCtx) sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height); }
function getSignatureData() { if (!sigCanvas) return null; return sigCanvas.toDataURL("image/png"); }

initSignature();

// ==================== MODAL ====================
function openSaveModal() {
  if (!currentPolygon || currentPolygon.length < 3) {
    alert("Marque a área queimada antes de registrar.\n\nUse: Desenhar no Mapa, Rastrear por GPS ou Por Coordenadas.");
    return;
  }
  const ha = calcularHectares(currentPolygon);
  document.getElementById("modal-area").textContent = ha.toFixed(4) + " ha";
  document.getElementById("save-modal").classList.add("active");
}

function closeModal() {
  document.getElementById("save-modal").classList.remove("active");
}

// ==================== SALVAR INCÊNDIO ====================
async function salvarIncendio() {
  if (!currentPolygon || currentPolygon.length < 3) { alert("Polígono inválido."); return; }

  const formaDeteccao = Array.from(selectedChips).join(", ") +
    (selectedChips.has("Outro") && document.getElementById("formaOutro").value
      ? " (" + document.getElementById("formaOutro").value + ")"
      : "");

  const data = {
    brigadista: document.getElementById("brigadista").value.trim(),
    nomeEquipe: document.getElementById("nomeEquipe").value.trim(),
    brigadistas: document.getElementById("brigadistas").value.trim(),
    municipio: document.getElementById("municipio").value.trim(),
    lat: coordCapturada.lat,
    lng: coordCapturada.lng,
    coordStr: coordCapturada.coordStr,
    localReferencia: document.getElementById("localReferencia").value.trim(),
    local: toggleState.local,
    uc: toggleState.uc,
    dataDeteccao: document.getElementById("dataDeteccao").value,
    horaDeteccao: document.getElementById("horaDeteccao").value,
    formaDeteccao,
    nomeContato: document.getElementById("nomeContato").value.trim(),
    orgaoContato: document.getElementById("orgaoContato").value.trim(),
    telefoneContato: document.getElementById("telefoneContato").value.trim(),
    inicioData: document.getElementById("inicioData").value,
    inicioHora: document.getElementById("inicioHora").value,
    descricao: document.getElementById("descricao").value.trim(),
    pessoal: document.getElementById("pessoal").value.trim(),
    veiculos: document.getElementById("veiculos").value.trim(),
    debeladoData: document.getElementById("debeladoData").value,
    debeladoHora: document.getElementById("debeladoHora").value,
    alimentacao: toggleState.alim,
    causa: document.getElementById("causa").value
  };

  const fireData = { data, polygon: currentPolygon, signature: getSignatureData(), photos: fotosCapturadas, mapSnapshot: mapSnapshotData };

  if (navigator.onLine) {
    try {
      const res = await fetch("/fire", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": token },
        body: JSON.stringify(fireData)
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => res.status);
        alert(`❌ Erro do servidor (${res.status}).\n${String(txt).substring(0,200)}`);
        return;
      }
      const r = await res.json();
      if (r.error) { alert("❌ Erro: " + r.error); return; }
      closeModal();
      alert(`✅ Incêndio registrado!\nÁrea: ${r.area.toFixed(4)} ha\nID: #${r.id}`);
      limparFormulario();
      if (mapInitialized) loadFiresOnMap();
    } catch (e) {
      // Erro de rede real — salvar offline
      await savePendingFire(fireData);
      closeModal();
      alert("⚠️ Falha na conexão. Registro salvo localmente e será sincronizado quando a conexão for restaurada.");
      updatePendingCount();
    }
  } else {
    await savePendingFire(fireData);
    closeModal();
    alert("📴 Modo offline. Registro salvo localmente e será sincronizado quando a conexão for restaurada.");
    updatePendingCount();
  }
}

function limparFormulario() {
  fotosCapturadas = [];
  renderFotoPreview();
  ["brigadista","nomeEquipe","brigadistas","municipio","localReferencia",
   "nomeContato","orgaoContato","telefoneContato",
   "inicioData","inicioHora","descricao","pessoal","veiculos","debeladoData","debeladoHora",
   "dataDeteccao","horaDeteccao","formaOutro","causa"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  selectedChips.clear();
  document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
  document.getElementById("formaOutro").style.display = "none";
  toggleState.local = null; toggleState.uc = null; toggleState.alim = null;
  document.querySelectorAll(".toggle-btn").forEach(b => b.classList.remove("active"));
  coordCapturada = { lat: null, lng: null, coordStr: null };
  const gpsRes = document.getElementById("gps-coord-result");
  if (gpsRes) gpsRes.style.display = "none";
  clearDrawing();
  clearSignature();
}

// ==================== DASHBOARD ====================
async function loadDashboard() {
  try {
    const res = await fetch("/dashboard");
    const data = await res.json();
    document.getElementById("total-fires").textContent = data.total;
    document.getElementById("total-area").textContent = (data.areaTotal || 0).toFixed(2);
    const now = new Date();
    const thisMonth = (data.rows || []).filter(r => {
      const d = new Date(r.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    document.getElementById("this-month").textContent = thisMonth;
    document.getElementById("avg-area").textContent = data.total > 0 ? (data.areaTotal / data.total).toFixed(2) : "0.00";

    const tbody = document.getElementById("fires-tbody");
    if (!data.rows || data.rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#666;padding:24px;">Nenhum incêndio registrado.</td></tr>';
      return;
    }
    tbody.innerHTML = data.rows.map(r => {
      const d = (() => { try { return JSON.parse(r.data); } catch { return {}; } })();
      const nomeEquipe = d.nomeEquipe || r.team || "–";
      return `<tr>
        <td>#${r.id}</td>
        <td>${new Date(r.createdAt).toLocaleString("pt-BR")}</td>
        <td title="${nomeEquipe}">${nomeEquipe}</td>
        <td title="${d.municipio || "–"}">${d.municipio || "–"}</td>
        <td>${r.area ? r.area.toFixed(2) : "N/A"}</td>
        <td><a href="/report/${r.id}" target="_blank" class="btn btn-sm btn-secondary">📄 PDF</a></td>
      </tr>`;
    }).join("");
  } catch (e) { console.error(e); }
}

async function exportarExcel() {
  const btn = document.querySelector(".btn-export.excel");
  if (btn) { btn.textContent = "⏳ Gerando..."; btn.disabled = true; }
  try {
    const res = await fetch("/export/excel", { headers: { "Authorization": token } });
    if (!res.ok) throw new Error("Erro " + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const hoje = new Date().toISOString().slice(0,10);
    a.href = url; a.download = `incendios-brigada-${hoje}.xlsx`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  } catch (e) { alert("Erro ao gerar Excel: " + e.message); }
  finally { if (btn) { btn.textContent = "📊 Excel"; btn.disabled = false; } }
}

async function exportarKMZ() {
  const btn = document.querySelector(".btn-export.kmz");
  if (btn) { btn.textContent = "⏳ Gerando..."; btn.disabled = true; }
  try {
    const res = await fetch("/export/kmz", { headers: { "Authorization": token } });
    if (!res.ok) throw new Error("Erro " + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const hoje = new Date().toISOString().slice(0,10);
    a.href = url; a.download = `incendios-brigada-${hoje}.kmz`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  } catch (e) { alert("Erro ao gerar KMZ: " + e.message); }
  finally { if (btn) { btn.textContent = "🌍 KMZ"; btn.disabled = false; } }
}

// ==================== SYNC ====================
async function syncData() {
  if (!navigator.onLine) { document.getElementById("sync-btn").textContent = "❌ Sem conexão"; return; }
  document.getElementById("sync-btn").textContent = "⏳ Sincronizando...";
  const synced = await syncPendingFires(token);
  document.getElementById("sync-btn").textContent = synced > 0 ? `✅ ${synced} sincronizado(s)` : "✅ Ok";
  setTimeout(() => { document.getElementById("sync-btn").textContent = "⬆️ Sincronizar"; }, 3000);
  updatePendingCount();
}

async function updatePendingCount() {
  const pending = await getPendingFires();
  document.getElementById("pending-count").textContent =
    pending.length > 0 ? `${pending.length} pendente(s)` : "";
}

updatePendingCount();

// ==================== ONLINE/OFFLINE ====================
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

// ==================== EXPORT TOKEN QUERY ====================
// Permite exports via query string
const origFetch = window.fetch;

// ==================== SERVICE WORKER + PWA INSTALL ====================
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(console.error);
}

let _deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  // Mostra banner de instalação
  const banner = document.getElementById("pwa-install-banner");
  if (banner) banner.style.display = "flex";
});

function instalarPWA() {
  if (!_deferredInstallPrompt) return;
  _deferredInstallPrompt.prompt();
  _deferredInstallPrompt.userChoice.then(() => {
    _deferredInstallPrompt = null;
    const banner = document.getElementById("pwa-install-banner");
    if (banner) banner.style.display = "none";
  });
}

function fecharBannerPWA() {
  const banner = document.getElementById("pwa-install-banner");
  if (banner) banner.style.display = "none";
}

window.addEventListener("appinstalled", () => {
  const banner = document.getElementById("pwa-install-banner");
  if (banner) banner.style.display = "none";
});

// ==================== INIT ====================
// Datas padrão
const hoje = new Date().toISOString().split("T")[0];
document.getElementById("dataDeteccao").value = hoje;
const agora = new Date().toTimeString().slice(0,5);
document.getElementById("horaDeteccao").value = agora;

// Inicializar primeira aba
document.getElementById("tab-registrar").style.display = "flex";
