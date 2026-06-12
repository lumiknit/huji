import { createSignal } from "solid-js";
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

export type SaveStatus = "saved" | "dirty" | "saving";

// ── Signals ──

export const [fileId, setFileId] = createSignal<string | null>(null);
export const [metas, setMetas] = createSignal<SectionMeta[]>([]);
const [activeSectionId, _setActiveSectionId] = createSignal<string | null>(
  null,
);
export const [saveStatus, setSaveStatus] = createSignal<SaveStatus>("saved");
const [filename, setFilename] = createSignal<string>("");

export const setActiveSectionId = _setActiveSectionId;

export const editorState = {
  fileId,
  metas,
  activeSectionId,
  saveStatus,
  filename,
};

// ── Session state ──

// Stores the _id from the currently loaded file's frontmatter so it can be
// protected from accidental edits in the frontmatter section.
let currentDocId: string | null = null;

export const getCurrentDocId = () => currentDocId;

// Persists cursor position per section within the session
const sectionSelections = new Map<string, { start: number; end: number }>();

export const popSectionSelection = (id: string) => {
  const sel = sectionSelections.get(id);
  sectionSelections.delete(id);
  return sel ?? null;
};

export const setSectionSelection = (
  id: string,
  sel: { start: number; end: number },
) => {
  sectionSelections.set(id, sel);
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

// Deferred import to avoid circular dependency (editor_save imports from editor)
const getSaveModule = () => import("./editor_save");

export const loadFile = async (id: string) => {
  const { disposeDebounce, normalizeAndMerge } = await getSaveModule();
  disposeDebounce();

  sectionSelections.clear();
  currentDocId = null;

  let list = await getFileMetas(id);
  list = await normalizeAndMerge(list);
  setFileId(id);
  setMetas(list);
  _setActiveSectionId(null);
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

export type SectionSnapshot = {
  id: string;
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

/**
 * Save the current section (via snapshot) then switch to nextId.
 * Pass snapshot when a textarea is active; omit when there is nothing to save.
 */
export const switchSection = async (
  nextId: string | null,
  snapshot?: SectionSnapshot,
) => {
  const { disposeDebounce, saveSection } = await getSaveModule();
  disposeDebounce();

  if (snapshot) {
    const { id, value, selectionStart, selectionEnd } = snapshot;
    sectionSelections.set(id, { start: selectionStart, end: selectionEnd });
    const meta = metas().find((m) => m.id === id);
    if (meta) {
      await saveSection(id, meta, value);
      setSaveStatus("saved");
    }
  }

  // nextId might have been merged away — fall back to the nearest surviving section
  const list = metas();
  if (
    nextId &&
    !nextId.startsWith("__") &&
    !list.find((m) => m.id === nextId)
  ) {
    const fallback = list.find((m) => m.level >= 0) ?? list[0] ?? null;
    _setActiveSectionId(fallback?.id ?? null);
  } else {
    _setActiveSectionId(nextId);
  }
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
  if (activeSectionId() === id) _setActiveSectionId(null);
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

export const disposeEditor = async () => {
  const { disposeDebounce } = await getSaveModule();
  disposeDebounce();
};
