import {
  type Component,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import type { FrontmatterType } from "../../lib/md/frontmatter";
import {
  createDefaultFrontmatterData,
  decodeFrontmatterForEdit,
  encodeFrontmatterFromEdit,
  extractIdLoose,
} from "../../lib/md/frontmatter";
import { loadSectionContent, setSaveStatus } from "../../states/editor";
import { registerValueGetter } from "../../states/editor_save";
import { genId } from "../../lib/utils/id";

type FrontmatterEditorProps = {
  id: string;
  format: FrontmatterType;
  onFormatChange: (format: FrontmatterType) => void;
  onSave?: () => void;
  onFind?: () => void;
  onPrevSection?: () => void;
  onNextSection?: () => void;
};

const FrontmatterEditor: Component<FrontmatterEditorProps> = (props) => {
  const [text, setText] = createSignal("");
  const [error, setError] = createSignal("");
  let textareaEl: HTMLTextAreaElement | undefined;

  // Reload from storage only when switching to a different section — not on
  // every format change, which would otherwise discard unsaved edits made
  // just before handleFormatChange runs its own (already up to date) convert.
  createEffect(() => {
    const id = props.id;
    (async () => {
      const raw = await loadSectionContent(id);
      try {
        setText(await decodeFrontmatterForEdit(raw, props.format));
        setError("");
      } catch {
        // Raw content isn't valid JSON at all — show an editable default
        // instead of the broken text, keeping whatever _id we can recover.
        const fallback = createDefaultFrontmatterData(
          extractIdLoose(raw) ?? genId(),
        );
        setText(
          await decodeFrontmatterForEdit(
            JSON.stringify(fallback),
            props.format,
          ),
        );
        setError("Invalid frontmatter — loaded default, save to fix");
      }
    })();
  });

  onMount(() => registerValueGetter(() => text()));
  onCleanup(() => registerValueGetter(null));

  const handleInput = (value: string) => {
    setText(value);
    setSaveStatus("dirty");
  };

  const handleFormatChange = async (e: Event) => {
    const newFormat = (e.currentTarget as HTMLSelectElement)
      .value as FrontmatterType;
    if (newFormat === props.format) return;
    try {
      const data = await encodeFrontmatterFromEdit(text(), props.format);
      setText(await decodeFrontmatterForEdit(JSON.stringify(data), newFormat));
      setError("");
      props.onFormatChange(newFormat);
    } catch {
      setError("Fix errors before switching format");
      (e.currentTarget as HTMLSelectElement).value = props.format;
    }
  };

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
    <div class="frontmatter-editor">
      <div class="frontmatter-editor-toolbar">
        <select value={props.format} onChange={handleFormatChange}>
          <option value="json">JSON</option>
          <option value="yaml">YAML</option>
        </select>
      </div>
      <textarea
        ref={textareaEl}
        class="light-editor frontmatter-editor-textarea"
        value={text()}
        onInput={(e) => handleInput(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      {error() && <p class="error-text">{error()}</p>}
    </div>
  );
};

export default FrontmatterEditor;
