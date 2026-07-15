import { createSignal, type Signal } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";
import { createIdbStorage } from "../idb_storage";

const store = createIdbStorage("huji_settings", "kv", 2);

/** AsyncStorage adapter for @solid-primitives/storage */
export const hujiSettingsStorage = store;

/** A signal persisted to huji's settings store, keyed by `key`. */
export const persisted = <T>(key: string, def: T) =>
  makePersisted<T, Signal<T>>(createSignal<T>(def), {
    name: key,
    storage: hujiSettingsStorage,
  });

export const clearHujiSettings = () => store.clear();

export const exportHujiSettings = async (): Promise<void> => {
  const entries = await store.entries();
  const obj = Object.fromEntries(entries);
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "huji-settings.json";
  a.click();
  URL.revokeObjectURL(url);
};

export const importHujiSettings = async (file: File): Promise<void> => {
  const text = await file.text();
  const obj = JSON.parse(text) as Record<string, string>;
  await store.clear();
  for (const [k, v] of Object.entries(obj)) {
    await store.setItem(k, v);
  }
  location.reload();
};
