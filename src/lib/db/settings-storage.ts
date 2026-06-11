import localforage from "localforage";

const store = localforage.createInstance({ name: "huji_settings" });

/** AsyncStorage adapter for @solid-primitives/storage */
export const hujiSettingsStorage = {
  getItem: (key: string) => store.getItem<string>(key),
  setItem: (key: string, value: string) => store.setItem(key, value),
  removeItem: (key: string) => store.removeItem(key),
};

export const clearHujiSettings = () => store.clear();
