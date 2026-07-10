import { createSignal, createMemo, batch } from "solid-js";
import { createDebouncedSignal } from "../lib/utils/debounce";
import { getContents } from "../lib/db/content";
import { buildSectionLabel } from "../lib/md/section";
import { editorState } from "./editor";
import { saveSectionDirectly } from "./editor_save";
import { bumpActiveContent } from "./editor";
import type { SectionMeta } from "../lib/db/schema";

export type SearchMode = "exact" | "regex" | "regex_i";

export type Match = {
  sectionId: string;
  start: number;
  end: number;
};

export type SectionResult = {
  meta: SectionMeta;
  label: string;
  matches: Match[];
};

// ── Persistent signals ──

export const [findQueryRaw, _setFindQueryRaw] = createSignal("");
const [findQuery, _setFindQueryDebounced] = createDebouncedSignal("", 300);
export { findQuery };
export const setFindQuery = (v: string) => {
  _setFindQueryRaw(v);
  _setFindQueryDebounced(v);
};
export const [findMode, setFindMode] = createSignal<SearchMode>("exact");
export const [replaceText, setReplaceText] = createSignal("");
export const [findContents, setFindContents] = createSignal<
  Map<string, string>
>(new Map());
const [findExcluded, _setFindExcluded] = createSignal<Set<string>>(new Set());
export const [findLoading, setFindLoading] = createSignal(false);
export const [findReplacing, setFindReplacing] = createSignal(false);
let _findContentsLoaded = false;

export { findExcluded };
export const setFindExcluded = (v: Set<string>) => _setFindExcluded(v);

// ── Reset (call when opening a new file) ──

export const resetFindState = () => {
  _findContentsLoaded = false;
  batch(() => {
    setFindQuery("");
    setReplaceText("");
    _setFindExcluded(new Set<string>());
    setFindContents(new Map<string, string>());
    setFindLoading(false);
    setFindReplacing(false);
  });
};

// ── Load contents for current file ──

let _loadFindContentsPromise: Promise<void> | null = null;

export const loadFindContents = (): Promise<void> => {
  if (_loadFindContentsPromise) return _loadFindContentsPromise;
  _loadFindContentsPromise = (async () => {
    setFindLoading(true);
    const bodyMetas = editorState.metas().filter((m) => m.level >= 0);
    const map = await getContents(bodyMetas.map((m) => m.id));
    batch(() => {
      setFindContents(map);
      setFindLoading(false);
    });
    _findContentsLoaded = true;
  })().finally(() => {
    _loadFindContentsPromise = null;
  });
  return _loadFindContentsPromise;
};

export const isFindContentsLoaded = () => _findContentsLoaded;

// ── Regex builder ──

export const buildRegex = (q: string, mode: SearchMode): RegExp | null => {
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

export const regexError = createMemo(() => {
  const q = findQueryRaw();
  const mode = findMode();
  if (!q || mode === "exact") return "";
  try {
    new RegExp(q);
    return "";
  } catch (e) {
    return String(e);
  }
});

// ── Search results ──

export const findResults = createMemo<SectionResult[]>(() => {
  const q = findQuery();
  const mode = findMode();
  const re = buildRegex(q, mode);
  if (!re) return [];

  const map = findContents();
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

export const findTotalMatches = createMemo(() =>
  findResults().reduce((s, r) => s + r.matches.length, 0),
);

// ── Exclude helpers ──

export const excludeKey = (m: Match) => `${m.sectionId}:${m.start}:${m.end}`;

export const isFindExcluded = (m: Match) => findExcluded().has(excludeKey(m));

export const toggleFindExclude = (m: Match) => {
  const key = excludeKey(m);
  _setFindExcluded((prev: Set<string>) => {
    const next = new Set<string>(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
};

// ── Replace ──

const applyReplace = async (sectionId: string, newText: string) => {
  await saveSectionDirectly(sectionId, newText);
  if (editorState.activeSectionId() === sectionId) {
    bumpActiveContent();
  }
  setFindContents((prev) => {
    const next = new Map(prev);
    next.set(sectionId, newText);
    return next;
  });
  _setFindExcluded((prev: Set<string>) => {
    const next = new Set<string>(prev);
    for (const key of [...next]) {
      if (key.startsWith(`${sectionId}:`)) next.delete(key);
    }
    return next;
  });
};

export const replaceMatch = async (match: Match) => {
  if (findReplacing()) return;
  const re = buildRegex(findQuery(), findMode());
  if (!re) return;

  setFindReplacing(true);
  try {
    const text = findContents().get(match.sectionId) ?? "";
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
  } finally {
    setFindReplacing(false);
  }
};

export const replaceAll = async () => {
  if (findReplacing()) return;
  const re = buildRegex(findQuery(), findMode());
  if (!re) return;
  setFindReplacing(true);
  try {
    const excl = findExcluded();
    for (const sr of findResults()) {
      const text = findContents().get(sr.meta.id) ?? "";
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
  } finally {
    setFindReplacing(false);
  }
};
