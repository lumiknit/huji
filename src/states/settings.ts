import { createEffect, createSignal } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";
import { hujiSettingsStorage } from "../lib/db/settings-storage";

export const SERIF_STACK = "'BuiltinSerif', serif";
const resolveFont = (font: string) => font || SERIF_STACK;

const persisted = <T>(key: string, def: T) =>
  makePersisted(createSignal<T>(def), {
    name: key,
    storage: hujiSettingsStorage,
  });

export const [editorFont, setEditorFont] = persisted("editorFont", "");
export const [editorFontSize, setEditorFontSize] = persisted(
  "editorFontSize",
  16,
);
export const [editorLineHeight, setEditorLineHeight] = persisted(
  "editorLineHeight",
  1.4,
);
export const [previewFont, setPreviewFont] = persisted("previewFont", "");
export const [previewFontSize, setPreviewFontSize] = persisted(
  "previewFontSize",
  14,
);
export const [previewLineHeight, setPreviewLineHeight] = persisted(
  "previewLineHeight",
  1.6,
);
export const [previewParaIndent, setPreviewParaIndent] = persisted(
  "previewParaIndent",
  true,
);
export const [spellcheck, setSpellcheck] = persisted("spellcheck", true);
export const [defaultRemoteProvider, setDefaultRemoteProvider] = persisted(
  "defaultRemoteProvider",
  "" as string,
);
export const [contextRaw, setContextRaw] = persisted("contextRaw", false);
export const [contextSections, setContextSections] = persisted(
  "contextSections",
  1,
);
export const [maxWidth, setMaxWidth_] = persisted("maxWidth", 720);
export const setMaxWidth = (v: number) =>
  setMaxWidth_(Math.min(1920, Math.max(640, v)));

/** Compatibility shim — pages still import settingsSignals.xxx() */
export const settingsSignals = {
  editorFont,
  editorFontSize,
  editorLineHeight,
  previewFont,
  previewFontSize,
  previewLineHeight,
  previewParaIndent,
  spellcheck,
  contextSections,
  maxWidth,
  contextRaw,
};

/** Call once at app root — syncs all settings to CSS vars reactively. */
export const useSettingsInit = () => {
  createEffect(() => {
    const r = document.documentElement.style;
    r.setProperty("--max-width", `${maxWidth()}px`);
    r.setProperty("--editor-font", resolveFont(editorFont()));
    r.setProperty("--editor-font-size", `${editorFontSize()}px`);
    r.setProperty("--editor-line-height", String(editorLineHeight()));
    r.setProperty("--preview-font", resolveFont(previewFont()));
    r.setProperty("--preview-font-size", `${previewFontSize()}px`);
    r.setProperty("--preview-line-height", String(previewLineHeight()));
    r.setProperty("--preview-para-indent", previewParaIndent() ? "1em" : "0");
  });
};
