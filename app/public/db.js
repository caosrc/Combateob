const DB_NAME = "IncendioV3";
const DB_VERSION = 2;
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

async function savePendingFire(fireData) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending_fires", "readwrite");
    const store = tx.objectStore("pending_fires");
    const req = store.add({ ...fireData, createdAt: new Date().toISOString() });
    req.onsuccess = () => resolve(req.result);
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

async function syncPendingFires(token) {
  const pending = await getPendingFires();
  if (pending.length === 0) return 0;

  try {
    const res = await fetch("/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": token },
      body: JSON.stringify({ fires: pending })
    });
    const data = await res.json();
    if (data.ok) {
      await clearPendingFires();
      return data.synced;
    }
  } catch (e) {
    console.log("Sync falhou, dados mantidos offline:", e);
  }
  return 0;
}
