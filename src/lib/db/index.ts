import { openDB, type IDBPDatabase } from "idb";
import type { HujiDB } from "./schema";

let _db: IDBPDatabase<HujiDB> | null = null;

export const getDB = async (): Promise<IDBPDatabase<HujiDB>> => {
  if (_db) return _db;
  _db = await openDB<HujiDB>("huji", 1, {
    upgrade(db) {
      const meta = db.createObjectStore("meta", { keyPath: "id" });
      meta.createIndex("byFile", "fileId");
      db.createObjectStore("content", { keyPath: "id" });
    },
  });
  return _db;
};
