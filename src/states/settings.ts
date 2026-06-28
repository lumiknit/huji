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
export const [editorFontSize, setEditorFontSize_] = persisted(
  "editorFontSize",
  16,
);
export const setEditorFontSize = (v: number) =>
  setEditorFontSize_(Math.min(32, Math.max(10, v)));
export const [editorLineHeight, setEditorLineHeight_] = persisted(
  "editorLineHeight",
  1.4,
);
export const setEditorLineHeight = (v: number) =>
  setEditorLineHeight_(Math.min(3, Math.max(1, v)));
export const [editorFontWeight, setEditorFontWeight_] = persisted(
  "editorFontWeight",
  400,
);
export const setEditorFontWeight = (v: number) =>
  setEditorFontWeight_(Math.min(900, Math.max(100, v)));
export const [previewFont, setPreviewFont] = persisted("previewFont", "");
export const [previewFontSize, setPreviewFontSize_] = persisted(
  "previewFontSize",
  14,
);
export const setPreviewFontSize = (v: number) =>
  setPreviewFontSize_(Math.min(32, Math.max(10, v)));
export const [previewLineHeight, setPreviewLineHeight_] = persisted(
  "previewLineHeight",
  1.6,
);
export const setPreviewLineHeight = (v: number) =>
  setPreviewLineHeight_(Math.min(3, Math.max(1, v)));
export const [previewFontWeight, setPreviewFontWeight_] = persisted(
  "previewFontWeight",
  400,
);
export const setPreviewFontWeight = (v: number) =>
  setPreviewFontWeight_(Math.min(900, Math.max(100, v)));
export const [previewParaIndent, setPreviewParaIndent] = persisted(
  "previewParaIndent",
  true,
);
export const [spellcheck, setSpellcheck] = persisted("spellcheck", true);
export const [autocorrect, setAutocorrect] = persisted("autocorrect", false);
export const [autocapitalize, setAutocapitalize] = persisted<
  "off" | "none" | "sentences" | "words"
>("autocapitalize", "sentences");
export const [wakeLock, setWakeLock] = persisted("wakeLock", true);
export const [showWords, setShowWords] = persisted("showWords", false);
export const [typewriterMode, setTypewriterMode] = persisted(
  "typewriterMode",
  false,
);
export const [defaultRemoteProvider, setDefaultRemoteProvider] = persisted(
  "defaultRemoteProvider",
  "" as string,
);
export type SaveFormat = "md" | "md.gz";
export const [saveFormat, setSaveFormat] = persisted<SaveFormat>(
  "saveFormat",
  "md.gz",
);
export const [contextRaw, setContextRaw] = persisted("contextRaw", false);
export const [contextSections, setContextSections_] = persisted(
  "contextSections",
  1,
);
export const setContextSections = (v: number) =>
  setContextSections_(Math.min(5, Math.max(0, v)));
export const [maxWidth, setMaxWidth_] = persisted("maxWidth", 720);
export const setMaxWidth = (v: number) =>
  setMaxWidth_(Math.min(1920, Math.max(640, v)));

export const [stickerWidth, setStickerWidth_] = persisted("stickerWidth", 320);
export const setStickerWidth = (v: number) =>
  setStickerWidth_(Math.min(480, Math.max(180, v)));

export type ThemeVariant = "default" | "warm" | "cool";
export const [themeLight, setThemeLight] = persisted<ThemeVariant>(
  "themeLight",
  "default",
);
export const [themeDark, setThemeDark] = persisted<ThemeVariant>(
  "themeDark",
  "default",
);

/** Call once at app root — syncs all settings to CSS vars reactively. */
export const useSettingsInit = () => {
  createEffect(() => {
    const r = document.documentElement.style;
    r.setProperty("--max-width", `${maxWidth()}px`);
    r.setProperty("--editor-font", resolveFont(editorFont()));
    r.setProperty("--editor-font-size", `${editorFontSize()}px`);
    r.setProperty("--editor-line-height", String(editorLineHeight()));
    r.setProperty("--editor-font-weight", String(editorFontWeight()));
    r.setProperty("--preview-font", resolveFont(previewFont()));
    r.setProperty("--preview-font-size", `${previewFontSize()}px`);
    r.setProperty("--preview-line-height", String(previewLineHeight()));
    r.setProperty("--preview-font-weight", String(previewFontWeight()));
    r.setProperty("--preview-para-indent", previewParaIndent() ? "1em" : "0");
  });

  createEffect(() => {
    const light = themeLight();
    const dark = themeDark();
    const cl = document.documentElement.classList;
    [...cl].filter((c) => c.startsWith("theme-")).forEach((c) => cl.remove(c));
    cl.add(`theme-light-${light}`);
    cl.add(`theme-dark-${dark}`);

    const LIGHT_BG: Record<string, string> = {
      default: "#ffffff",
      warm: "#fdf6e3",
      cool: "#eef4fb",
    };
    const DARK_BG: Record<string, string> = {
      default: "#000000",
      warm: "#1a1410",
      cool: "#1e2a3a",
    };
    const lightMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"][media*="light"]',
    );
    const darkMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"][media*="dark"]',
    );
    if (lightMeta)
      lightMeta.content = LIGHT_BG[light ?? "default"] ?? "#ffffff";
    if (darkMeta) darkMeta.content = DARK_BG[dark ?? "default"] ?? "#000000";
  });
};
