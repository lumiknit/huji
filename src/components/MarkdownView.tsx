import { type Component } from "solid-js";
import { renderMarkdown } from "../lib/md/render";

type Props = {
  sectionId: string;
  content: string;
};

const MarkdownView: Component<Props> = (props) => {
  const html = () => renderMarkdown(props.content);

  return <article class="md-body" innerHTML={html()} />;
};

export default MarkdownView;
