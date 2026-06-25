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
      shapeOptions: { color: "#ff4444", weight: 2 }
    },
    polyline: false,
    rectangle: { shapeOptions: { color: "#ff4444" } },
    circle: false,
    marker: false,
    circlemarker: false
  },
  edit: { featureGroup: drawnItems }
});
map.addControl(drawControl);

let currentPolygon = null;

map.on("draw:created", function(e) {
  drawnItems.clearLayers();
  drawnItems.addLayer(e.layer);
  currentPolygon = e.layer.getLatLngs()[0].map(p => [p.lng, p.lat]);
  updateCoordsDisplay();
  estimateArea();
});

map.on("draw:edited", function(e) {
  e.layers.eachLayer(layer => {
    currentPolygon = layer.getLatLngs()[0].map(p => [p.lng, p.lat]);
  });
  updateCoordsDisplay();
  estimateArea();
});

map.on("draw:deleted", function() {
  currentPolygon = null;
  document.getElementById("coords-display").textContent = "Nenhum polígono desenhado.";
});

function updateCoordsDisplay() {
  if (!currentPolygon) return;
  const el = document.getElementById("coords-display");
  el.textContent = `${currentPolygon.length} pontos definidos. Área em cálculo...`;
}

function estimateArea() {
  if (!currentPolygon || currentPolygon.length < 3) return;
  // rough client-side estimation using Shoelace formula
  let area = 0;
  const p = currentPolygon;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    area += p[i][0] * p[j][1];
    area -= p[j][0] * p[i][1];
  }
  const deg2 = Math.abs(area) / 2;
  // approximate: 1 degree² ≈ 12,308 km²
  const ha = deg2 * 1230800;
  document.getElementById("coords-display").textContent =
    `${currentPolygon.length} pontos – ~${ha.toFixed(2)} ha (estimativa)`;
}

function clearDrawing() {
  drawnItems.clearLayers();
  currentPolygon = null;
  document.getElementById("coords-display").textContent = "Nenhum polígono desenhado.";
}

function logout() {
  localStorage.clear();
  window.location.href = "/login.html";
}

// ==================== HEATMAP ====================
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

    if (points.length > 0 && L.heatLayer) {
      L.heatLayer(points, { radius: 30, blur: 15, maxZoom: 17 }).addTo(map);
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
    alert("Desenhe o polígono da área queimada no mapa primeiro.");
    return;
  }
  document.getElementById("modal-area").textContent = "Calculando...";
  document.getElementById("save-modal").classList.add("active");

  // Show estimated area
  fetch("/fire", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": token },
    body: JSON.stringify({
      data: { municipio: "preview", preview: true },
      polygon: currentPolygon
    })
  }).catch(() => {});
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
      if (r.error) {
        alert("Erro: " + r.error);
        return;
      }
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

      const marker = L.marker([latitude, longitude]).addTo(map);
      marker.bindPopup(`📸 Foto capturada aqui`).openPopup();
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
  if (!navigator.onLine) {
    document.getElementById("sync-status").textContent = "❌ Sem conexão";
    return;
  }
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

// ==================== OFFLINE DETECTION ====================
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
