import { createSignal, createMemo } from "solid-js";
import type { SectionMeta } from "../lib/db/schema";
import {
  getFileMetas,
  putMeta,
  putMetas,
  deleteMeta,
  deleteMetas,
  normalizeFracIndices,
  calcInsertFracIndex,
} from "../lib/db/meta";
import {
  getContent,
  putContent,
  deleteContent,
  deleteContents,
  putContents,
} from "../lib/db/content";
import { genId, genUniqueId } from "../lib/utils/id";
import { splitSections } from "../lib/md/section";
import {
  extractFrontmatter,
  parseDocument,
  serializeFrontmatter,
} from "../lib/md/frontmatter";
import { ensureRenderRules } from "../lib/db/defaults";
import { FRAC_GAP } from "../lib/utils/fracindex";
import { sanitizeFilename } from "../lib/path";
import {
  disposeDebounce,
  normalizeAndMerge,
  saveSection,
  getActiveTextareaValue,
  registerActiveTextarea,
  activeTextareaRef,
} from "./editor_save";

export type SaveStatus = "saved" | "dirty" | "saving";

// ── Signals ──

export const [fileId, setFileId] = createSignal<string | null>(null);
export const [metas, setMetas] = createSignal<SectionMeta[]>([]);
export const [saveStatus, setSaveStatus] = createSignal<SaveStatus>("saved");
const [filename, setFilename] = createSignal<string>("");

export type SectionCount = { chars: number; words: number };
export const [sectionCount, setSectionCount] = createSignal<SectionCount>({
  chars: 0,
  words: 0,
});

// Bump this to force EditorPage to reload the active section's content from IDB.
const [activeContentVersion, _setActiveContentVersion] = createSignal(0);
export const bumpActiveContent = () => _setActiveContentVersion((v) => v + 1);

export type GoToSectionOpts = {
  selStart?: number;
  selEnd?: number;
};

// Single source of truth for the active section + optional selection intent.
// { equals: false } ensures every goToSection call fires dependent effects,
// even when the section id doesn't change (e.g. same-section jumps).
const [_activeSection, _setActiveSection] = createSignal<
  { id: string | null } & GoToSectionOpts
>({ id: null }, { equals: false });

const metasMap = createMemo(() => {
  const map = new Map<string, SectionMeta>();
  for (const m of metas()) map.set(m.id, m);
  return map;
});

const sectionLabels = createMemo(() => {
  const list = metas();
  const map = new Map<string, string>();
  const counters = [0, 0, 0, 0, 0, 0, 0];
  for (const m of list) {
    if (m.level < 0) continue;
    if (m.level === 0) {
      map.set(m.id, "(no-heading)");
      continue;
    }
    counters[m.level]++;
    for (let l = m.level + 1; l <= 6; l++) counters[l] = 0;
    const parts: number[] = [];
    for (let l = 1; l <= m.level; l++) parts.push(counters[l]);
    map.set(m.id, parts.join("-") + ". " + m.heading);
  }
  return map;
});

export const editorState = {
  fileId,
  metas,
  metasMap,
  activeSection: _activeSection,
  activeSectionId: () => _activeSection().id, // convenience getter for consumers that only need the id
  saveStatus,
  filename,
  sectionCount,
  activeContentVersion,
  sectionLabels,
};

// ── Session state ──

// Stores the _id from the currently loaded file's frontmatter so it can be
// protected from accidental edits in the frontmatter section.
let currentDocId: string | null = null;

export const getCurrentDocId = () => currentDocId;

// Persists cursor position per section within the session (for back-navigation)
const sectionSelections = new Map<string, { start: number; end: number }>();

export const popSectionSelection = (id: string) => {
  const sel = sectionSelections.get(id);
  sectionSelections.delete(id);
  return sel ?? null;
};

// Used by FindReplacePage to jump to a specific position after navigation
let pendingJump: { sectionId: string; start: number; end: number } | null =
  null;

export const setPendingJump = (
  sectionId: string,
  start: number,
  end: number,
) => {
  pendingJump = { sectionId, start, end };
};

export const popPendingJump = () => {
  const j = pendingJump;
  pendingJump = null;
  return j;
};

// ── Import ──

export const importMarkdownText = async (
  text: string,
  filename: string,
): Promise<string> => {
  const fId = genId();
  const now = new Date().toISOString();

  const doc = await parseDocument(text);
  const existingIds = new Set<string>();
  const metaList: SectionMeta[] = [];
  const contents: Array<{ id: string; content: string; updatedAt: string }> =
    [];

  const fmId = genId();
  existingIds.add(fmId);
  const fmData: Record<string, unknown> = doc.frontmatter?.data ?? {};
  fmData._filename = sanitizeFilename(filename);
  fmData._last_used_at = now;
  if (typeof fmData._id !== "string" || !fmData._id) {
    fmData._id = genId();
  }
  ensureRenderRules(fmData);
  const fmType = doc.frontmatter?.type ?? "yaml";
  const fmRaw = await serializeFrontmatter(fmType, fmData);

  metaList.push({
    id: fmId,
    fileId: fId,
    fracIndex: 0,
    level: -1,
    heading: fmType,
    updatedAt: now,
  });
  contents.push({ id: fmId, content: fmRaw, updatedAt: now });

  const sections = splitSections(doc.body);
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const sid = genUniqueId(existingIds);
    existingIds.add(sid);
    metaList.push({
      id: sid,
      fileId: fId,
      fracIndex: (i + 1) * FRAC_GAP,
      level: s.level,
      heading: s.heading,
      updatedAt: now,
    });
    contents.push({ id: sid, content: s.raw, updatedAt: now });
  }

  await putMetas(metaList);
  await putContents(contents);
  return fId;
};

// ── File load ──

export const loadFile = async (id: string) => {
  disposeDebounce();

  sectionSelections.clear();
  currentDocId = null;

  let list = await getFileMetas(id);
  list = await normalizeAndMerge(list);
  setFileId(id);
  setMetas(list);
  _setActiveSection({ id: null });
  setSaveStatus("saved");

  await updateLastUsedAt(list);
};

const updateLastUsedAt = async (list: SectionMeta[]) => {
  const fmMeta = list.find((m) => m.level === -1);
  if (!fmMeta) return;
  const row = await getContent(fmMeta.id);
  if (!row) return;
  const now = new Date().toISOString();
  try {
    const info = await extractFrontmatter(row.content);
    if (!info) return;
    if (typeof info.data._filename === "string")
      setFilename(info.data._filename);
    const data: Record<string, unknown> = { ...info.data, _last_used_at: now };
    if (typeof data._id !== "string" || !data._id) {
      data._id = genId();
    }
    currentDocId = data._id as string;
    ensureRenderRules(data);
    const newContent = await serializeFrontmatter(info.type, data);
    await putContent({ id: fmMeta.id, content: newContent, updatedAt: now });
    const updatedMeta = { ...fmMeta, heading: info.type, updatedAt: now };
    setMetas((prev) => prev.map((m) => (m.id === fmMeta.id ? updatedMeta : m)));
    if (fmMeta.heading !== info.type) await putMeta(updatedMeta);
  } catch {
    // Silently ignore parse failures — last_used_at is non-critical
  }
};

// ── Section navigation ──

export { registerActiveTextarea };

/**
 * Save the current section then navigate to nextId.
 * Pass selStart/selEnd to explicitly set cursor/selection after the switch.
 * Special IDs starting with "__" (e.g. "__all__") skip section saving.
 */
export const goToSection = async (
  nextId: string | null,
  opts: GoToSectionOpts = {},
) => {
  disposeDebounce();

  const id = _activeSection().id;
  if (id && !id.startsWith("__")) {
    const value = getActiveTextareaValue();
    if (activeTextareaRef && document.activeElement === activeTextareaRef) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const pre = range.cloneRange();
        pre.selectNodeContents(activeTextareaRef);
        pre.setEnd(range.startContainer, range.startOffset);
        const start = pre.toString().length;
        const preEnd = range.cloneRange();
        preEnd.selectNodeContents(activeTextareaRef);
        preEnd.setEnd(range.endContainer, range.endOffset);
        sectionSelections.set(id, { start, end: preEnd.toString().length });
      }
    }
    const meta = metas().find((m) => m.id === id);
    if (meta) {
      await saveSection(id, meta, value);
      setSaveStatus("saved");
    }
  }

  // Special IDs (like "__all__") pass through as-is
  let resolvedId = nextId;
  if (nextId && !nextId.startsWith("__")) {
    // nextId might have been merged away — fall back to nearest surviving section
    const list = metas();
    if (!list.find((m) => m.id === nextId)) {
      const fallback = list.find((m) => m.level >= 0) ?? list[0] ?? null;
      resolvedId = fallback?.id ?? null;
    }
  }

  _setActiveSection({ id: resolvedId, ...opts });
};

// ── Section CRUD ──

export const addSection = async (afterId?: string): Promise<string | null> => {
  const id = fileId();
  if (!id) return null;

  const list = metas();
  const existingIds = new Set(list.map((m) => m.id));
  const newId = genUniqueId(existingIds);
  const afterMeta = afterId ? list.find((m) => m.id === afterId) : undefined;
  const frac = calcInsertFracIndex(list, afterMeta?.fracIndex);
  const now = new Date().toISOString();

  const prevLevel = afterMeta && afterMeta.level >= 1 ? afterMeta.level : 1;
  const hashes = "#".repeat(prevLevel);
  const defaultContent = `${hashes} Title here`;

  const newMeta: SectionMeta = {
    id: newId,
    fileId: id,
    fracIndex: frac,
    level: prevLevel,
    heading: "Title here",
    updatedAt: now,
  };
  await putMeta(newMeta);
  await putContent({ id: newId, content: defaultContent, updatedAt: now });

  const updated = [...list, newMeta].sort((a, b) => a.fracIndex - b.fracIndex);
  setMetas(await normalizeFracIndices(updated));
  return newId;
};

export const addSectionBefore = async (
  beforeId: string,
): Promise<string | null> => {
  const id = fileId();
  if (!id) return null;

  const list = metas();
  const beforeIdx = list.findIndex((m) => m.id === beforeId);
  if (beforeIdx === -1) return null;

  const existingIds = new Set(list.map((m) => m.id));
  const newId = genUniqueId(existingIds);
  const now = new Date().toISOString();

  const beforeMeta = list[beforeIdx];
  const prevMeta = beforeIdx > 0 ? list[beforeIdx - 1] : null;
  const fracIndex = prevMeta
    ? (prevMeta.fracIndex + beforeMeta.fracIndex) / 2
    : beforeMeta.fracIndex - FRAC_GAP;

  const prevLevel = beforeMeta.level >= 1 ? beforeMeta.level : 1;
  const hashes = "#".repeat(prevLevel);
  const defaultContent = `${hashes} Title here`;

  const newMeta: SectionMeta = {
    id: newId,
    fileId: id,
    fracIndex,
    level: prevLevel,
    heading: "Title here",
    updatedAt: now,
  };
  await putMeta(newMeta);
  await putContent({ id: newId, content: defaultContent, updatedAt: now });

  const updated = [...list, newMeta].sort((a, b) => a.fracIndex - b.fracIndex);
  setMetas(await normalizeFracIndices(updated));
  return newId;
};

export const deleteSection = async (id: string) => {
  await deleteMeta(id);
  await deleteContent(id);
  setMetas((prev) => prev.filter((m) => m.id !== id));
  if (_activeSection().id === id) _setActiveSection({ id: null });
};

export const deleteFile = async (id: string) => {
  const list = await getFileMetas(id);
  const ids = list.map((m) => m.id);
  await Promise.all([deleteMetas(ids), deleteContents(ids)]);
};

// ── Content load ──

export const loadSectionContent = async (id: string): Promise<string> => {
  const row = await getContent(id);
  return row?.content ?? "";
};

export const loadAllContent = async (): Promise<string> => {
  const list = metas().filter((m) => m.level >= 0);
  const rows = await Promise.all(list.map((m) => getContent(m.id)));
  return rows
    .map((r) => r?.content ?? "")
    .filter(Boolean)
    .join("\n\n");
};

export const disposeEditor = () => {
  disposeDebounce();
};
