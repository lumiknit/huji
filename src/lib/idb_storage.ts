import { deleteDB, openDB } from "idb";

/**
 * AsyncStorage adapter backed by IndexedDB.
 * Compatible with @solid-primitives/storage makePersisted and localforage's API subset.
 */
export type IdbStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
};

const openStore = async (
  dbName: string,
  storeName: string,
  version: number,
) => {
  const db = await openDB(dbName, version, {
    upgrade(d) {
      for (const name of Array.from(d.objectStoreNames)) {
        d.deleteObjectStore(name);
      }
      d.createObjectStore(storeName);
    },
    blocking() {
      location.reload();
    },
  });

  // If the store is missing (broken DB state), nuke and recreate.
  if (!db.objectStoreNames.contains(storeName)) {
    db.close();
    await deleteDB(dbName);
    return openDB(dbName, version, {
      upgrade(d) {
        d.createObjectStore(storeName);
      },
    });
  }

  return db;
};

export const createIdbStorage = (
  dbName: string,
  storeName = "kv",
  version = 1,
): IdbStorage => {
  const dbPromise = openStore(dbName, storeName, version);

  return {
    getItem: async (key) => {
      const db = await dbPromise;
      const val: string | undefined = await db.get(storeName, key);
      return val ?? null;
    },
    setItem: async (key, value) => {
      const db = await dbPromise;
      await db.put(storeName, value, key);
    },
    removeItem: async (key) => {
      const db = await dbPromise;
      await db.delete(storeName, key);
    },
    clear: async () => {
      const db = await dbPromise;
      await db.clear(storeName);
    },
  };
};
