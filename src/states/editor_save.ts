import type { SectionMeta } from "../lib/db/schema";
import {
  putMeta,
  putMetas,
  deleteMeta,
  normalizeFracIndices,
} from "../lib/db/meta";
import {
  getContents,
  putContent,
  deleteContent,
  putContents,
} from "../lib/db/content";
import { getDB } from "../lib/db";
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
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) <= 32) {
      inWord = false;
    } else if (!inWord) {
      n++;
      inWord = true;
    }
  }
  return n;
};

export const countText = (text: string) => ({
  chars: text.length,
  words: countWords(text),
});

// ── Normalization helpers ──

type MergeResult = {
  metas: SectionMeta[];
  mergedInto: Map<string, string>; // deletedId -> absorbing section id
};

const mergeNoHeadingSections = async (
  list: SectionMeta[],
): Promise<MergeResult> => {
  const empty: MergeResult = { metas: list, mergedInto: new Map() };
  const firstBodyIdx = list.findIndex((m) => m.level >= 0);
  if (firstBodyIdx === -1) return empty;

  const candidateIds = new Set<string>();
  for (let i = firstBodyIdx; i < list.length; i++) {
    if (list[i].level === 0) {
      candidateIds.add(list[i].id);
      if (i > firstBodyIdx) candidateIds.add(list[i - 1].id);
    }
  }
  if (candidateIds.size === 0) return empty;

  const fetched = await getContents([...candidateIds]);

  const toDelete: string[] = [];
  const toDeleteSet = new Set<string>();
  const updatedContent = new Map<string, string>();
  const mergedInto = new Map<string, string>();

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
    updatedContent.set(prevId, (prevContent + "\n\n" + curContent).trim());
    toDelete.push(curId);
    toDeleteSet.add(curId);
    mergedInto.set(curId, prevId);
  }

  if (toDelete.length === 0) return empty;

  const now = new Date().toISOString();

  // Single multi-store transaction: update merged content + delete orphans atomically
  const db = await getDB();
  const tx = db.transaction(["meta", "content"], "readwrite");
  const metaStore = tx.objectStore("meta");
  const contentStore = tx.objectStore("content");
  await Promise.all([
    ...[...updatedContent.entries()].map(([id, content]) =>
      contentStore.put({ id, content, updatedAt: now }),
    ),
    ...toDelete.map((id) => metaStore.delete(id)),
    ...toDelete.map((id) => contentStore.delete(id)),
    tx.done,
  ]);

  return { metas: list.filter((m) => !toDelete.includes(m.id)), mergedInto };
};

export const normalizeAndMerge = async (
  list: SectionMeta[],
): Promise<SectionMeta[]> => {
  const normalized = await normalizeFracIndices(list);
  return (await mergeNoHeadingSections(normalized)).metas;
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

/**
 * Write content to IDB and update meta if heading/level changed.
 * Returns the updated SectionMeta if it changed, null otherwise.
 * Does NOT call setMetas — callers are responsible for applying the result.
 */
const saveRaw = async (
  id: string,
  trimmed: string,
): Promise<SectionMeta | null> => {
  const now = new Date().toISOString();
  await putContent({ id, content: trimmed, updatedAt: now });
  const meta = editorState.metas().find((m) => m.id === id);
  if (!meta || meta.level === -1) return null;
  const { heading, level } = extractHeadingFromRaw(trimmed);
  if (meta.heading !== heading || meta.level !== level) {
    const updated = { ...meta, heading, level, updatedAt: now };
    await putMeta(updated);
    return updated;
  }
  return null;
};

const extractHeadingFromRaw = (
  raw: string,
): { heading: string; level: number } => {
  const nl = raw.indexOf("\n");
  const firstLine = nl === -1 ? raw : raw.slice(0, nl);
  const m = firstLine.match(/^(#{1,6})\s+(.*)$/);
  if (m) return { level: m[1].length, heading: m[2].trim() };
  return { level: 0, heading: "" };
};

/**
 * Normalize and save the current section on navigation away.
 * Handles frontmatter _id protection, section splitting, and merging.
 * Called only from goToSection — not during auto-save.
 */
export const normalizeSectionOnLeave = async (
  id: string,
  meta: SectionMeta,
  value: string,
): Promise<void> => {
  if (meta.level === -1) {
    const rawFixed = await applyDocIdProtection(value);
    const info = await extractFrontmatter(rawFixed);
    if (!info) return;

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
    }
    return;
  }

  // ── Regular section ──
  const { current, added } = normalizeSectionText(value.trim());

  const bodyMetas = editorState.metas().filter((m) => m.level >= 0);
  const canDelete = current.raw === "" && bodyMetas.length > 1;
  if (canDelete) {
    await deleteMeta(id);
    await deleteContent(id);
    setMetas((prev) => prev.filter((m) => m.id !== id));
    return;
  }

  const updatedMeta = await saveRaw(id, current.raw);
  let updatedMetas = updatedMeta
    ? editorState.metas().map((m) => (m.id === id ? updatedMeta : m))
    : editorState.metas();

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
    setMetas(updatedMetas);
    return;
  } else {
    // normalizeFracIndices is cheap (early-exits when no reindex needed).
    // mergeNoHeadingSections only matters when level-0 sections exist; skip
    // the IDB read when there are none.
    const normalized = await normalizeFracIndices(updatedMetas);
    if (normalized.some((m) => m.level === 0)) {
      const result = await mergeNoHeadingSections(normalized);
      setMetas(result.metas);
      return;
    }
    setMetas(normalized);
  }
};

// ── Active value getter ──

let activeValueGetter: (() => string) | null = null;

export const registerValueGetter = (fn: (() => string) | null) => {
  activeValueGetter = fn;
};

export const getActiveTextareaValue = (): string => activeValueGetter?.() ?? "";

// ── Debounce / auto-save ──

const debounce = createDebounce(async (id: string) => {
  const value = getActiveTextareaValue();
  const meta = editorState.metas().find((m) => m.id === id);
  if (!meta) return;
  setSaveStatus("saving");
  try {
    const updated = await saveRaw(id, value.trim());
    batch(() => {
      if (updated)
        setMetas((prev) => prev.map((m) => (m.id === id ? updated : m)));
      setSectionCount(countText(value));
      setSaveStatus("saved");
    });
  } catch {
    setSaveStatus("dirty");
  }
});

export const notifyEdit = (id: string) => {
  setSaveStatus("dirty");
  debounce.notify(id);
};

export const disposeDebounce = () => {
  debounce.dispose();
};

// ── Manual flush ──

/**
 * Flush pending edits to IDB without normalization.
 * Called before navigation; normalizeSectionOnLeave handles the full normalize.
 */
export const flushSave = async (id: string): Promise<void> => {
  debounce.dispose();
  const value = getActiveTextareaValue();
  setSaveStatus("saving");
  try {
    const updated = await saveRaw(id, value.trim());
    batch(() => {
      if (updated)
        setMetas((prev) => prev.map((m) => (m.id === id ? updated : m)));
      setSectionCount(countText(value));
      setSaveStatus("saved");
    });
  } catch {
    setSaveStatus("dirty");
  }
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

  // Single multi-store transaction: put new + delete old atomically
  const db = await getDB();
  const tx = db.transaction(["meta", "content"], "readwrite");
  const metaStore = tx.objectStore("meta");
  const contentStore = tx.objectStore("content");
  await Promise.all([
    ...newMetas.map((m) => metaStore.put(m)),
    ...newContents.map((c) =>
      contentStore.put({ ...c, content: c.content.trim() }),
    ),
    ...deleteIds.map((id) => metaStore.delete(id)),
    ...deleteIds.map((id) => contentStore.delete(id)),
    tx.done,
  ]);

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
