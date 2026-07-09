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

// Poll interval and idle threshold are the same value: a tick only flushes
// once a full DEBOUNCE_MS has passed since the last edit, so there's no
// separate "idle" constant to drift out of sync with the poll cadence.
const DEBOUNCE_MS = 5000;
const DEBOUNCE_EPS_MS = 10;
const DEBOUNCE_MAX_MS = 10000;

export type FlushFn<T> = (value: T) => void | Promise<void>;

export interface Debounceable<T = void> {
  notify: (value: T) => void;
  dispose: () => void;
}

/**
 * Typing-pattern debounce: saves after DEBOUNCE_MS idle, or forces a save
 * after DEBOUNCE_MAX_MS from the first edit of the current burst, whichever
 * comes first.
 */
export const createDebounce = <T>(onFlush: FlushFn<T>): Debounceable<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Timestamped when the timer is (re-)armed from idle, not from the last
  // flush — so a burst that starts long after the previous save doesn't
  // inherit a stale reference point and trip DEBOUNCE_MAX_MS immediately.
  let firstTriggerAt = 0;
  let lastTriggerAt = 0;
  let pendingValue: T | undefined;

  const doFlush = () => {
    timer = null;
    if (pendingValue !== undefined) {
      const value = pendingValue;
      pendingValue = undefined;
      onFlush(value);
    }
  };

  const check = () => {
    const now = Date.now();
    if (now - firstTriggerAt >= DEBOUNCE_MAX_MS) {
      doFlush();
    } else if (now - lastTriggerAt >= DEBOUNCE_MS - DEBOUNCE_EPS_MS) {
      doFlush();
    } else {
      timer = setTimeout(check, DEBOUNCE_MS);
    }
  };

  return {
    notify(value: T) {
      pendingValue = value;
      const now = Date.now();
      lastTriggerAt = now;
      if (timer === null) {
        firstTriggerAt = now;
        timer = setTimeout(check, DEBOUNCE_MS);
      }
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
