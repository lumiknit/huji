import { type Component, onMount, onCleanup, For, Show } from "solid-js";
import {
  TbOutlineSearch,
  TbOutlineReplace,
  TbOutlineX,
  TbOutlineArrowRight,
  TbOutlineNote,
} from "solid-icons/tb";

import { goToSection } from "../states/editor";
import { openSticker } from "../states/sticker";
import {
  findQuery,
  findQueryRaw,
  setFindQuery,
  findMode,
  setFindMode,
  replaceText,
  setReplaceText,
  findLoading,
  findReplacing,
  findResults,
  findTotalMatches,
  regexError,
  isFindExcluded,
  toggleFindExclude,
  replaceMatch,
  replaceAll,
  loadFindContents,
  isFindContentsLoaded,
  findContents,
  setFindExcluded,
  type SearchMode,
} from "../states/find";

const CONTEXT_LEN = 100;

const getContext = (
  text: string,
  start: number,
  end: number,
): { before: string; match: string; after: string } => {
  // Clamp to the current line first, then limit to CONTEXT_LEN chars
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = (() => {
    const idx = text.indexOf("\n", end);
    return idx === -1 ? text.length : idx;
  })();

  const rawBefore = text.slice(Math.max(lineStart, start - CONTEXT_LEN), start);
  const rawAfter = text.slice(end, Math.min(lineEnd, end + CONTEXT_LEN));

  const trimmedBefore = start - CONTEXT_LEN > lineStart;
  const trimmedAfter = end + CONTEXT_LEN < lineEnd;

  return {
    before: (trimmedBefore ? "…" : "") + rawBefore,
    match: text.slice(start, end),
    after: rawAfter + (trimmedAfter ? "…" : ""),
  };
};

type Props = { fileId: string; onClose: () => void };

const FindReplaceModal: Component<Props> = (props) => {
  let dialogEl!: HTMLDialogElement;
  let queryInputEl!: HTMLInputElement;

  onMount(async () => {
    dialogEl.showModal();
    if (!isFindContentsLoaded() && !findLoading()) {
      await loadFindContents();
    }
    queryInputEl?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    dialogEl.addEventListener("keydown", handleKeyDown);
    onCleanup(() => dialogEl.removeEventListener("keydown", handleKeyDown));
  });

  const goToMatch = async (m: {
    sectionId: string;
    start: number;
    end: number;
  }) => {
    // close() fires the native close event → onClose → setShowFind(false)
    // Proper dialog close releases the modal focus trap before we focus the editor
    dialogEl.close();
    await new Promise<void>((r) => setTimeout(r, 50));
    await goToSection(m.sectionId, { selStart: m.start, selEnd: m.end });
  };

  return (
    <dialog ref={dialogEl!} class="find-modal" onClose={props.onClose}>
      <div class="find-modal-header">
        <span class="find-modal-title">Find & Replace</span>
        <button class="find-modal-close" onClick={props.onClose}>
          <TbOutlineX />
        </button>
      </div>

      <div class="find-form">
        <div class="find-row">
          <TbOutlineSearch />
          <input
            ref={queryInputEl!}
            type="search"
            placeholder="Find…"
            value={findQueryRaw()}
            onInput={(e) => {
              setFindQuery(e.currentTarget.value);
              setFindExcluded(new Set<string>());
            }}
          />
          <select
            class="find-mode-select"
            value={findMode()}
            onChange={(e) => {
              setFindMode(e.currentTarget.value as SearchMode);
              setFindExcluded(new Set<string>());
            }}
          >
            <option value="exact">Exactly</option>
            <option value="regex">Regex</option>
            <option value="regex_i">Regex (i)</option>
          </select>
        </div>

        <div class="find-row">
          <TbOutlineReplace />
          <input
            type="text"
            placeholder="Replace…"
            value={replaceText()}
            onInput={(e) => setReplaceText(e.currentTarget.value)}
          />
          <button
            onClick={replaceAll}
            disabled={findTotalMatches() === 0 || findReplacing()}
          >
            Replace All
          </button>
        </div>

        <Show when={regexError()}>
          <p class="find-error">{regexError()}</p>
        </Show>
      </div>

      <div class="find-results">
        <Show
          when={!findLoading()}
          fallback={<p class="find-hint">Loading…</p>}
        >
          <Show
            when={findQuery() && !regexError()}
            fallback={<p class="find-hint">Enter a search query.</p>}
          >
            <p class="find-summary">
              <strong>{findTotalMatches()}</strong> match
              {findTotalMatches() !== 1 ? "es" : ""} in{" "}
              <strong>{findResults().length}</strong> section
              {findResults().length !== 1 ? "s" : ""}
            </p>
            <Show
              when={findResults().length > 0}
              fallback={<p class="find-hint">No results.</p>}
            >
              <For each={findResults()}>
                {(sr) => (
                  <div class="find-section">
                    <p class="find-section-label">
                      {sr.label || "(no heading)"}
                    </p>
                    <For each={sr.matches}>
                      {(match) => {
                        const text = () =>
                          findContents().get(match.sectionId) ?? "";
                        const ctx = () =>
                          getContext(text(), match.start, match.end);
                        const pct = () => {
                          const len = text().length;
                          return len > 0
                            ? Math.round((match.start / len) * 100)
                            : 0;
                        };
                        return (
                          <div
                            class={`find-match-row${isFindExcluded(match) ? " excluded" : ""}`}
                          >
                            <span class="find-match-ctx">
                              <span class="ctx-dim">{ctx().before}</span>
                              <mark>{ctx().match}</mark>
                              <span class="ctx-dim">{ctx().after}</span>
                            </span>
                            <div class="find-match-actions">
                              <span class="find-match-pct">~{pct()}%</span>
                              <button
                                title="Go to match"
                                onClick={() => goToMatch(match)}
                              >
                                <TbOutlineArrowRight /> Jump
                              </button>
                              <button
                                title="Open section in Sticker"
                                onClick={() => openSticker(match.sectionId)}
                              >
                                <TbOutlineNote /> Sticker
                              </button>
                              <button
                                title="Replace this match"
                                onClick={() => replaceMatch(match)}
                                disabled={
                                  isFindExcluded(match) || findReplacing()
                                }
                              >
                                <TbOutlineReplace /> Replace
                              </button>
                              <button
                                title={
                                  isFindExcluded(match) ? "Include" : "Exclude"
                                }
                                onClick={() => toggleFindExclude(match)}
                              >
                                <TbOutlineX />{" "}
                                {isFindExcluded(match) ? "Include" : "Exclude"}
                              </button>
                            </div>
                          </div>
                        );
                      }}
                    </For>
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

export default FindReplaceModal;
