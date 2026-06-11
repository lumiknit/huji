import { createSignal } from "solid-js";

/**
 * Returns a debounced reactive signal. Writing to the setter schedules an
 * update after `delayMs`; rapid writes reset the timer.
 */
export const createDebouncedSignal = <T>(
  initial: T,
  delayMs: number,
): [() => T, (v: T) => void] => {
  const [value, setValue] = createSignal<T>(initial);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const set = (v: T) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      setValue(() => v);
    }, delayMs);
  };
  return [value, set];
};

const DEBOUNCE_IDLE_MS = 2000;
const DEBOUNCE_TIMEOUT_MS = 3000;
const DEBOUNCE_MAX_MS = 60000;

export type FlushFn = () => void | Promise<void>;

export interface Debounceable {
  notify: () => void;
  flush: () => void;
  dispose: () => void;
}

/**
 * Typing-pattern debounce: saves after 2s idle, or forces save after 1min without saving.
 * Call flush() explicitly on blur or navigation.
 */
export const createDebounce = (onFlush: FlushFn): Debounceable => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastEditAt = 0;
  let lastSavedAt = 0;

  const doFlush = () => {
    timer = null;
    lastSavedAt = Date.now();
    onFlush();
  };

  const tryFlush = () => {
    const now = Date.now();
    if (now - lastEditAt >= DEBOUNCE_IDLE_MS) {
      doFlush();
    } else if (now - lastSavedAt >= DEBOUNCE_MAX_MS) {
      doFlush();
    } else {
      timer = setTimeout(tryFlush, DEBOUNCE_TIMEOUT_MS);
    }
  };

  return {
    notify() {
      lastEditAt = Date.now();
      if (timer === null) {
        timer = setTimeout(tryFlush, DEBOUNCE_TIMEOUT_MS);
      }
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      doFlush();
    },
    dispose() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
};
