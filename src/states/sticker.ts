import { createSignal, batch, type Signal } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";
import { hujiSettingsStorage } from "../lib/db/settings-storage";

export type StickerLayout =
  "left" | "left-long" | "right" | "right-long" | "collapsed";

const persisted = <T>(key: string, def: T) =>
  makePersisted<T, Signal<T>>(createSignal<T>(def), {
    name: key,
    storage: hujiSettingsStorage,
  });

export const [stickerOpen, setStickerOpen] = persisted("stickerOpen", false);
export const [stickerSectionId, setStickerSectionId] = createSignal<
  string | null
>(null);
export const [stickerLayout, setStickerLayout] = persisted<StickerLayout>(
  "stickerLayout",
  "right",
);

export const cycleLayout = () => {
  setStickerLayout((l) => {
    if (l === "left") return "left-long";
    if (l === "left-long") return "right";
    if (l === "right") return "right-long";
    if (l === "right-long") return "collapsed";
    return "left";
  });
};

export const openSticker = (sectionId?: string) => {
  batch(() => {
    if (sectionId) setStickerSectionId(sectionId);
    if (stickerLayout() === "collapsed") setStickerLayout("right");
    setStickerOpen(true);
  });
};

export const closeSticker = () => setStickerOpen(false);

export const toggleSticker = () => {
  if (stickerOpen()) {
    closeSticker();
  } else {
    openSticker();
  }
};
