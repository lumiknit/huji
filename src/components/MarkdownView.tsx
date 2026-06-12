import { type Component, createMemo } from "solid-js";
import { renderMarkdown } from "../lib/md/render";

type Props = {
  sectionId: string;
  content: string;
};

const MarkdownView: Component<Props> = (props) => {
  const html = createMemo(() => renderMarkdown(props.content));

  return <article class="md-body" innerHTML={html()} />;
};

export default MarkdownView;
