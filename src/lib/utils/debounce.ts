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

const DEBOUNCE_IDLE_MS = 1000;
const DEBOUNCE_TIMEOUT_MS = 1000;
const DEBOUNCE_MAX_MS = 4000;

export type FlushFn<T> = (value: T) => void | Promise<void>;

export interface Debounceable<T = void> {
  notify: (value: T) => void;
  flush: () => void;
  dispose: () => void;
}

/**
 * Typing-pattern debounce: saves after 1s idle, or forces save after 4s without saving.
 * Call flush() explicitly on blur or navigation.
 */
export const createDebounce = <T>(onFlush: FlushFn<T>): Debounceable<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastEditAt = 0;
  let lastSavedAt = 0;
  let pendingValue: T | undefined;

  const doFlush = () => {
    timer = null;
    lastSavedAt = Date.now();
    if (pendingValue !== undefined) {
      const value = pendingValue;
      pendingValue = undefined;
      onFlush(value);
    }
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
    notify(value: T) {
      pendingValue = value;
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
      pendingValue = undefined;
    },
  };
};
