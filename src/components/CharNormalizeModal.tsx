import {
  type Component,
  onMount,
  onCleanup,
  createSignal,
  createMemo,
  For,
  Show,
} from "solid-js";
import { TbOutlineTypography, TbOutlineX, TbOutlineWand } from "solid-icons/tb";

import { getContents } from "../lib/db/content";
import { buildSectionLabel } from "../lib/md/section";
import {
  normalizeCharacters,
  defaultCharNormalizeOptions,
  type CharNormalizeOptions,
  type QuotesMode,
  type DashMode,
  type EllipsisMode,
  type FullwidthMode,
  type WhitespaceMode,
  type SpecialCharMode,
} from "../lib/char_normalize";
import { editorState, bumpActiveContent } from "../states/editor";
import { saveSectionDirectly } from "../states/editor_save";
import type { SectionMeta } from "../lib/db/schema";

type SectionResult = {
  meta: SectionMeta;
  label: string;
  count: number;
};

type Props = {
  onClose: () => void;
};

const CharNormalizeModal: Component<Props> = (props) => {
  let dialogEl!: HTMLDialogElement;

  // All state below is local to this modal instance on purpose: it should
  // always start fresh (unloaded, unsearched) whenever the modal is opened,
  // rather than remembering the previous open's search across close/reopen.
  const [options, setOptions] = createSignal<CharNormalizeOptions>(
    defaultCharNormalizeOptions(),
  );
  const [contents, setContents] = createSignal<Map<string, string>>(new Map());
  const [loading, setLoading] = createSignal(false);
  const [applying, setApplying] = createSignal(false);
  const [searched, setSearched] = createSignal(false);
  const [searching, setSearching] = createSignal(false);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  const loadContents = async () => {
    setLoading(true);
    const bodyMetas = editorState.metas().filter((m) => m.level >= 0);
    const map = await getContents(bodyMetas.map((m) => m.id));
    setContents(map);
    setLoading(false);
  };

  onMount(async () => {
    dialogEl.showModal();
    await loadContents();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    dialogEl.addEventListener("keydown", handleKeyDown);
    onCleanup(() => dialogEl.removeEventListener("keydown", handleKeyDown));
    onCleanup(() => clearTimeout(searchTimer));
  });

  const results = createMemo<SectionResult[]>(() => {
    if (!searched()) return [];
    const opts = options();
    const map = contents();
    const metaList = editorState.metas();
    const bodyMetas = metaList.filter((m: SectionMeta) => m.level >= 0);
    const out: SectionResult[] = [];

    for (const meta of bodyMetas) {
      const text = map.get(meta.id) ?? "";
      const { count } = normalizeCharacters(text, opts);
      if (count > 0) {
        const idx = metaList.indexOf(meta);
        out.push({ meta, label: buildSectionLabel(metaList, idx), count });
      }
    }
    return out;
  });

  const totalMatches = createMemo(() =>
    results().reduce((s, r) => s + r.count, 0),
  );

  // The search itself is synchronous and instant, which reads as "nothing
  // happened" when clicking Search. Force a brief visible loading state so
  // the click clearly registers.
  const search = () => {
    clearTimeout(searchTimer);
    setSearching(true);
    searchTimer = setTimeout(() => {
      setSearched(true);
      setSearching(false);
    }, 300);
  };

  const applyAll = async () => {
    if (applying()) return;
    setApplying(true);
    try {
      const opts = options();
      for (const sr of results()) {
        const text = contents().get(sr.meta.id) ?? "";
        const { text: newText } = normalizeCharacters(text, opts);
        if (newText === text) continue;
        await saveSectionDirectly(sr.meta.id, newText);
        if (editorState.activeSectionId() === sr.meta.id) bumpActiveContent();
        setContents((prev) => {
          const next = new Map(prev);
          next.set(sr.meta.id, newText);
          return next;
        });
      }
    } finally {
      setApplying(false);
    }
  };

  return (
    <dialog ref={dialogEl!} class="modal" onClose={props.onClose}>
      <div class="modal-header">
        <span class="modal-title">
          <TbOutlineTypography /> Char Normalize
        </span>
        <button class="modal-close ghost" onClick={props.onClose}>
          <TbOutlineX />
        </button>
      </div>

      <div class="find-form">
        <table class="charnorm-table">
          <tbody>
            <tr>
              <th>Quotes</th>
              <td>
                <select
                  value={options().quotes}
                  onChange={(e) =>
                    setOptions((o) => ({
                      ...o,
                      quotes: e.currentTarget.value as QuotesMode,
                    }))
                  }
                >
                  <option value="keep">Keep</option>
                  <option value="ascii">Unicode to ASCII</option>
                </select>
              </td>
            </tr>
            <tr>
              <th>Ellipsis</th>
              <td>
                <select
                  value={options().ellipsis}
                  onChange={(e) =>
                    setOptions((o) => ({
                      ...o,
                      ellipsis: e.currentTarget.value as EllipsisMode,
                    }))
                  }
                >
                  <option value="keep">Keep</option>
                  <option value="ascii">ASCII (...)</option>
                  <option value="smart">Smart</option>
                </select>
              </td>
            </tr>
            <tr>
              <th>Dashes</th>
              <td>
                <select
                  value={options().dash}
                  onChange={(e) =>
                    setOptions((o) => ({
                      ...o,
                      dash: e.currentTarget.value as DashMode,
                    }))
                  }
                >
                  <option value="keep">Keep</option>
                  <option value="ascii">ASCII (-, --, ---)</option>
                  <option value="smart">Smart</option>
                </select>
              </td>
            </tr>
            <tr>
              <th>Fullwidth</th>
              <td>
                <select
                  value={options().fullwidth}
                  onChange={(e) =>
                    setOptions((o) => ({
                      ...o,
                      fullwidth: e.currentTarget.value as FullwidthMode,
                    }))
                  }
                >
                  <option value="keep">Keep</option>
                  <option value="halfwidth">Fullwidth to halfwidth</option>
                </select>
              </td>
            </tr>
            <tr>
              <th>Whitespace</th>
              <td>
                <select
                  value={options().whitespace}
                  onChange={(e) =>
                    setOptions((o) => ({
                      ...o,
                      whitespace: e.currentTarget.value as WhitespaceMode,
                    }))
                  }
                >
                  <option value="keep">Keep</option>
                  <option value="normalize">Normalize to space</option>
                  <option value="trim">
                    Normalize + collapse/trim per line
                  </option>
                </select>
              </td>
            </tr>
            <tr>
              <th>Invisible/special</th>
              <td>
                <select
                  value={options().special}
                  onChange={(e) =>
                    setOptions((o) => ({
                      ...o,
                      special: e.currentTarget.value as SpecialCharMode,
                    }))
                  }
                >
                  <option value="keep">Keep</option>
                  <option value="remove">Remove</option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="find-row charnorm-actions">
          <button onClick={search} disabled={loading() || searching()}>
            <TbOutlineWand /> Search
          </button>
          <button
            onClick={applyAll}
            disabled={!searched() || totalMatches() === 0 || applying()}
          >
            Replace All
          </button>
        </div>
      </div>

      <div class="modal-results">
        <Show
          when={!loading() && !searching()}
          fallback={
            <p class="find-hint">{searching() ? "Searching…" : "Loading…"}</p>
          }
        >
          <Show
            when={searched()}
            fallback={<p class="find-hint">Choose options and search.</p>}
          >
            <p class="find-summary">
              <strong>{totalMatches()}</strong> match
              {totalMatches() !== 1 ? "es" : ""} in{" "}
              <strong>{results().length}</strong> section
              {results().length !== 1 ? "s" : ""}
            </p>
            <Show
              when={results().length > 0}
              fallback={<p class="find-hint">No results.</p>}
            >
              <For each={results()}>
                {(sr) => (
                  <div class="find-section">
                    <p class="find-section-label">
                      {sr.label || "(no heading)"}
                    </p>
                    <p class="find-hint">{sr.count} match(es)</p>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </div>
    </dialog>
  );
};

export default CharNormalizeModal;
