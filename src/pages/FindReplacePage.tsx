import {
  type Component,
  createSignal,
  createMemo,
  onMount,
  For,
  Show,
  batch,
} from "solid-js";
import { createDebouncedSignal } from "../lib/utils/debounce";
import { useParams, useNavigate, A } from "@solidjs/router";
import {
  TbOutlineArrowLeft,
  TbOutlineSearch,
  TbOutlineReplace,
  TbOutlineX,
  TbOutlineArrowRight,
} from "solid-icons/tb";

import { getContent } from "../lib/db/content";
import { buildSectionLabel } from "../lib/md/section";
import { editorState, loadFile, setPendingJump } from "../states/editor";
import { saveSectionDirectly } from "../states/editor_save";
import type { SectionMeta } from "../lib/db/schema";
import Toolbar from "../components/Toolbar";

type Match = {
  sectionId: string;
  start: number;
  end: number;
};

type SectionResult = {
  meta: SectionMeta;
  label: string;
  matches: Match[];
};

const CONTEXT_LEN = 40;

const getContext = (
  text: string,
  start: number,
  end: number,
): { before: string; match: string; after: string } => {
  const before = text.slice(Math.max(0, start - CONTEXT_LEN), start);
  const match = text.slice(start, end);
  const after = text.slice(end, end + CONTEXT_LEN);
  return {
    before: (start > CONTEXT_LEN ? "…" : "") + before,
    match,
    after: after + (end + CONTEXT_LEN < text.length ? "…" : ""),
  };
};

const FindReplacePage: Component = () => {
  const params = useParams<{ fileId: string }>();
  const navigate = useNavigate();

  const [contents, setContents] = createSignal<Map<string, string>>(new Map());
  const [queryRaw, setQueryRaw] = createSignal("");
  const [query, setQuery] = createDebouncedSignal("", 300);
  const [searchMode, setSearchMode] = createSignal<
    "exact" | "regex" | "regex_i"
  >("exact");
  const [replaceText, setReplaceText] = createSignal("");
  const [excluded, setExcluded] = createSignal<Set<string>>(new Set());
  const [loading, setLoading] = createSignal(true);

  let queryInputEl!: HTMLInputElement;

  onMount(async () => {
    if (editorState.fileId() !== params.fileId) {
      await loadFile(params.fileId);
    }
    const bodyMetas = editorState.metas().filter((m) => m.level >= 0);
    const map = new Map<string, string>();
    await Promise.all(
      bodyMetas.map(async (m) => {
        const row = await getContent(m.id);
        map.set(m.id, row?.content ?? "");
      }),
    );
    batch(() => {
      setContents(map);
      setLoading(false);
    });
    setTimeout(() => queryInputEl?.focus(), 0);
  });

  const buildRegex = (
    q: string,
    mode: "exact" | "regex" | "regex_i",
  ): RegExp | null => {
    if (!q) return null;
    try {
      const pattern =
        mode === "exact" ? q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : q;
      const flags = mode === "regex_i" ? "gi" : "g";
      return new RegExp(pattern, flags);
    } catch {
      return null;
    }
  };

  const results = createMemo<SectionResult[]>(() => {
    const q = query();
    const mode = searchMode();
    const re = buildRegex(q, mode);
    if (!re) return [];

    const map = contents();
    const metaList = editorState.metas();
    const bodyMetas = metaList.filter((m: SectionMeta) => m.level >= 0);
    const out: SectionResult[] = [];

    for (const meta of bodyMetas) {
      const text = map.get(meta.id) ?? "";
      const matches: Match[] = [];
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        matches.push({
          sectionId: meta.id,
          start: m.index,
          end: m.index + m[0].length,
        });
        if (m[0].length === 0) re.lastIndex++;
      }
      if (matches.length > 0) {
        const idx = metaList.indexOf(meta);
        out.push({ meta, label: buildSectionLabel(metaList, idx), matches });
      }
    }
    return out;
  });

  const totalMatches = createMemo(() =>
    results().reduce((s, r) => s + r.matches.length, 0),
  );

  const excludeKey = (m: Match) => `${m.sectionId}:${m.start}:${m.end}`;

  const isExcluded = (m: Match) => excluded().has(excludeKey(m));

  const toggleExclude = (m: Match) => {
    const key = excludeKey(m);
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const goToMatch = (m: Match) => {
    setPendingJump(m.sectionId, m.start, m.end);
    navigate(`/edit/${params.fileId}`);
  };

  const applyReplace = async (sectionId: string, newText: string) => {
    await saveSectionDirectly(sectionId, newText);
    setContents((prev) => {
      const next = new Map(prev);
      next.set(sectionId, newText);
      return next;
    });
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const key of [...next]) {
        if (key.startsWith(`${sectionId}:`)) next.delete(key);
      }
      return next;
    });
  };

  const replaceMatch = async (match: Match) => {
    const text = contents().get(match.sectionId) ?? "";
    const re = buildRegex(query(), searchMode());
    if (!re) return;

    let newText = "";
    let lastIdx = 0;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let replaced = false;
    while ((m = re.exec(text)) !== null) {
      if (
        m.index === match.start &&
        m.index + m[0].length === match.end &&
        !replaced
      ) {
        newText += text.slice(lastIdx, m.index) + replaceText();
        lastIdx = m.index + m[0].length;
        replaced = true;
      }
      if (m[0].length === 0) re.lastIndex++;
    }
    newText += text.slice(lastIdx);
    await applyReplace(match.sectionId, newText);
  };

  const replaceAll = async () => {
    const q = query();
    const re = buildRegex(q, searchMode());
    if (!re) return;

    const allResults = results();
    const excl = excluded();

    for (const sr of allResults) {
      const text = contents().get(sr.meta.id) ?? "";
      let newText = "";
      let lastIdx = 0;
      re.lastIndex = 0;
      let changed = false;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const key = `${sr.meta.id}:${m.index}:${m.index + m[0].length}`;
        if (!excl.has(key)) {
          newText += text.slice(lastIdx, m.index) + replaceText();
          lastIdx = m.index + m[0].length;
          changed = true;
        } else {
          newText += text.slice(lastIdx, m.index + m[0].length);
          lastIdx = m.index + m[0].length;
        }
        if (m[0].length === 0) re.lastIndex++;
      }
      newText += text.slice(lastIdx);
      if (changed) await applyReplace(sr.meta.id, newText);
    }
  };

  const regexError = createMemo(() => {
    const q = queryRaw();
    const mode = searchMode();
    if (!q || mode === "exact") return "";
    try {
      new RegExp(q);
      return "";
    } catch (e) {
      return String(e);
    }
  });

  return (
    <main>
      <Toolbar title={`Find — ${editorState.filename()}`}>
        <A href={`/edit/${params.fileId}`} title="Back">
          <TbOutlineArrowLeft />
        </A>
      </Toolbar>

      <div class="find-form">
        <div class="find-row">
          <TbOutlineSearch />
          <input
            ref={queryInputEl}
            type="text"
            placeholder="Find…"
            value={queryRaw()}
            onInput={(e) => {
              setQueryRaw(e.currentTarget.value);
              setQuery(e.currentTarget.value);
              setExcluded(new Set<string>());
            }}
          />
          <select
            class="find-mode-select"
            value={searchMode()}
            onChange={(e) => {
              setSearchMode(
                e.currentTarget.value as "exact" | "regex" | "regex_i",
              );
              setExcluded(new Set<string>());
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
          <button onClick={replaceAll} disabled={totalMatches() === 0}>
            Replace All
          </button>
        </div>

        <Show when={regexError()}>
          <p class="find-error">{regexError()}</p>
        </Show>
      </div>

      <Show when={!loading()}>
        <Show
          when={queryRaw() && !regexError()}
          fallback={<p class="find-hint">Enter a search query.</p>}
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
                  <p class="find-section-label">{sr.label || "(no heading)"}</p>
                  <For each={sr.matches}>
                    {(match) => {
                      const text = () => contents().get(match.sectionId) ?? "";
                      const ctx = () =>
                        getContext(text(), match.start, match.end);
                      return (
                        <div
                          class={`find-match-row${isExcluded(match) ? " excluded" : ""}`}
                        >
                          <span class="find-match-ctx">
                            <span class="ctx-dim">{ctx().before}</span>
                            <mark>{ctx().match}</mark>
                            <span class="ctx-dim">{ctx().after}</span>
                          </span>
                          <button
                            title="Go to match"
                            onClick={() => goToMatch(match)}
                          >
                            <TbOutlineArrowRight />
                          </button>
                          <button
                            title="Replace this match"
                            onClick={() => replaceMatch(match)}
                            disabled={isExcluded(match)}
                          >
                            <TbOutlineReplace />
                          </button>
                          <button
                            title={isExcluded(match) ? "Include" : "Exclude"}
                            onClick={() => toggleExclude(match)}
                          >
                            <TbOutlineX />
                          </button>
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
    </main>
  );
};

export default FindReplacePage;
