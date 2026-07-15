import { createSignal, batch } from "solid-js";
import { persisted } from "../lib/db/settings-storage";

export type StickerPinState = "off" | "unpinned" | "pinned";

export const [stickerPinState, setStickerPinState] = persisted<StickerPinState>(
  "stickerPinState",
  "off",
);

/**
 * Whether the sticker is currently expanded (vs shrunk to a FAB).
 * Not persisted — a shown sticker always starts expanded.
 */
export const [stickerVisible, setStickerVisible] = createSignal(true);

/**
 * Section shown in the top (0) / bottom (1) slot. null = OFF.
 * Not persisted — section ids are only valid within the currently open file.
 */
export const [stickerSectionIds, setStickerSectionIds] = createSignal<
  (string | null)[]
>([null, null]);

export const setStickerSectionSlot = (slot: number, id: string | null) => {
  setStickerSectionIds((ids) => {
    const next = [...ids];
    next[slot] = id;
    return next;
  });
};

export const stickerOpen = () => stickerPinState() !== "off";

export const openSticker = (sectionId?: string) => {
  batch(() => {
    if (sectionId && stickerSectionIds()[0] == null) {
      setStickerSectionSlot(0, sectionId);
    }
    if (stickerPinState() === "off") setStickerPinState("unpinned");
    setStickerVisible(true);
  });
};

export const closeSticker = () => setStickerPinState("off");

export const toggleSticker = () => {
  if (stickerOpen()) {
    closeSticker();
  } else {
    openSticker();
  }
};

export const togglePin = () => {
  setStickerPinState((p) => (p === "pinned" ? "unpinned" : "pinned"));
};
