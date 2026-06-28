import { type Component, createSignal, createEffect, Show } from "solid-js";

type DialogState =
  | { type: "prompt"; message: string; resolve: (v: string | null) => void }
  | { type: "confirm"; message: string; resolve: (v: boolean) => void };

const [state, setState] = createSignal<DialogState | null>(null);

const open = (s: DialogState): boolean => {
  if (state() !== null) return false;
  setState(s);
  return true;
};

export const aprompt = (message: string): Promise<string | null> =>
  new Promise((resolve, reject) => {
    if (!open({ type: "prompt", message, resolve }))
      reject(new Error("CommonDialog: another dialog is already open"));
  });

export const aconfirm = (message: string): Promise<boolean> =>
  new Promise((resolve, reject) => {
    if (!open({ type: "confirm", message, resolve }))
      reject(new Error("CommonDialog: another dialog is already open"));
  });

const CommonDialog: Component = () => {
  let dialogEl!: HTMLDialogElement;
  let inputEl: HTMLInputElement | undefined;

  createEffect(() => {
    if (state()) {
      dialogEl.showModal();
      if (state()?.type === "prompt") setTimeout(() => inputEl?.focus());
    }
  });

  const handleClose = () => {
    const s = state();
    if (!s) return;
    setState(null);
    const ok = dialogEl.returnValue === "ok";
    if (s.type === "prompt") s.resolve(ok ? (inputEl?.value ?? "") : null);
    else s.resolve(ok);
  };

  return (
    <dialog ref={dialogEl} onClose={handleClose}>
      <form method="dialog">
        <Show when={state()}>{(s) => <p>{s().message}</p>}</Show>
        <Show when={state()?.type === "prompt"}>
          <input ref={inputEl} type="text" />
        </Show>
        <div class="dialog-actions">
          <button
            type="button"
            value="cancel"
            onClick={() => dialogEl.close("cancel")}
          >
            Cancel
          </button>
          <button type="submit" value="ok" class="primary">
            OK
          </button>
        </div>
      </form>
    </dialog>
  );
};

export default CommonDialog;
