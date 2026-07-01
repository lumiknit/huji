export type EditorLanguage = "markdown" | "plaintext";

export type EditorCommander = {
  undo: () => void;
  redo: () => void;
  openSearch: () => void;
  scrollToEdge: (edge: "start" | "end") => void;
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
  readonly?: boolean;
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
  focus: () => {},
  getValue: () => "",
  setValue: () => {},
  setSelection: () => {},
  setLanguage: () => {},
  insertAtCursor: () => {},
  getContainer: () => null,
});
