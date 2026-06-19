import { createIdbStorage } from "../idb_storage";

const store = createIdbStorage("huji_settings", "kv", 2);

/** AsyncStorage adapter for @solid-primitives/storage */
export const hujiSettingsStorage = store;

export const clearHujiSettings = () => store.clear();
