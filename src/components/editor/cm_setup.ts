import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder,
  highlightActiveLine,
  type KeyBinding,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { search, openSearchPanel, searchKeymap } from "@codemirror/search";
import { livePreviewPlugin, livePreviewTheme } from "./live_preview.ts";

export { openSearchPanel };
export type EditorLanguage = "markdown" | "yaml";

export function createSpellcheckCompartment() {
  return new Compartment();
}

export function createLangCompartment() {
  return new Compartment();
}

export function spellcheckExtension(enabled: boolean): Extension {
  return EditorView.contentAttributes.of({ spellcheck: String(enabled) });
}

export function langExtension(lang: EditorLanguage): Extension {
  if (lang !== "markdown") return [];
  return [markdown({ extensions: [GFM] }), livePreviewPlugin, livePreviewTheme];
}

export function buildExtensions(opts: {
  language: EditorLanguage;
  placeholderText: string;
  onChange: () => void;
  onSave: () => void;
  onFind?: () => void;
  onBlur: () => void;
  onPrevSection?: () => void;
  onNextSection?: () => void;
  getTypewriterMode: () => boolean;
  langCompartment: Compartment;
  spellcheckCompartment: Compartment;
  initialSpellcheck: boolean;
  readonly?: boolean;
}): Extension[] {
  const sectionNavKeys: KeyBinding[] = [];
  if (opts.onPrevSection) {
    sectionNavKeys.push({
      key: "ArrowUp",
      run(view) {
        const { from } = view.state.selection.main;
        if (from === 0) {
          opts.onPrevSection!();
          return true;
        }
        return false;
      },
    });
  }
  if (opts.onNextSection) {
    sectionNavKeys.push({
      key: "ArrowDown",
      run(view) {
        const { to } = view.state.selection.main;
        if (to === view.state.doc.length) {
          opts.onNextSection!();
          return true;
        }
        return false;
      },
    });
  }

  return [
    history(),
    keymap.of([
      ...sectionNavKeys,
      {
        key: "Mod-s",
        run() {
          opts.onSave();
          return true;
        },
      },
      {
        key: "Mod-f",
        run() {
          opts.onFind?.();
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    search({ top: true }),
    highlightActiveLine(),
    opts.spellcheckCompartment.of(spellcheckExtension(opts.initialSpellcheck)),
    opts.langCompartment.of(langExtension(opts.language)),
    placeholder(opts.placeholderText),
    EditorView.lineWrapping,
    EditorView.editable.of(!opts.readonly),
    EditorView.domEventHandlers({
      blur: () => {
        opts.onBlur();
        return false;
      },
    }),
    EditorView.updateListener.of(
      (() => {
        let rafId = 0;
        return (update) => {
          if (!update.docChanged) return;
          opts.onChange();
          if (!opts.getTypewriterMode() || update.view.composing) return;
          if (rafId) cancelAnimationFrame(rafId);
          const { from } = update.state.selection.main;
          rafId = requestAnimationFrame(() => {
            rafId = 0;
            const coords = update.view.coordsAtPos(from);
            if (!coords) return;
            const diff = coords.top - globalThis.innerHeight / 2;
            if (Math.abs(diff) > 16) {
              update.view.dispatch({
                effects: EditorView.scrollIntoView(from, { y: "center" }),
              });
            }
          });
        };
      })(),
    ),
  ];
}

export function createEditorState(
  doc: string,
  selection: { anchor: number; head: number },
  extensions: Extension[],
): EditorState {
  const safeAnchor = Math.min(selection.anchor, doc.length);
  const safeHead = Math.min(selection.head, doc.length);
  return EditorState.create({
    doc,
    selection: { anchor: safeAnchor, head: safeHead },
    extensions,
  });
}
