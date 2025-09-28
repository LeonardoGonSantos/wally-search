const DB_NAME = 'wallyFinder';
const DB_VERSION = 3;

let dbPromise = null;

export async function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('achados')) {
        db.createObjectStore('achados', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('banks')) {
        db.createObjectStore('banks', { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains('presetSamples')) {
        const store = db.createObjectStore('presetSamples', { keyPath: 'id', autoIncrement: true });
        store.createIndex('character', 'character', { unique: false });
      }
    };
  });
  return dbPromise;
}

export async function saveAchado(record) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('achados', 'readwrite');
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
    tx.objectStore('achados').put(record);
  });
}

export async function listAchados() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('achados', 'readonly');
    const request = tx.objectStore('achados').getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.timestamp - b.timestamp));
    request.onerror = () => reject(request.error);
  });
}

export async function deleteAchado(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('achados', 'readwrite');
    tx.objectStore('achados').delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function cacheBank(name, blob) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('banks', 'readwrite');
    tx.objectStore('banks').put({ name, blob });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getBank(name) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('banks', 'readonly');
    const request = tx.objectStore('banks').get(name);
    request.onsuccess = () => resolve(request.result?.blob ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function savePresetSample(sample) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('presetSamples', 'readwrite');
    const store = tx.objectStore('presetSamples');
    const request = store.add(sample);
    request.onsuccess = () => {
      const id = request.result;
      if (sample.id == null) {
        sample.id = id;
        store.put(sample);
      }
      resolve(id);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function listPresetSamples() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('presetSamples', 'readonly');
    const store = tx.objectStore('presetSamples');
    const request = store.getAll();
    request.onsuccess = async () => {
      const items = request.result ?? [];
      if (items.length && items[0].id == null) {
        const keys = await store.getAllKeys();
        items.forEach((item, index) => {
          item.id = keys[index];
        });
      }
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deletePresetSample(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('presetSamples', 'readwrite');
    tx.objectStore('presetSamples').delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearStore(name) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    tx.objectStore(name).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
