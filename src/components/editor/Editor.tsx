import { type Component, createEffect, onCleanup, onMount } from "solid-js";
import { EditorView } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import {
  buildExtensions,
  createEditorState,
  createLangCompartment,
  createSpellcheckCompartment,
  langExtension,
  spellcheckExtension,
} from "./cm_setup.ts";
import type { EditorCommander, EditorLanguage } from "./commander.ts";
import { registerValueGetter } from "../../states/editor_save.ts";
import { spellcheck, typewriterMode } from "../../states/settings.ts";

type EditorProps = {
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

const Editor: Component<EditorProps> = (props) => {
  let containerEl: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  let spellcheckComp = createSpellcheckCompartment();
  let langComp = createLangCompartment();
  let builtExtensions: ReturnType<typeof buildExtensions> | undefined;
  let currentLang: EditorLanguage = props.language ?? "markdown";

  onMount(() => {
    const extensions = buildExtensions({
      language: props.language ?? "markdown",
      placeholderText: props.placeholder ?? "",
      onChange: () => props.onChange?.(),
      onSave: () => props.onSave?.(),
      onFind: () => props.onFind?.(),
      onBlur: () => props.onBlur?.(),
      onPrevSection: props.onPrevSection
        ? () => props.onPrevSection!()
        : undefined,
      onNextSection: props.onNextSection
        ? () => props.onNextSection!()
        : undefined,
      getTypewriterMode: () => typewriterMode(),
      langCompartment: langComp,
      spellcheckCompartment: spellcheckComp,
      initialSpellcheck: spellcheck(),
      readonly: props.readonly,
    });

    builtExtensions = extensions;
    view = new EditorView({
      state: createEditorState("", { anchor: 0, head: 0 }, extensions),
      parent: containerEl!,
    });

    registerValueGetter(() => view!.state.doc.toString());

    if (props.commander) {
      const cmd = props.commander;
      cmd.undo = () => {
        undo(view!);
        view!.focus();
      };
      cmd.redo = () => {
        redo(view!);
        view!.focus();
      };
      cmd.openSearch = () => openSearchPanel(view!);
      cmd.scrollToEdge = (edge) => {
        const pos = edge === "start" ? 0 : view!.state.doc.length;
        view!.dispatch({ selection: { anchor: pos } });
        view!.focus();
      };
      cmd.focus = () => view!.focus();
      cmd.getValue = () => view!.state.doc.toString();
      cmd.setValue = (value, selection, opts) => {
        const anchor = Math.min(selection?.anchor ?? 0, value.length);
        const head = Math.min(selection?.head ?? anchor, value.length);
        if (opts?.resetHistory && builtExtensions) {
          view!.setState(createEditorState(value, { anchor, head }, builtExtensions));
          // Re-apply compartments that may have been reconfigured since mount
          view!.dispatch({
            effects: [
              langComp.reconfigure(langExtension(currentLang)),
              spellcheckComp.reconfigure(spellcheckExtension(spellcheck())),
            ],
          });
        } else {
          view!.dispatch({
            changes: { from: 0, to: view!.state.doc.length, insert: value },
            selection: { anchor, head },
          });
        }
      };
      cmd.setSelection = (anchor, head) => {
        const len = view!.state.doc.length;
        view!.dispatch({
          selection: {
            anchor: Math.min(anchor, len),
            head: Math.min(head, len),
          },
        });
      };
      cmd.setLanguage = (lang) => {
        currentLang = lang;
        view?.dispatch({
          effects: langComp.reconfigure(langExtension(lang)),
        });
      };
      cmd.insertAtCursor = (text) => {
        const { from, to } = view!.state.selection.main;
        view!.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        view!.focus();
      };
      cmd.getContainer = () => containerEl ?? null;
    }
  });

  createEffect(() => {
    const enabled = spellcheck();
    if (view) {
      view.dispatch({
        effects: spellcheckComp.reconfigure(spellcheckExtension(enabled)),
      });
    }
  });

  onCleanup(() => {
    registerValueGetter(null);
    view?.destroy();
    view = undefined;
  });

  return <div ref={containerEl} class="cm-editor-wrap" />;
};

export default Editor;
