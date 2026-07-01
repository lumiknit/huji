import { type Component, lazy, Suspense } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { EditorWidgetProps } from "./commander.ts";
import LightEditor from "./LightEditor.tsx";
import { lightEditor } from "../../states/settings.ts";

const CMEditor = lazy(() => import("./CMEditor.tsx"));

/** Picks the CodeMirror or plain-textarea editor widget based on user settings. */
const Editor: Component<EditorWidgetProps> = (props) => (
  <Suspense>
    <Dynamic component={lightEditor() ? LightEditor : CMEditor} {...props} />
  </Suspense>
);

export default Editor;
