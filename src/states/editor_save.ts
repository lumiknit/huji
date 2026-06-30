import type { SectionMeta } from "../lib/db/schema";
import {
  putMeta,
  putMetas,
  deleteMeta,
  deleteMetas,
  normalizeFracIndices,
} from "../lib/db/meta";
import {
  getContents,
  putContent,
  deleteContent,
  deleteContents,
  putContents,
} from "../lib/db/content";
import { createDebounce } from "../lib/utils/debounce";
import { genUniqueId } from "../lib/utils/id";
import { normalizeSectionText, splitSections } from "../lib/md/section";
import {
  extractFrontmatter,
  serializeFrontmatter,
} from "../lib/md/frontmatter";
import { FRAC_GAP } from "../lib/utils/fracindex";
import { batch } from "solid-js";
import {
  editorState,
  setMetas,
  setSaveStatus,
  setSectionCount,
  getCurrentDocId,
  fileId,
} from "./editor";

const countWords = (text: string) => {
  let n = 0;
  for (const _ of text.matchAll(/\S+/g)) n++;
  return n;
};

export const countText = (text: string) => ({
  chars: text.length,
  words: countWords(text),
});

// ── Normalization helpers ──

const mergeNoHeadingSections = async (
  list: SectionMeta[],
): Promise<SectionMeta[]> => {
  const firstBodyIdx = list.findIndex((m) => m.level >= 0);
  if (firstBodyIdx === -1) return list;

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

export const normalizeAndMerge = async (
  list: SectionMeta[],
): Promise<SectionMeta[]> => {
  const normalized = await normalizeFracIndices(list);
  return mergeNoHeadingSections(normalized);
};

// ── Section insert helpers ──

export const insertSectionsAfterFrontmatter = async (
  fmMeta: SectionMeta,
  rest: string,
  now: string,
): Promise<void> => {
  const sections = splitSections(rest);
  if (sections.length === 0) return;

  const list = editorState.metas();
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
  const merged = await normalizeAndMerge(allMetas);
  setMetas(merged);
};

// ── _id protection ──

const applyDocIdProtection = async (raw: string): Promise<string> => {
  const docId = getCurrentDocId();
  if (!docId) return raw;
  const info = await extractFrontmatter(raw);
  if (!info || info.data._id === docId) return raw;
  const data = { ...info.data, _id: docId };
  const newFm = await serializeFrontmatter(info.type, data);
  return newFm + raw.slice(info.end);
};

// ── Core save ──

const saveRaw = async (id: string, trimmed: string) => {
  const now = new Date().toISOString();
  await putContent({ id, content: trimmed, updatedAt: now });
  const meta = editorState.metas().find((m) => m.id === id);
  if (!meta || meta.level === -1) return;
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

/**
 * Save the given section content to IDB.
 * Returns `{ error, newValue }` — newValue is set when the textarea should be
 * updated (e.g. _id protection rewrote the frontmatter, or trailing content
 * was split into a new section).
 */
export const saveSection = async (
  id: string,
  meta: SectionMeta,
  value: string,
): Promise<{ error: string; newValue?: string }> => {
  if (meta.level === -1) {
    const rawFixed = await applyDocIdProtection(value);
    const info = await extractFrontmatter(rawFixed);
    if (!info) return { error: "Invalid frontmatter" };

    const now = new Date().toISOString();
    const fm = rawFixed.slice(0, info.end);
    const rest = rawFixed.slice(info.end).trim();
    await putContent({ id, content: fm, updatedAt: now });

    if (info.type !== meta.heading) {
      const updated = { ...meta, heading: info.type, updatedAt: now };
      setMetas((prev) => prev.map((m) => (m.id === id ? updated : m)));
      await putMeta(updated);
    }

    if (rest) {
      await insertSectionsAfterFrontmatter(meta, rest, now);
      return { error: "", newValue: fm };
    }

    return { error: "", newValue: rawFixed !== value ? rawFixed : undefined };
  }

  // ── Regular section ──
  const { current, added } = normalizeSectionText(value.trim());

  const canDelete =
    current.raw === "" &&
    editorState.metas().filter((m) => m.level >= 0).length > 1;
  if (canDelete) {
    await deleteMeta(id);
    await deleteContent(id);
    setMetas((prev) => prev.filter((m) => m.id !== id));
    return { error: "" };
  }

  await saveRaw(id, current.raw);
  let updatedMetas = editorState.metas();

  if (added.length > 0) {
    const existingIds = new Set(updatedMetas.map((m) => m.id));
    const insertedMetas: SectionMeta[] = [];
    const now = new Date().toISOString();

    const nextMeta = updatedMetas.find((m) => m.fracIndex > meta.fracIndex);
    const nextFrac =
      nextMeta?.fracIndex ?? meta.fracIndex + FRAC_GAP * (added.length + 1);

    for (let i = 0; i < added.length; i++) {
      const s = added[i];
      const newId = genUniqueId(existingIds);
      existingIds.add(newId);
      const frac =
        meta.fracIndex +
        (nextFrac - meta.fracIndex) * ((i + 1) / (added.length + 1));
      insertedMetas.push({
        id: newId,
        fileId: meta.fileId,
        fracIndex: frac,
        level: s.level,
        heading: s.heading,
        updatedAt: now,
      });
    }

    await putMetas(insertedMetas);
    await putContents(
      added.map((s, i) => ({
        id: insertedMetas[i].id,
        content: s.raw,
        updatedAt: now,
      })),
    );

    const allMetas = [...updatedMetas, ...insertedMetas].sort(
      (a, b) => a.fracIndex - b.fracIndex,
    );
    updatedMetas = await normalizeAndMerge(allMetas);
  } else {
    updatedMetas = await normalizeAndMerge(updatedMetas);
  }

  setMetas(updatedMetas);
  return { error: "" };
};

// ── Active value getter ──

let activeValueGetter: (() => string) | null = null;

export const registerValueGetter = (fn: (() => string) | null) => {
  activeValueGetter = fn;
};

export const getActiveTextareaValue = (): string => activeValueGetter?.() ?? "";

// ── Debounce / auto-save ──

let pendingId: string | null = null;

const debounce = createDebounce(async () => {
  if (!pendingId) return;
  const id = pendingId;
  const value = getActiveTextareaValue();
  const meta = editorState.metas().find((m) => m.id === id);
  if (!meta) return;
  setSaveStatus("saving");
  try {
    await saveSection(id, meta, value);
    batch(() => {
      setSectionCount(countText(value));
      setSaveStatus("saved");
    });
  } catch {
    setSaveStatus("dirty");
  }
});

export const notifyEdit = (id: string) => {
  pendingId = id;
  setSaveStatus("dirty");
  debounce.notify();
};

export const disposeDebounce = () => {
  debounce.dispose();
  pendingId = null;
};

// ── Manual flush (concurrency guard) ──

let savePromise: Promise<string> | null = null;

const doFlushSave = async (
  id: string,
  meta: SectionMeta,
  value: string,
): Promise<string> => {
  setSaveStatus("saving");
  try {
    const { error } = await saveSection(id, meta, value);
    batch(() => {
      if (!error) setSectionCount(countText(value));
      setSaveStatus(error ? "dirty" : "saved");
    });
    return error;
  } finally {
    savePromise = null;
  }
};

/**
 * Manually flush a save. Reads value from the active textarea ref.
 * Concurrent calls while a save is in progress return the same promise.
 */
export const flushSave = (id: string): Promise<string> => {
  if (savePromise) return savePromise;
  const meta = editorState.metas().find((m) => m.id === id);
  if (!meta) return Promise.resolve("");
  savePromise = doFlushSave(id, meta, getActiveTextareaValue());
  return savePromise;
};

// ── Whole-file save ──

export const saveWholeContent = async (raw: string): Promise<void> => {
  const id = fileId();
  if (!id) return;

  const list = editorState.metas();
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

export const saveSectionDirectly = async (
  id: string,
  raw: string,
): Promise<void> => {
  await saveRaw(id, raw.trim());
};
