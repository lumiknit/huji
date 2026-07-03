import { openDB, type IDBPDatabase } from "idb";
import type { HujiDB } from "./schema";

let _dbPromise: Promise<IDBPDatabase<HujiDB>> | null = null;

export const getDB = (): Promise<IDBPDatabase<HujiDB>> => {
  if (!_dbPromise) {
    _dbPromise = openDB<HujiDB>("huji", 1, {
      upgrade(db) {
        const meta = db.createObjectStore("meta", { keyPath: "id" });
        meta.createIndex("byFile", "fileId");
        db.createObjectStore("content", { keyPath: "id" });
      },
    });
  }
  return _dbPromise;
};
