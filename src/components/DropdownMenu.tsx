import {
  type Component,
  type Accessor,
  type Setter,
  type JSX,
  onMount,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { TbOutlineDots } from "solid-icons/tb";

export type DropdownMenuItem = {
  key: string;
  label: JSX.Element;
  onClick: () => void;
  danger?: boolean;
};

type DropdownMenuProps = {
  id: string;
  openMenu: Accessor<string | null>;
  setOpenMenu: Setter<string | null>;
  items: DropdownMenuItem[];
};

// Shared trigger+menu used by any per-row "..." action menu (file list,
// cloud file list, etc). Handles outside-click close, Escape, and
// Up/Down arrow navigation between items so it's usable without a mouse.
const DropdownMenu: Component<DropdownMenuProps> = (props) => {
  let anchorEl: HTMLDivElement | undefined;
  let triggerEl: HTMLButtonElement | undefined;
  const itemEls: (HTMLButtonElement | undefined)[] = [];

  const isOpen = () => props.openMenu() === props.id;

  const close = (refocusTrigger: boolean) => {
    props.setOpenMenu(null);
    if (refocusTrigger) triggerEl?.focus();
  };

  onMount(() => {
    const handler = (e: MouseEvent) => {
      if (isOpen() && anchorEl && !anchorEl.contains(e.target as Node)) {
        props.setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    onCleanup(() => document.removeEventListener("mousedown", handler));
  });

  const focusItem = (index: number) => {
    const n = props.items.length;
    if (n === 0) return;
    itemEls[((index % n) + n) % n]?.focus();
  };

  const handleTriggerKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      props.setOpenMenu(props.id);
      queueMicrotask(() => focusItem(0));
    }
  };

  const handleMenuKeyDown = (e: KeyboardEvent) => {
    const current = itemEls.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(current + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(current - 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    }
  };

  return (
    <div class="dropdown-anchor" ref={anchorEl}>
      <button
        type="button"
        ref={triggerEl}
        title="Menu"
        aria-haspopup="menu"
        aria-expanded={isOpen()}
        onClick={() =>
          props.setOpenMenu((prev) => (prev === props.id ? null : props.id))
        }
        onKeyDown={handleTriggerKeyDown}
      >
        <TbOutlineDots />
      </button>
      <Show when={isOpen()}>
        <div class="dropdown-menu" role="menu" onKeyDown={handleMenuKeyDown}>
          <For each={props.items}>
            {(item, i) => (
              <button
                type="button"
                ref={(el) => (itemEls[i()] = el)}
                role="menuitem"
                class={`dropdown-item${item.danger ? " danger" : ""}`}
                onClick={() => {
                  close(false);
                  item.onClick();
                }}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default DropdownMenu;
