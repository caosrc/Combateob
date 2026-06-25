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

function capturarGPS() {
  if (!navigator.geolocation) { alert("Geolocalização não suportada."); return; }
  const btn = document.querySelector(".btn-gps-capture");
  btn.innerHTML = "<span>📡</span> Obtendo GPS...";
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    coordCapturada = { lat, lng, coordStr: `${lat.toFixed(6)}, ${lng.toFixed(6)}` };
    const el = document.getElementById("gps-coord-result");
    el.style.display = "block";
    el.innerHTML = `✅ ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
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

function initMainMap() {
  if (mapInitialized) {
    mainMap.invalidateSize();
    return;
  }
  mainMap = L.map("map").setView([-15.78, -47.93], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap"
  }).addTo(mainMap);
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "© Esri", opacity: 0 }
  );
  L.control.layers({
    "🗺️ OSM": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }),
    "🛰️ Satélite": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "© Esri" })
  }).addTo(mainMap);
  fireLayerGroup = L.featureGroup().addTo(mainMap);
  mapInitialized = true;
  loadFiresOnMap();
}

async function loadFiresOnMap() {
  if (!mainMap || !fireLayerGroup) return;
  fireLayerGroup.clearLayers();
  try {
    const res = await fetch("/dashboard");
    const data = await res.json();
    (data.rows || []).forEach(r => {
      const d = (() => { try { return JSON.parse(r.data); } catch { return {}; } })();
      const poly = (() => { try { return JSON.parse(r.polygon || "[]"); } catch { return []; } })();
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
        const marker = L.circleMarker([d.lat, d.lng], { radius: 8, color: "#c0392b", fillColor: "#e74c3c", fillOpacity: 0.8 });
        marker.bindPopup(info);
        fireLayerGroup.addLayer(marker);
      }
    });
    if (fireLayerGroup.getLayers().length > 0) {
      mainMap.fitBounds(fireLayerGroup.getBounds(), { padding: [40, 40] });
    }
  } catch (e) { console.log("Erro ao carregar mapa:", e); }
}

// ==================== MAPA DE DESENHO (modal) ====================
let drawMap = null;
let drawMapItems = null;
let drawControl = null;
let drawControlAdded = false;
let currentPolygon = null;

function abrirMapaDesenho() {
  document.getElementById("draw-map-modal").classList.add("active");
  setTimeout(() => {
    if (!drawMapInitialized) {
      const center = coordCapturada.lat
        ? [coordCapturada.lat, coordCapturada.lng]
        : [-15.78, -47.93];
      drawMap = L.map("draw-map").setView(center, coordCapturada.lat ? 15 : 5);
      const osmDraw = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" });
      const satDraw = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "© Esri" });
      satDraw.addTo(drawMap);
      L.control.layers({ "🛰️ Satélite": satDraw, "🗺️ OSM": osmDraw }).addTo(drawMap);
      drawMapItems = new L.FeatureGroup();
      drawMap.addLayer(drawMapItems);
      drawControl = new L.Control.Draw({
        draw: {
          polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: "#ff4444", weight: 2, fillOpacity: 0.2 } },
          polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false
        },
        edit: { featureGroup: drawMapItems }
      });
      drawMap.addControl(drawControl);
      drawControlAdded = true;
      drawMap.on("draw:created", function(e) {
        drawMapItems.clearLayers();
        drawMapItems.addLayer(e.layer);
        currentPolygon = e.layer.getLatLngs()[0].map(p => [p.lng, p.lat]);
      });
      drawMap.on("draw:edited", function(e) {
        e.layers.eachLayer(layer => { currentPolygon = layer.getLatLngs()[0].map(p => [p.lng, p.lat]); });
      });
      drawMap.on("draw:deleted", function() { currentPolygon = null; });

      // GPS locate
      if (coordCapturada.lat) {
        L.marker([coordCapturada.lat, coordCapturada.lng])
          .addTo(drawMap)
          .bindPopup("📍 Local do Incêndio")
          .openPopup();
      } else {
        drawMap.locate({ watch: false });
        drawMap.on("locationfound", e => {
          drawMap.setView(e.latlng, 15);
          L.marker(e.latlng).addTo(drawMap).bindPopup("📍 Sua posição");
        });
      }
      drawMapInitialized = true;
    } else {
      drawMap.invalidateSize();
    }
    // Inicia desenho automaticamente
    setTimeout(() => {
      const btn = document.querySelector("#draw-map-modal .leaflet-draw-draw-polygon");
      if (btn) btn.click();
    }, 300);
  }, 200);
}

function cancelarDesenhoMapa() {
  document.getElementById("draw-map-modal").classList.remove("active");
}

function confirmarDesenhoMapa() {
  if (!currentPolygon || currentPolygon.length < 3) {
    alert("Desenhe um polígono no mapa antes de confirmar.");
    return;
  }
  document.getElementById("draw-map-modal").classList.remove("active");
  atualizarAreaDisplay();
}

// ==================== MODO GPS (polígono) ====================
let gpsWatchId = null;
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
  gpsWatchId = navigator.geolocation.watchPosition(
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
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
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

function adicionarCoordenada() {
  const lat = parseFloat(document.getElementById("coord-lat").value);
  const lng = parseFloat(document.getElementById("coord-lng").value);
  if (isNaN(lat) || isNaN(lng)) { alert("Coordenadas inválidas."); return; }
  coordsManual.push([lat, lng]);
  document.getElementById("coord-lat").value = "";
  document.getElementById("coord-lng").value = "";
  renderizarListaCoords();
}

function renderizarListaCoords() {
  const el = document.getElementById("coords-lista");
  if (coordsManual.length === 0) { el.textContent = "Nenhum ponto adicionado."; return; }
  el.innerHTML = coordsManual.map((c, i) =>
    `<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #eee;">
      <span>📍 ${i+1}: ${c[0].toFixed(5)}, ${c[1].toFixed(5)}</span>
      <span style="cursor:pointer;color:#c0392b;" onclick="removerCoord(${i})">✕</span>
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
  if (drawMapItems) drawMapItems.clearLayers();
  resetAreaDisplay();
  desativarModoAtual();
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

  const fireData = { data, polygon: currentPolygon, signature: getSignatureData() };

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
      alert(`✅ Incêndio registrado!\nÁrea: ${r.area.toFixed(4)} ha\nID: #${r.id}`);
      limparFormulario();
      if (mapInitialized) loadFiresOnMap();
    } catch (e) {
      await savePendingFire(fireData);
      closeModal();
      alert("⚠️ Sem conexão. Salvo localmente.");
      updatePendingCount();
    }
  } else {
    await savePendingFire(fireData);
    closeModal();
    alert("⚠️ Modo offline. Salvo localmente.");
    updatePendingCount();
  }
}

function limparFormulario() {
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
  document.getElementById("gps-coord-result").style.display = "none";
  document.getElementById("dms-coord-result").style.display = "none";
  document.getElementById("dec-coord-result").style.display = "none";
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
      return `<tr>
        <td>#${r.id}</td>
        <td>${new Date(r.createdAt).toLocaleString("pt-BR")}</td>
        <td>${r.team}</td>
        <td>${d.municipio || "–"}</td>
        <td>${r.area ? r.area.toFixed(4) : "N/A"}</td>
        <td><a href="/report/${r.id}" target="_blank" class="btn btn-sm btn-secondary">📄 PDF</a></td>
      </tr>`;
    }).join("");
  } catch (e) { console.error(e); }
}

function exportarExcel() {
  window.open("/export/excel?token=" + token, "_blank");
}

function exportarKMZ() {
  window.open("/export/kmz?token=" + token, "_blank");
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

// ==================== SERVICE WORKER ====================
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(console.error);
}

// ==================== INIT ====================
// Datas padrão
const hoje = new Date().toISOString().split("T")[0];
document.getElementById("dataDeteccao").value = hoje;
const agora = new Date().toTimeString().slice(0,5);
document.getElementById("horaDeteccao").value = agora;

// Inicializar primeira aba
document.getElementById("tab-registrar").style.display = "flex";
