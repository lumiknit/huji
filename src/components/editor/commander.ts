export type EditorLanguage = "markdown" | "plaintext";

export type EditorCommander = {
  undo: () => void;
  redo: () => void;
  openSearch: () => void;
  scrollToEdge: (edge: "start" | "end") => void;
  /** Scroll the editor so the current selection/cursor is visible. No-op on LightEditor. */
  scrollToSelection: () => void;
  focus: () => void;
  getValue: () => string;
  setValue: (
    value: string,
    selection?: { anchor: number; head: number },
    opts?: { resetHistory?: boolean },
  ) => void;
  setSelection: (anchor: number, head: number) => void;
  setLanguage: (lang: EditorLanguage) => void;
  insertAtCursor: (text: string) => void;
  getContainer: () => HTMLElement | null;
};

/** Shared props for any editor widget (CodeMirror or plain textarea). */
export type EditorWidgetProps = {
  language?: EditorLanguage;
  placeholder?: string;
  commander?: EditorCommander;
  onChange?: () => void;
  onSave?: () => void;
  onFind?: () => void;
  onBlur?: () => void;
  onPrevSection?: () => void;
  onNextSection?: () => void;
};

export const createCommander = (): EditorCommander => ({
  undo: () => {},
  redo: () => {},
  openSearch: () => {},
  scrollToEdge: () => {},
  scrollToSelection: () => {},
  focus: () => {},
  getValue: () => "",
  setValue: () => {},
  setSelection: () => {},
  setLanguage: () => {},
  insertAtCursor: () => {},
  getContainer: () => null,
});

import { onCleanup } from "solid-js";

export const applyWhenReady = (
  commander: EditorCommander,
  content: string,
  opts?: {
    selection?: { anchor: number; head: number };
    guard?: () => boolean;
  },
) => {
  let cancelled = false;
  onCleanup(() => {
    cancelled = true;
  });
  const attempt = () => {
    if (cancelled) return;
    if (opts?.guard && !opts.guard()) return;
    if (!commander.getContainer()) {
      requestAnimationFrame(attempt);
      return;
    }
    commander.setValue(content, opts?.selection, { resetHistory: true });
    commander.focus();
  };
  attempt();
};
