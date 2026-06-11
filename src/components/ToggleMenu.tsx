import { type Component, type JSX } from "solid-js";

type Props = {
  label: JSX.Element;
  children: JSX.Element;
};

const ToggleMenu: Component<Props> = (props) => {
  let detailsEl!: HTMLDetailsElement;

  const handleBlur = (e: FocusEvent) => {
    if (!detailsEl.contains(e.relatedTarget as Node)) {
      detailsEl.open = false;
    }
  };

  return (
    <details ref={detailsEl} onBlur={handleBlur}>
      <summary>{props.label}</summary>
      <menu
        onClick={() => {
          detailsEl.open = false;
        }}
      >
        {props.children}
      </menu>
    </details>
  );
};

export default ToggleMenu;
