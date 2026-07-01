import { type Component, createResource, Show } from "solid-js";

import { loadSectionContent } from "../../states/editor";
import MarkdownView from "../MarkdownView";
import type { SectionMeta } from "../../lib/db/schema";

type Props = {
  meta: () => SectionMeta;
  raw: boolean;
};

const ContextSection: Component<Props> = (props) => {
  const [content] = createResource(() => props.meta().id, loadSectionContent);
  return (
    <div class="section-preview">
      <Show
        when={!props.raw && props.meta().level !== -1}
        fallback={<pre class="pre-wrap">{content() ?? ""}</pre>}
      >
        <MarkdownView content={content() ?? ""} />
      </Show>
    </div>
  );
};

export default ContextSection;
