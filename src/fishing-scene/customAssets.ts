const DB_NAME = 'lure-fishing-scene-assets';
const STORE_NAME = 'images';
const DB_VERSION = 1;

export type StoredSceneAsset = {
  id: string;
  name: string;
  type: string;
  blob: Blob;
};

function openAssetDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSceneAsset(file: File) {
  const asset: StoredSceneAsset = {
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type,
    blob: file,
  };
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(asset);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  return asset;
}

export async function loadSceneAssetUrls(assetIds: string[]) {
  const urls = new Map<string, string>();
  if (assetIds.length === 0) return urls;
  const db = await openAssetDb();
  await Promise.all([...new Set(assetIds)].map((id) => new Promise<void>((resolve) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
    request.onsuccess = () => {
      const asset = request.result as StoredSceneAsset | undefined;
      if (asset) urls.set(id, URL.createObjectURL(asset.blob));
      resolve();
    };
    request.onerror = () => resolve();
  })));
  db.close();
  return urls;
}

export async function deleteSceneAsset(assetId: string) {
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(assetId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}
