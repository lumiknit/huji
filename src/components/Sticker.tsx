import {
  type Component,
  createSignal,
  createMemo,
  createResource,
  createEffect,
  onMount,
  onCleanup,
  Show,
  For,
} from "solid-js";
import {
  TbOutlineSearch,
  TbOutlineChevronDown,
  TbOutlineChevronUp,
  TbOutlinePin,
  TbFillPinned,
  TbOutlineNote,
} from "solid-icons/tb";

import { getContent } from "../lib/db/content";
import { renderMarkdown } from "../lib/md/render";
import { editorState } from "../states/editor";
import {
  stickerPinState,
  stickerVisible,
  setStickerVisible,
  stickerSectionIds,
  setStickerSectionSlot,
  togglePin,
} from "../states/sticker";
import { stickerSide, stickerWidth } from "../states/settings";

// ── Inline search helpers ──

const highlightMatches = (container: HTMLElement, query: string): Element[] => {
  container.querySelectorAll("mark.sticker-hl").forEach((m) => {
    const parent = m.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(m.textContent ?? ""), m);
      parent.normalize();
    }
  });
  if (!query) return [];

  const results: Element[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const lower = query.toLowerCase();
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);

  for (const textNode of nodes) {
    const text = textNode.textContent ?? "";
    const lowerText = text.toLowerCase();
    let idx = lowerText.indexOf(lower);
    if (idx === -1) continue;

    const frag = document.createDocumentFragment();
    let last = 0;
    while (idx !== -1) {
      if (idx > last)
        frag.appendChild(document.createTextNode(text.slice(last, idx)));
      const mark = document.createElement("mark");
      mark.className = "sticker-hl";
      mark.textContent = text.slice(idx, idx + query.length);
      frag.appendChild(mark);
      results.push(mark);
      last = idx + query.length;
      idx = lowerText.indexOf(lower, last);
    }
    if (last < text.length)
      frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
  return results;
};

// ── Slot (top/bottom body) ──

const StickerSlot: Component<{
  sectionId: string | null;
  bodyRef: (el: HTMLElement) => void;
}> = (props) => {
  const [content] = createResource(
    () => props.sectionId,
    async (id) => {
      if (!id) return "";
      const row = await getContent(id);
      return row?.content ?? "";
    },
  );
  const html = createMemo(() => renderMarkdown(content() ?? ""));

  return (
    <Show when={props.sectionId}>
      <div class="sticker-slot">
        <article
          ref={(el) => props.bodyRef(el)}
          class="sticker-body md-body"
          innerHTML={html()}
        />
      </div>
    </Show>
  );
};

// ── Main component ──

const Sticker: Component = () => {
  let rootEl!: HTMLDivElement;
  let bodyEls: (HTMLElement | undefined)[] = [undefined, undefined];
  let searchInputEl!: HTMLInputElement;

  const [searchQuery, setSearchQuery] = createSignal("");
  const [matchIdx, setMatchIdx] = createSignal(0);
  const [showSearch, setShowSearch] = createSignal(false);
  const [matches, setMatches] = createSignal<Element[]>([]);

  const bodyMetas = createMemo(() =>
    editorState.metas().filter((m) => m.level >= 0),
  );

  const runSearch = (q: string) => {
    const found = bodyEls
      .filter((el): el is HTMLElement => !!el)
      .flatMap((el) => highlightMatches(el, q));
    setMatches(found);
    setMatchIdx(0);
    if (found.length > 0) found[0].scrollIntoView({ block: "nearest" });
  };

  const goToMatch = (delta: number) => {
    const m = matches();
    if (m.length === 0) return;
    const next = (matchIdx() + delta + m.length) % m.length;
    setMatchIdx(next);
    m[next].scrollIntoView({ block: "nearest" });
  };

  // Auto-focus search input when opened
  createEffect(() => {
    if (showSearch() && searchInputEl) {
      searchInputEl.focus();
    }
  });

  // Reset stale search matches when the visible sections change
  createEffect(() => {
    stickerSectionIds();
    setMatches([]);
    setMatchIdx(0);
    if (showSearch()) runSearch(searchQuery());
  });

  // Collapse to FAB on outside click while unpinned
  onMount(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (
        stickerPinState() === "unpinned" &&
        stickerVisible() &&
        rootEl &&
        !rootEl.contains(e.target as Node)
      ) {
        setStickerVisible(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    onCleanup(() => document.removeEventListener("pointerdown", onPointerDown));
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && showSearch()) {
      setShowSearch(false);
      setSearchQuery("");
      runSearch("");
    }
  };

  const sectionSelect = (slot: number) => (
    <select
      class="sticker-section-select"
      value={stickerSectionIds()[slot] ?? ""}
      onChange={(e) =>
        setStickerSectionSlot(slot, e.currentTarget.value || null)
      }
    >
      <option value="">(Off)</option>
      <For each={bodyMetas()}>
        {(m, i) => (
          <option value={m.id}>
            {editorState.sectionLabels().get(m.id) || `Section ${i() + 1}`}
          </option>
        )}
      </For>
    </select>
  );

  return (
    <Show
      when={stickerVisible()}
      fallback={
        <div
          class="sticker-fab"
          classList={{ [`sticker-${stickerSide()}`]: true }}
        >
          <button
            class="sticker-fab-btn"
            title="Expand sticker"
            onClick={() => setStickerVisible(true)}
          >
            <TbOutlineNote class="sticker-icon" />
          </button>
        </div>
      }
    >
      <div
        ref={rootEl!}
        class="sticker"
        onKeyDown={handleKeyDown}
        style={{ width: `min(75vw, ${stickerWidth()}px)` }}
        classList={{ [`sticker-${stickerSide()}`]: true }}
      >
        {/* Header */}
        <div class="sticker-header">
          <button
            class="sticker-btn sticker-icon-btn"
            classList={{ active: stickerPinState() === "pinned" }}
            title={stickerPinState() === "pinned" ? "Unpin" : "Pin"}
            onClick={togglePin}
          >
            <Show
              when={stickerPinState() === "pinned"}
              fallback={<TbOutlinePin class="sticker-icon" />}
            >
              <TbFillPinned class="sticker-icon" />
            </Show>
          </button>
          {sectionSelect(0)}
          <button
            class="sticker-btn"
            title="Search in sticker"
            onClick={() => {
              setShowSearch((v) => !v);
              if (!showSearch()) {
                setSearchQuery("");
                runSearch("");
              }
            }}
          >
            <TbOutlineSearch />
          </button>
        </div>

        {/* Search bar */}
        <Show when={showSearch()}>
          <div class="sticker-search">
            <input
              ref={searchInputEl!}
              type="search"
              placeholder="Search…"
              value={searchQuery()}
              onInput={(e) => {
                const q = e.currentTarget.value;
                setSearchQuery(q);
                runSearch(q);
              }}
            />
            <span class="sticker-search-count">
              {matches().length > 0
                ? `${matchIdx() + 1}/${matches().length}`
                : "0"}
            </span>
            <button class="sticker-btn" onClick={() => goToMatch(-1)}>
              <TbOutlineChevronUp />
            </button>
            <button class="sticker-btn" onClick={() => goToMatch(1)}>
              <TbOutlineChevronDown />
            </button>
          </div>
        </Show>

        {/* Body slots */}
        <div class="sticker-slots">
          <StickerSlot
            sectionId={stickerSectionIds()[0] ?? null}
            bodyRef={(el) => (bodyEls[0] = el)}
          />
          <StickerSlot
            sectionId={stickerSectionIds()[1] ?? null}
            bodyRef={(el) => (bodyEls[1] = el)}
          />
        </div>

        {/* Footer */}
        <div class="sticker-footer">{sectionSelect(1)}</div>
      </div>
    </Show>
  );
};

export default Sticker;
