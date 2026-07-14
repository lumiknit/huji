import {
  type Component,
  createSignal,
  createMemo,
  createEffect,
  For,
  Show,
} from "solid-js";
import { buildHiddenIds } from "../../lib/export";
import {
  type RenderRule,
  type SectionEntry,
  countChars,
  countWords,
  plainText,
  type CountMode,
} from "../../lib/preview";

type Props = {
  entries: SectionEntry[];
  activeRule: RenderRule | null;
};

const OutlineView: Component<Props> = (props) => {
  const [countMode, setCountMode] = createSignal<CountMode>("default");
  // Sections are checked by default; this tracks only user-initiated opt-outs,
  // so rule-driven hiddenIds changes never clobber a manual selection.
  const [uncheckedIds, setUncheckedIds] = createSignal<Set<string>>(new Set());
  let headerCheckRef: HTMLInputElement | undefined;

  const hiddenIds = createMemo(() =>
    buildHiddenIds(
      props.entries.map((e) => e.meta),
      props.activeRule?.excludeAll,
    ),
  );

  const isExcludedEntry = (e: SectionEntry): boolean =>
    hiddenIds().has(e.meta.id);

  const isChecked = (id: string): boolean =>
    !hiddenIds().has(id) && !uncheckedIds().has(id);

  createEffect(() => {
    props.entries;
    setUncheckedIds(new Set<string>());
  });

  const rowTexts = createMemo(() =>
    props.entries.map((e) => {
      const excluded = isExcludedEntry(e);
      const text = excluded ? "" : plainText(e.content);
      const words = excluded ? 0 : countWords(text);
      return { entry: e, excluded, text, words };
    }),
  );

  const rows = createMemo(() => {
    const mode = countMode();
    return rowTexts().map((r) => ({
      entry: r.entry,
      excluded: r.excluded,
      words: r.words,
      chars: r.excluded ? 0 : countChars(r.text, mode),
    }));
  });

  const nonExcludedRows = createMemo(() => rows().filter((r) => !r.excluded));
  const allChecked = createMemo(() => {
    const ne = nonExcludedRows();
    return ne.length > 0 && ne.every((r) => isChecked(r.entry.meta.id));
  });
  const someChecked = createMemo(() =>
    nonExcludedRows().some((r) => isChecked(r.entry.meta.id)),
  );

  createEffect(() => {
    if (headerCheckRef)
      headerCheckRef.indeterminate = someChecked() && !allChecked();
  });

  const toggleAll = () => {
    if (allChecked()) {
      setUncheckedIds(
        new Set<string>(nonExcludedRows().map((r) => r.entry.meta.id)),
      );
    } else {
      setUncheckedIds(new Set<string>());
    }
  };

  const toggleRow = (id: string) => {
    setUncheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const checkedRows = createMemo(() =>
    rows().filter((r) => !r.excluded && isChecked(r.entry.meta.id)),
  );
  const totals = createMemo(() =>
    checkedRows().reduce(
      (acc, r) => ({ chars: acc.chars + r.chars, words: acc.words + r.words }),
      { chars: 0, words: 0 },
    ),
  );
  const checkedCount = createMemo(() => checkedRows().length);

  return (
    <div class="outline-view">
      <div class="outline-controls">
        <label>
          Count mode
          <select
            value={countMode()}
            onChange={(e) => setCountMode(e.currentTarget.value as CountMode)}
          >
            <option value="default">Default</option>
            <option value="ignore-spaces">Ignore spaces</option>
          </select>
        </label>
      </div>
      <table class="outline-table">
        <thead>
          <tr>
            <th>
              <input
                ref={headerCheckRef}
                type="checkbox"
                checked={allChecked()}
                onChange={toggleAll}
              />
            </th>
            <th>Section</th>
            <th class="outline-num">Chars</th>
            <th class="outline-num">Words</th>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(r) => (
              <tr class={r.excluded ? "outline-excluded" : undefined}>
                <td>
                  <Show when={!r.excluded}>
                    <input
                      type="checkbox"
                      checked={isChecked(r.entry.meta.id)}
                      onChange={() => toggleRow(r.entry.meta.id)}
                    />
                  </Show>
                </td>
                <td class="outline-heading">
                  {r.entry.meta.heading ? (
                    "#".repeat(r.entry.meta.level) + " " + r.entry.meta.heading
                  ) : (
                    <em>(untitled)</em>
                  )}
                </td>
                <td class="outline-num">
                  {r.excluded ? (
                    <span class="outline-excluded-mark">—</span>
                  ) : (
                    r.chars.toLocaleString()
                  )}
                </td>
                <td class="outline-num">
                  {r.excluded ? (
                    <span class="outline-excluded-mark">—</span>
                  ) : (
                    r.words.toLocaleString()
                  )}
                </td>
              </tr>
            )}
          </For>
        </tbody>
        <tfoot>
          <tr class="outline-total">
            <td />
            <td>
              <strong>Total</strong>
            </td>
            <td class="outline-num">
              <strong>{totals().chars.toLocaleString()}</strong>
            </td>
            <td class="outline-num">
              <strong>{totals().words.toLocaleString()}</strong>
            </td>
          </tr>
          <tr>
            <td />
            <td>Avg.</td>
            <td class="outline-num">
              {checkedCount() > 0
                ? (totals().chars / checkedCount()).toFixed(1)
                : "—"}
            </td>
            <td class="outline-num">
              {checkedCount() > 0
                ? (totals().words / checkedCount()).toFixed(1)
                : "—"}
            </td>
          </tr>
          <tr>
            <td />
            <td>Manuscript pages</td>
            <td class="outline-num">{(totals().chars / 200).toFixed(1)}</td>
            <td class="outline-num">—</td>
          </tr>
          <tr>
            <td />
            <td>A5 Pages</td>
            <td class="outline-num">{(totals().chars / 600).toFixed(1)}</td>
            <td class="outline-num">{(totals().words / 250).toFixed(1)}</td>
          </tr>
        </tfoot>
      </table>

      <ul>
        <li>Manuscript page: 200 chars 원고지</li>
        <li>A5 page = reading minutes</li>
      </ul>
    </div>
  );
};

export default OutlineView;
