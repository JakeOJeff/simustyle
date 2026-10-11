export interface RecentSceneEntry {
  key: string;
  name: string;
  /** Native scene path, or null when this entry came from a browser file picker. */
  path: string | null;
  /** Original browser file name, used to identify a cached scene after reopening it. */
  sourceName?: string;
}

const RECENT_KEY = "simustyle.recentScenes";
const RECENT_LIMIT = 10;
const DATABASE_NAME = "simustyle-scene-cache";
const STORE_NAME = "scenes";

export function loadRecentScenes(): RecentSceneEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is RecentSceneEntry =>
      typeof entry?.key === "string" && typeof entry?.name === "string" &&
      (entry.path === null || typeof entry.path === "string") &&
      (entry.sourceName === undefined || typeof entry.sourceName === "string")
    ).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function saveRecentScenes(entries: RecentSceneEntry[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, RECENT_LIMIT)));
  } catch {
    // The current scene remains usable when browser storage is unavailable.
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Browser storage is unavailable for recently opened scenes."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open browser scene storage."));
  });
}

export async function cacheRecentScene(key: string, contents: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(contents, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not cache the scene."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not cache the scene."));
    });
  } finally {
    database.close();
  }
}

export async function readCachedRecentScene(key: string): Promise<string> {
  const database = await openDatabase();
  try {
    return await new Promise<string>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => typeof request.result === "string"
        ? resolve(request.result)
        : reject(new Error("That browser recent scene is no longer available. Use Open to choose the file again."));
      request.onerror = () => reject(request.error ?? new Error("Could not read the cached scene."));
    });
  } finally {
    database.close();
  }
}
