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
  getContents,
  putContent,
  deleteContent,
  deleteContents,
  putContents,
} from "../lib/db/content";
import { createDebounce } from "../lib/utils/debounce";
import { genId, genUniqueId } from "../lib/utils/id";
import { normalizeSectionText, splitSections } from "../lib/md/section";
import {
  extractFrontmatter,
  parseDocument,
  serializeFrontmatter,
} from "../lib/md/frontmatter";
import { ensureRenderRules } from "../lib/db/defaults";
import { FRAC_GAP } from "../lib/utils/fracindex";
import { sanitizeFilename } from "../lib/path";

export type SaveStatus = "saved" | "dirty" | "saving";

// Stores the _id from the currently loaded file's frontmatter so it can be
// protected from accidental edits in the frontmatter section.
let currentDocId: string | null = null;

export const getCurrentDocId = () => currentDocId;

// If the user edited _id in the frontmatter textarea, restore it before saving.
const applyDocIdProtection = async (raw: string): Promise<string> => {
  if (!currentDocId) return raw;
  const info = await extractFrontmatter(raw);
  if (!info || info.data._id === currentDocId) return raw;
  const data = { ...info.data, _id: currentDocId };
  const newFm = await serializeFrontmatter(info.type, data);
  return newFm + raw.slice(info.end);
};

export const importMarkdownText = async (
  text: string,
  filename: string,
): Promise<string> => {
  const fileId = genId();
  const now = new Date().toISOString();

  const doc = await parseDocument(text);
  const existingIds = new Set<string>();
  const metas: SectionMeta[] = [];
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

  metas.push({
    id: fmId,
    fileId,
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
    metas.push({
      id: sid,
      fileId,
      fracIndex: (i + 1) * FRAC_GAP,
      level: s.level,
      heading: s.heading,
      updatedAt: now,
    });
    contents.push({ id: sid, content: s.raw, updatedAt: now });
  }

  await putMetas(metas);
  await putContents(contents);
  return fileId;
};

const [fileId, setFileId] = createSignal<string | null>(null);
const [metas, setMetas] = createSignal<SectionMeta[]>([]);
const [activeSectionId, _setActiveSectionId] = createSignal<string | null>(
  null,
);
const [saveStatus, setSaveStatus] = createSignal<SaveStatus>("saved");
const [filename, setFilename] = createSignal<string>("");

export const setActiveSectionId = _setActiveSectionId;

let textareaRef: HTMLTextAreaElement | null = null;

// Persists cursor position per section within the session
const sectionSelections = new Map<string, { start: number; end: number }>();

export const editorState = {
  fileId,
  metas,
  activeSectionId,
  saveStatus,
  filename,
};

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

export const setTextareaRef = (el: HTMLTextAreaElement | null) => {
  textareaRef = el;
};

/** Insert sections from `rest` text right after the frontmatter meta. */
const insertSectionsAfterFrontmatter = async (
  fmMeta: SectionMeta,
  rest: string,
  now: string,
) => {
  const sections = splitSections(rest);
  if (sections.length === 0) return;

  const list = metas();
  const existingIds = new Set(list.map((m) => m.id));
  const nextBodyMeta = list.find((m) => m.level >= 0);
  const nextFrac =
    nextBodyMeta?.fracIndex ??
    fmMeta.fracIndex + FRAC_GAP * (sections.length + 1);

  const insertedMetas: SectionMeta[] = [];
  const insertedContents: Array<{
    id: string;
    content: string;
    updatedAt: string;
  }> = [];

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const newId = genUniqueId(existingIds);
    existingIds.add(newId);
    const frac =
      fmMeta.fracIndex +
      (nextFrac - fmMeta.fracIndex) * ((i + 1) / (sections.length + 1));
    insertedMetas.push({
      id: newId,
      fileId: fmMeta.fileId,
      fracIndex: frac,
      level: s.level,
      heading: s.heading,
      updatedAt: now,
    });
    insertedContents.push({ id: newId, content: s.raw, updatedAt: now });
  }

  await putMetas(insertedMetas);
  await putContents(insertedContents);

  const allMetas = [...list, ...insertedMetas].sort(
    (a, b) => a.fracIndex - b.fracIndex,
  );
  const normalized = await normalizeFracIndices(allMetas);
  const merged = await mergeNoHeadingSections(normalized);
  setMetas(merged);
};

// ── Autosave debounce ──

const debounce = createDebounce(async () => {
  await flushSave();
});

/**
 * Save the active section.
 * Returns an error string if the frontmatter is invalid (and was not saved).
 * Returns empty string on success or when there is nothing to save.
 */
export const flushSave = async (): Promise<string> => {
  const id = activeSectionId();
  if (!textareaRef || !id || id.startsWith("__")) return "";

  const meta = metas().find((m) => m.id === id);
  if (!meta) return "";

  setSaveStatus("saving");

  if (meta.level === -1) {
    const rawOrig = textareaRef.value;
    const raw = await applyDocIdProtection(rawOrig);
    if (raw !== rawOrig && textareaRef) textareaRef.value = raw;
    const info = await extractFrontmatter(raw);
    if (!info) {
      setSaveStatus("dirty");
      return "Invalid frontmatter";
    }
    const now = new Date().toISOString();
    const fm = raw.slice(0, info.end);
    const rest = raw.slice(info.end).trim();
    await putContent({ id, content: fm, updatedAt: now });
    if (info.type !== meta.heading) {
      const updated = { ...meta, heading: info.type, updatedAt: now };
      setMetas((prev) => prev.map((m) => (m.id === id ? updated : m)));
      await putMeta(updated);
    }
    if (rest) {
      await insertSectionsAfterFrontmatter(meta, rest, now);
      if (textareaRef) {
        textareaRef.value = fm;
      }
    }
    setSaveStatus("saved");
    return "";
  }

  const raw = textareaRef.value.trim();
  await saveRaw(id, raw);
  setSaveStatus("saved");
  return "";
};

/** Save a specific section by id and raw content (used by all-sections mode). */
export const saveSectionDirectly = async (id: string, raw: string) => {
  await saveRaw(id, raw.trim());
};

const saveRaw = async (id: string, trimmed: string) => {
  const now = new Date().toISOString();
  await putContent({ id, content: trimmed, updatedAt: now });
  const meta = metas().find((m) => m.id === id);
  if (!meta || meta.level === -1) return; // never overwrite frontmatter meta fields
  const { heading, level } = extractHeadingFromRaw(trimmed);
  if (meta.heading !== heading || meta.level !== level) {
    const updated = { ...meta, heading, level, updatedAt: now };
    setMetas((prev) => prev.map((m) => (m.id === id ? updated : m)));
    await putMeta(updated);
  }
};

const extractHeadingFromRaw = (
  raw: string,
): { heading: string; level: number } => {
  const firstLine = raw.split("\n")[0] ?? "";
  const m = firstLine.match(/^(#{1,6})\s+(.*)$/);
  if (m) return { level: m[1].length, heading: m[2].trim() };
  return { level: 0, heading: "" };
};

export const notifyEdit = () => {
  setSaveStatus("dirty");
  debounce.notify();
};

// ── No-heading section merging ──
// After the first body section, any level-0 section is merged into its predecessor.

const mergeNoHeadingSections = async (
  list: SectionMeta[],
): Promise<SectionMeta[]> => {
  const firstBodyIdx = list.findIndex((m) => m.level >= 0);
  if (firstBodyIdx === -1) return list;

  // Identify candidates before fetching: level-0 sections and their predecessors
  const candidateIds = new Set<string>();
  for (let i = firstBodyIdx; i < list.length; i++) {
    if (list[i].level === 0) {
      candidateIds.add(list[i].id);
      if (i > firstBodyIdx) candidateIds.add(list[i - 1].id);
    }
  }
  if (candidateIds.size === 0) return list;

  const fetched = await getContents([...candidateIds]);

  const toDelete: string[] = [];
  const toDeleteSet = new Set<string>();
  const updatedContent = new Map<string, string>();

  for (let i = firstBodyIdx + 1; i < list.length; i++) {
    if (list[i].level !== 0) continue;

    let prevIdx = i - 1;
    while (prevIdx >= firstBodyIdx && toDeleteSet.has(list[prevIdx].id))
      prevIdx--;
    if (prevIdx < firstBodyIdx) continue;

    const prevId = list[prevIdx].id;
    const curId = list[i].id;

    const prevContent = updatedContent.get(prevId) ?? fetched.get(prevId) ?? "";
    const curContent = fetched.get(curId) ?? "";
    const merged = (prevContent + "\n\n" + curContent).trim();

    updatedContent.set(prevId, merged);
    toDelete.push(curId);
    toDeleteSet.add(curId);
  }

  if (toDelete.length === 0) return list;

  const now = new Date().toISOString();
  await putContents(
    [...updatedContent.entries()].map(([id, content]) => ({
      id,
      content,
      updatedAt: now,
    })),
  );
  await deleteMetas(toDelete);
  await deleteContents(toDelete);

  return list.filter((m) => !toDelete.includes(m.id));
};

// ── File load ──

export const loadFile = async (id: string) => {
  debounce.dispose();
  textareaRef = null;
  sectionSelections.clear();
  currentDocId = null;

  let list = await getFileMetas(id);
  list = await mergeNoHeadingSections(list);
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

export const switchSection = async (nextId: string | null) => {
  await unloadCurrentSection();
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

const unloadCurrentSection = async () => {
  debounce.dispose();

  const id = activeSectionId();
  if (!textareaRef || !id || id.startsWith("__")) return;

  // Capture cursor position before switching away
  sectionSelections.set(id, {
    start: textareaRef.selectionStart,
    end: textareaRef.selectionEnd,
  });

  const raw = textareaRef.value.trim();
  const now = new Date().toISOString();
  const currentMeta = metas().find((m) => m.id === id);
  if (!currentMeta) return;

  // ── Frontmatter: validate and save, split any trailing content ──
  if (currentMeta.level === -1) {
    const rawOrig = textareaRef.value;
    const rawFixed = await applyDocIdProtection(rawOrig);
    if (rawFixed !== rawOrig && textareaRef) textareaRef.value = rawFixed;
    const info = await extractFrontmatter(rawFixed);
    if (info) {
      const fm = rawFixed.slice(0, info.end);
      const rest = rawFixed.slice(info.end).trim();
      await putContent({ id, content: fm, updatedAt: now });
      if (info.type !== currentMeta.heading) {
        const updated = { ...currentMeta, heading: info.type, updatedAt: now };
        setMetas((prev) => prev.map((m) => (m.id === id ? updated : m)));
        await putMeta(updated);
      }
      if (rest) {
        await insertSectionsAfterFrontmatter(currentMeta, rest, now);
        if (textareaRef) {
          textareaRef.value = fm;
        }
      }
      setSaveStatus("saved");
    }
    // If parse fails: leave content as-is, don't save
    return;
  }

  // ── Regular section ──

  const { current, added } = normalizeSectionText(raw);

  // Delete empty sections (not the last remaining one)
  const canDelete =
    current.raw === "" && metas().filter((m) => m.level >= 0).length > 1;
  if (canDelete) {
    await deleteMeta(id);
    await deleteContent(id);
    setMetas((prev) => prev.filter((m) => m.id !== id));
    setSaveStatus("saved");
    return;
  }

  await saveRaw(id, current.raw);
  let updatedMetas = metas();

  if (added.length > 0) {
    const existingIds = new Set(updatedMetas.map((m) => m.id));
    const insertedMetas: SectionMeta[] = [];

    const nextMeta = updatedMetas.find(
      (m) => m.fracIndex > currentMeta.fracIndex,
    );
    const nextFrac =
      nextMeta?.fracIndex ??
      currentMeta.fracIndex + FRAC_GAP * (added.length + 1);

    for (let i = 0; i < added.length; i++) {
      const s = added[i];
      const newId = genUniqueId(existingIds);
      existingIds.add(newId);
      const frac =
        currentMeta.fracIndex +
        (nextFrac - currentMeta.fracIndex) * ((i + 1) / (added.length + 1));
      insertedMetas.push({
        id: newId,
        fileId: currentMeta.fileId,
        fracIndex: frac,
        level: s.level,
        heading: s.heading,
        updatedAt: now,
      });
    }

    await putMetas(insertedMetas);
    await Promise.all(
      added.map((s, i) =>
        putContent({ id: insertedMetas[i].id, content: s.raw, updatedAt: now }),
      ),
    );

    const allMetas = [...updatedMetas, ...insertedMetas].sort(
      (a, b) => a.fracIndex - b.fracIndex,
    );
    updatedMetas = await normalizeFracIndices(allMetas);
  } else {
    updatedMetas = await normalizeFracIndices(updatedMetas);
  }

  updatedMetas = await mergeNoHeadingSections(updatedMetas);
  setMetas(updatedMetas);
  setSaveStatus("saved");
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

  // Inherit level from the section we're inserting after (min 1)
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

// ── Content lazy load ──

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

export const saveWholeContent = async (raw: string) => {
  const id = fileId();
  if (!id) return;

  const list = metas();
  const fmMeta = list.find((m) => m.level === -1);
  const bodyMetas = list.filter((m) => m.level >= 0);
  const now = new Date().toISOString();

  const sections = splitSections(raw.trim());
  const deleteIds = bodyMetas.map((m) => m.id);
  const existingIds = new Set(list.map((m) => m.id));
  const newMetas: SectionMeta[] = [];
  const newContents: Array<{ id: string; content: string; updatedAt: string }> =
    [];

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const newId = genUniqueId(existingIds);
    existingIds.add(newId);
    newMetas.push({
      id: newId,
      fileId: id,
      fracIndex: (i + 1) * FRAC_GAP,
      level: s.level,
      heading: s.heading,
      updatedAt: now,
    });
    newContents.push({ id: newId, content: s.raw, updatedAt: now });
  }

  await Promise.all([putMetas(newMetas), putContents(newContents)]);

  await deleteMetas(deleteIds);
  await deleteContents(deleteIds);

  const allMetas = [...(fmMeta ? [fmMeta] : []), ...newMetas];
  setMetas(allMetas);
  setSaveStatus("saved");
};

export const disposeEditor = () => {
  debounce.dispose();
  textareaRef = null;
};
