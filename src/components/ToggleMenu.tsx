import { type Component, type JSX } from "solid-js";

type Props = {
  label: JSX.Element;
  children: JSX.Element;
};

let menuCount = 0;

const ToggleMenu: Component<Props> = (props) => {
  const id = `toggle-menu-${menuCount++}`;
  let btnEl!: HTMLButtonElement;
  let menuEl!: HTMLMenuElement;

  const handleToggle = () => {
    const btn = btnEl.getBoundingClientRect();
    const menuW = menuEl.offsetWidth || 176;
    // 오른쪽 끝이 뷰포트를 벗어나면 우측 정렬
    const left =
      btn.left + menuW > window.innerWidth ? btn.right - menuW : btn.left;
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${btn.bottom + 4}px`;
  };

  return (
    <>
      <button ref={btnEl} popovertarget={id} onClick={handleToggle}>
        {props.label}
      </button>
      <menu
        ref={menuEl}
        id={id}
        popover="auto"
        onClick={() => menuEl.hidePopover()}
      >
        {props.children}
      </menu>
    </>
  );
};

export default ToggleMenu;
