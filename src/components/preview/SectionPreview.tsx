import {
  type Component,
  createSignal,
  onMount,
  onCleanup,
  Show,
} from "solid-js";
import MarkdownView from "../MarkdownView";
import type { SectionEntry } from "../../lib/preview";

type Props = { entry: SectionEntry };

const SectionPreview: Component<Props> = (props) => {
  let el!: HTMLDivElement;
  const [vis, setVis] = createSignal(false);
  const [height, setHeight] = createSignal<number | null>(null);

  onMount(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVis(true);
        } else {
          if (vis()) setHeight(el.offsetHeight);
          setVis(false);
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div
      ref={el}
      style={
        !vis() && height() !== null ? { height: `${height()}px` } : undefined
      }
    >
      <Show when={vis()}>
        <MarkdownView content={props.entry.content} />
      </Show>
    </div>
  );
};

export default SectionPreview;
