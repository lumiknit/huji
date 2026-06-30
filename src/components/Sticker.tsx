import {
  type Component,
  createSignal,
  createMemo,
  createResource,
  createEffect,
  Show,
  For,
} from "solid-js";
import {
  TbOutlineX,
  TbOutlineSearch,
  TbOutlineChevronDown,
  TbOutlineChevronUp,
  TbOutlineNote,
} from "solid-icons/tb";

import { getContent } from "../lib/db/content";
import { renderMarkdown } from "../lib/md/render";
import { editorState } from "../states/editor";
import {
  stickerSectionId,
  setStickerSectionId,
  stickerLayout,
  cycleLayout,
  closeSticker,
} from "../states/sticker";
import { stickerWidth } from "../states/settings";

// ── Inline search helpers ──

const highlightMatches = (container: HTMLElement, query: string): Element[] => {
  // Clear previous highlights
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

// ── Main component ──

const Sticker: Component = () => {
  let bodyEl!: HTMLElement;
  let searchInputEl!: HTMLInputElement;

  const [searchQuery, setSearchQuery] = createSignal("");
  const [matchIdx, setMatchIdx] = createSignal(0);
  const [showSearch, setShowSearch] = createSignal(false);
  const [matches, setMatches] = createSignal<Element[]>([]);

  // Section selector
  const bodyMetas = createMemo(() =>
    editorState.metas().filter((m) => m.level >= 0),
  );

  // Resolve default to first body section
  const resolvedSectionId = createMemo(() => {
    const id = stickerSectionId();
    if (id) return id;
    return bodyMetas()[0]?.id ?? null;
  });

  const [content] = createResource(resolvedSectionId, async (id) => {
    if (!id) return "";
    const row = await getContent(id);
    return row?.content ?? "";
  });

  const html = createMemo(() => renderMarkdown(content() ?? ""));

  // Auto-focus search input when opened
  createEffect(() => {
    if (showSearch() && searchInputEl) {
      searchInputEl.focus();
    }
  });

  // Reset scroll and clear stale search matches on section change
  createEffect(() => {
    resolvedSectionId();
    if (bodyEl) bodyEl.scrollTop = 0;
    setMatches([]);
    setMatchIdx(0);
  });

  const runSearch = (q: string) => {
    if (!bodyEl) return;
    const found = highlightMatches(bodyEl, q);
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

  // Close search when layout collapses
  createEffect(() => {
    if (layout() === "collapsed" && showSearch()) {
      setShowSearch(false);
      setSearchQuery("");
      setMatches([]);
      setMatchIdx(0);
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (showSearch()) {
        setShowSearch(false);
        setSearchQuery("");
        runSearch("");
      } else {
        closeSticker();
      }
    }
  };

  const layout = stickerLayout;

  return (
    <div
      class="sticker"
      onKeyDown={handleKeyDown}
      style={{
        width:
          layout() !== "collapsed"
            ? `min(75vw, ${stickerWidth()}px)`
            : undefined,
      }}
      classList={{
        "sticker-left": layout() === "left" || layout() === "left-long",
        "sticker-right": layout() === "right" || layout() === "right-long",
        "sticker-long": layout() === "left-long" || layout() === "right-long",
        "sticker-collapsed": layout() === "collapsed",
      }}
    >
      {/* Header */}
      <div class="sticker-header">
        <button
          class="sticker-btn sticker-icon-btn"
          title="Change layout"
          onClick={cycleLayout}
        >
          <TbOutlineNote class="sticker-icon" />
        </button>
        <Show when={layout() !== "collapsed"}>
          <select
            class="sticker-section-select"
            value={resolvedSectionId() ?? ""}
            onChange={(e) => setStickerSectionId(e.currentTarget.value)}
          >
            <For each={bodyMetas()}>
              {(m, i) => (
                <option value={m.id}>
                  {editorState.sectionLabels().get(m.id) ||
                    `Section ${i() + 1}`}
                </option>
              )}
            </For>
          </select>
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
        </Show>
        <button
          class="sticker-btn"
          title="Close sticker"
          onClick={closeSticker}
        >
          <TbOutlineX />
        </button>
      </div>

      {/* Search bar */}
      <Show when={showSearch() && layout() !== "collapsed"}>
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

      {/* Body */}
      <Show when={layout() !== "collapsed"}>
        <article
          ref={(el) => {
            bodyEl = el;
          }}
          class="sticker-body md-body"
          innerHTML={html()}
        />
      </Show>
    </div>
  );
};

export default Sticker;
