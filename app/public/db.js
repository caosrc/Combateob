const DB_NAME = "IncendioV3";
const DB_VERSION = 3;
let idb;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("pending_fires")) {
        db.createObjectStore("pending_fires", { keyPath: "localId", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("streets_data")) {
        db.createObjectStore("streets_data", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("dashboard_cache")) {
        db.createObjectStore("dashboard_cache", { keyPath: "id" });
      }
    };
    req.onsuccess = e => { idb = e.target.result; resolve(idb); };
    req.onerror = e => reject(e.target.error);
  });
}

// ==================== RUAS OFFLINE (busca de endereço) ====================
async function saveStreetsIndex(features) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("streets_data", "readwrite");
    tx.objectStore("streets_data").put({ id: 1, features, savedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getStreetsIndex() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("streets_data", "readonly");
    const req = tx.objectStore("streets_data").get(1);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// ==================== CACHE DO DASHBOARD ====================
async function saveDashboardCache(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("dashboard_cache", "readwrite");
    tx.objectStore("dashboard_cache").put({ id: 1, data, savedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getDashboardCache() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("dashboard_cache", "readonly");
    const req = tx.objectStore("dashboard_cache").get(1);
    req.onsuccess = () => resolve(req.result ? req.result.data : null);
    req.onerror = () => reject(req.error);
  });
}

// ==================== INCÊNDIOS PENDENTES ====================
async function savePendingFire(fireData) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending_fires", "readwrite");
    const store = tx.objectStore("pending_fires");
    const req = store.add({ ...fireData, _ts: Date.now(), createdAt: new Date().toISOString() });
    req.onsuccess = () => resolve(req.result); // devolve o localId
    req.onerror = () => reject(req.error);
  });
}

async function getPendingFires() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending_fires", "readonly");
    const store = tx.objectStore("pending_fires");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function removePendingFire(localId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending_fires", "readwrite");
    const req = tx.objectStore("pending_fires").delete(localId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function clearPendingFires() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending_fires", "readwrite");
    const store = tx.objectStore("pending_fires");
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ==================== SYNC UM A UM ====================
// Envia cada pendente individualmente — remove só os que tiveram sucesso.
// Assim, se a rede cair a meio, os restantes ficam guardados.
async function syncPendingFires(token) {
  const pending = await getPendingFires();
  if (pending.length === 0) return 0;

  let synced = 0;

  for (const item of pending) {
    try {
      const { localId, _ts, ...fireData } = item;

      const res = await fetch("/fire", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": token },
        body: JSON.stringify(fireData)
      });

      // Se o servidor devolveu HTML (redirect/erro) em vez de JSON — não é sucesso
      const ct = res.headers.get("content-type") || "";
      if (!res.ok || ct.includes("text/html")) continue;

      const data = await res.json().catch(() => null);
      if (data && !data.error) {
        await removePendingFire(localId);
        synced++;
      }
    } catch (_) {
      // Sem rede — deixa para a próxima vez
    }
  }

  return synced;
}
