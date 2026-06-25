import { createSignal, batch } from "solid-js";

export type StickerLayout = "left" | "right" | "collapsed";

export const [stickerOpen, setStickerOpen] = createSignal(false);
export const [stickerSectionId, setStickerSectionId] = createSignal<
  string | null
>(null);
export const [stickerLayout, setStickerLayout] =
  createSignal<StickerLayout>("left");

export const cycleLayout = () => {
  setStickerLayout((l) => {
    if (l === "left") return "right";
    if (l === "right") return "collapsed";
    return "left";
  });
};

export const openSticker = (sectionId?: string) => {
  batch(() => {
    if (sectionId) setStickerSectionId(sectionId);
    if (stickerLayout() === "collapsed") setStickerLayout("left");
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
