import { type Component, type JSX } from "solid-js";

type Props = {
  title: JSX.Element;
  children: JSX.Element;
  class?: string;
};

const Toolbar: Component<Props> = (props) => (
  <nav class={`toolbar${props.class ? ` ${props.class}` : ""}`}>
    <fieldset>
      <legend>{props.title}</legend>
      <div class="toolbar-inner">{props.children}</div>
    </fieldset>
  </nav>
);

export default Toolbar;
