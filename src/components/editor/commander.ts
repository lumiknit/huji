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

type ApplyOpts = {
  selection?: { anchor: number; head: number };
  guard?: () => boolean;
  isCancelled?: () => boolean;
  /**
   * Called right after `setValue` actually lands. Widgets don't reliably
   * fire `onChange` for programmatic writes (LightEditor's plain textarea
   * never does), so callers that need to know exactly when the content
   * landed (e.g. to snapshot a "last saved/loaded" value for dirty-checking)
   * should use this instead of assuming `onChange` will fire.
   */
  onApplied?: () => void;
};

const attemptApply = (
  commander: EditorCommander,
  content: string,
  opts: ApplyOpts,
) => {
  const attempt = () => {
    if (opts.isCancelled?.()) return;
    if (opts.guard && !opts.guard()) return;
    if (!commander.getContainer()) {
      requestAnimationFrame(attempt);
      return;
    }
    commander.setValue(content, opts.selection, { resetHistory: true });
    commander.focus();
    opts.onApplied?.();
  };
  attempt();
};

/**
 * Sets content once the commander's widget is mounted, cancelling the retry
 * loop on cleanup. Only usable from a reactive/component context (e.g. inside
 * createEffect) since it registers onCleanup.
 */
export const applyWhenReady = (
  commander: EditorCommander,
  content: string,
  opts?: Omit<ApplyOpts, "isCancelled">,
) => {
  let cancelled = false;
  onCleanup(() => {
    cancelled = true;
  });
  attemptApply(commander, content, { ...opts, isCancelled: () => cancelled });
};

/**
 * Same retry-until-ready write, but callable from outside a reactive context
 * (e.g. a click/change handler) where onCleanup isn't available. Relies on
 * `guard` alone to stop stale retries.
 */
export const writeWhenReady = (
  commander: EditorCommander,
  content: string,
  opts: ApplyOpts,
) => {
  attemptApply(commander, content, opts);
};
