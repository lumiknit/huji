import { type Component, onMount } from "solid-js";
import type { EditorWidgetProps } from "./commander.ts";
import {
  spellcheck,
  autocorrect,
  autocapitalize,
} from "../../states/settings.ts";

const LightEditor: Component<EditorWidgetProps> = (props) => {
  let textareaEl: HTMLTextAreaElement | undefined;

  onMount(() => {
    if (!props.commander) return;
    const cmd = props.commander;

    cmd.undo = () => {
      textareaEl?.focus();
      document.execCommand("undo");
    };
    cmd.redo = () => {
      textareaEl?.focus();
      document.execCommand("redo");
    };
    cmd.openSearch = () => {};
    cmd.scrollToSelection = () => {};
    cmd.scrollToEdge = (edge) => {
      if (!textareaEl) return;
      const pos = edge === "start" ? 0 : textareaEl.value.length;
      textareaEl.setSelectionRange(pos, pos);
      textareaEl.focus();
    };
    cmd.focus = () => textareaEl?.focus();
    cmd.getValue = () => textareaEl?.value ?? "";
    cmd.setValue = (value, selection) => {
      if (!textareaEl) return;
      textareaEl.value = value;
      const anchor = Math.min(selection?.anchor ?? 0, value.length);
      const head = Math.min(selection?.head ?? anchor, value.length);
      textareaEl.setSelectionRange(anchor, head);
    };
    cmd.setSelection = (anchor, head) => {
      if (!textareaEl) return;
      const len = textareaEl.value.length;
      textareaEl.setSelectionRange(Math.min(anchor, len), Math.min(head, len));
    };
    cmd.setLanguage = () => {};
    cmd.insertAtCursor = (text) => {
      if (!textareaEl) return;
      const start = textareaEl.selectionStart;
      const end = textareaEl.selectionEnd;
      const before = textareaEl.value.slice(0, start);
      const after = textareaEl.value.slice(end);
      textareaEl.value = before + text + after;
      textareaEl.setSelectionRange(start + text.length, start + text.length);
      textareaEl.focus();
      props.onChange?.();
    };
    cmd.getContainer = () => textareaEl ?? null;
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "s") {
      e.preventDefault();
      props.onSave?.();
      return;
    }
    if (mod && e.key === "f") {
      e.preventDefault();
      props.onFind?.();
      return;
    }
    if (!textareaEl) return;
    if (e.key === "ArrowUp" && textareaEl.selectionStart === 0) {
      props.onPrevSection?.();
    }
    if (
      e.key === "ArrowDown" &&
      textareaEl.selectionStart === textareaEl.value.length
    ) {
      props.onNextSection?.();
    }
  };

  return (
    <textarea
      ref={textareaEl}
      class="light-editor"
      placeholder={props.placeholder}
      spellcheck={spellcheck()}
      autocorrect={autocorrect() ? "on" : "off"}
      autocapitalize={autocapitalize()}
      onInput={() => props.onChange?.()}
      onBlur={() => props.onBlur?.()}
      onKeyDown={handleKeyDown}
    />
  );
};

export default LightEditor;
