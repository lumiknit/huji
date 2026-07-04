import { type Component, createResource, lazy, Suspense } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { EditorWidgetProps } from "./commander.ts";
import LightEditor from "./LightEditor.tsx";
import { initLightEditor, lightEditor } from "../../states/settings.ts";

const CMEditor = lazy(() => import("./CMEditor.tsx"));

/** Picks the CodeMirror or plain-textarea editor widget based on user settings. */
const Editor: Component<EditorWidgetProps> = (props) => {
  const [le] = createResource(async () => {
    await initLightEditor;
    return lightEditor();
  });
  return (
    <Suspense>
      <Dynamic component={le() ? LightEditor : CMEditor} {...props} />
    </Suspense>
  );
};

export default Editor;
