import { type Component, type JSX } from "solid-js";

type Props = {
  title: JSX.Element;
  children: JSX.Element;
};

const Toolbar: Component<Props> = (props) => (
  <nav class="toolbar">
    <fieldset>
      <legend>{props.title}</legend>
      <div class="toolbar-inner">{props.children}</div>
    </fieldset>
  </nav>
);

export default Toolbar;
