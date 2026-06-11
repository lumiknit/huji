import {
  type Component,
  createSignal,
  onMount,
  onCleanup,
  Show,
} from "solid-js";

type FileDropProps = {
  onDrop: (file: File) => void;
  label?: string;
};

const FileDrop: Component<FileDropProps> = (props) => {
  const [dragging, setDragging] = createSignal(false);
  let depth = 0;

  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");

  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    depth++;
    if (depth === 1) setDragging(true);
  };

  const onDragLeave = () => {
    depth--;
    if (depth <= 0) {
      depth = 0;
      setDragging(false);
    }
  };

  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth = 0;
    setDragging(false);
    const file = e.dataTransfer?.files[0];
    if (file) props.onDrop(file);
  };

  onMount(() => {
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
  });

  onCleanup(() => {
    window.removeEventListener("dragenter", onDragEnter);
    window.removeEventListener("dragleave", onDragLeave);
    window.removeEventListener("dragover", onDragOver);
    window.removeEventListener("drop", onDrop);
  });

  return (
    <Show when={dragging()}>
      <div class="file-drop-overlay active">
        <span class="file-drop-label">{props.label ?? "Drop file"}</span>
        <span class="file-drop-hint">
          Release to {props.label?.toLowerCase() ?? "drop"}
        </span>
      </div>
    </Show>
  );
};

export default FileDrop;
