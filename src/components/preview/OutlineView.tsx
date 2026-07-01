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
  const [checkedIds, setCheckedIds] = createSignal<Set<string>>(new Set());
  let headerCheckRef: HTMLInputElement | undefined;

  const hiddenIds = createMemo(() =>
    buildHiddenIds(
      props.entries.map((e) => e.meta),
      props.activeRule?.excludeAll,
    ),
  );

  const isExcludedEntry = (e: SectionEntry): boolean =>
    hiddenIds().has(e.meta.id);

  createEffect(() => {
    const newSet = new Set<string>();
    for (const e of props.entries) {
      if (!isExcludedEntry(e)) newSet.add(e.meta.id);
    }
    setCheckedIds(newSet);
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
    return ne.length > 0 && ne.every((r) => checkedIds().has(r.entry.meta.id));
  });
  const someChecked = createMemo(() =>
    nonExcludedRows().some((r) => checkedIds().has(r.entry.meta.id)),
  );

  createEffect(() => {
    if (headerCheckRef)
      headerCheckRef.indeterminate = someChecked() && !allChecked();
  });

  const toggleAll = () => {
    if (allChecked()) {
      setCheckedIds(new Set<string>());
    } else {
      setCheckedIds(new Set(nonExcludedRows().map((r) => r.entry.meta.id)));
    }
  };

  const toggleRow = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const checkedRows = createMemo(() =>
    rows().filter((r) => !r.excluded && checkedIds().has(r.entry.meta.id)),
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
                      checked={checkedIds().has(r.entry.meta.id)}
                      onChange={() => toggleRow(r.entry.meta.id)}
                    />
                  </Show>
                </td>
                <td class="outline-heading">
                  {r.entry.meta.heading ? (
                    "#".repeat(r.entry.meta.level) + r.entry.meta.heading
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
            <td>Avg</td>
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
          <tr>
            <td />
            <td>Reading time</td>
            <td class="outline-num">{(totals().chars / 600).toFixed(1)} min</td>
            <td class="outline-num">{(totals().words / 200).toFixed(1)} min</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

export default OutlineView;
