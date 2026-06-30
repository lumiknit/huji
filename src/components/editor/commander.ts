export type EditorLanguage = "markdown" | "yaml";

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
