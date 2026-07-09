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
import {
  normalizeSectionText,
  splitSections,
  extractHeading,
} from "../lib/md/section";
import { encodeFrontmatterFromEdit } from "../lib/md/frontmatter";
import { FRAC_GAP } from "../lib/utils/fracindex";
import { countText } from "../lib/utils/text_stats";
import { batch } from "solid-js";
import type { EditorCommander } from "../components/editor/commander";
import {
  editorState,
  setMetas,
  setSaveStatus,
  setSectionCount,
  getCurrentDocId,
  fileId,
  WHOLE_ID,
  touchLastUsedAt,
} from "./editor";

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

// ── Frontmatter save (separate from the generic section pipeline) ──

/**
 * Parses edited frontmatter text and persists it as compact JSON.
 * Returns false (without writing) if the text fails to parse — frontmatter
 * is never split into sections or merged like a regular section.
 */
const saveFrontmatterSection = async (
  id: string,
  format: "json" | "yaml",
  editText: string,
): Promise<boolean> => {
  let data: Record<string, unknown>;
  try {
    data = await encodeFrontmatterFromEdit(editText, format);
  } catch {
    return false;
  }
  const docId = getCurrentDocId();
  if (docId && data._id !== docId) data._id = docId;
  const now = new Date().toISOString();
  data._last_used_at = now;
  await putContent({ id, content: JSON.stringify(data), updatedAt: now });
  return true;
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
  const meta = editorState.metas().find((m) => m.id === id);
  if (meta?.level === -1) return null; // frontmatter has its own save path
  const now = new Date().toISOString();
  await putContent({ id, content: trimmed, updatedAt: now });
  await touchLastUsedAt();
  if (!meta) return null;
  const { heading, level } = extractHeading(trimmed);
  if (meta.heading !== heading || meta.level !== level) {
    const updated = { ...meta, heading, level, updatedAt: now };
    await putMeta(updated);
    return updated;
  }
  return null;
};

/**
 * Normalize and save the current section on navigation away.
 * Handles frontmatter _id protection, section splitting, and merging.
 * Called only from goToSection — not during auto-save.
 *
 * Returns false if the section could not be saved (currently only possible
 * for invalid frontmatter text) — the caller should block navigation so the
 * edit isn't silently discarded.
 */
export const normalizeSectionOnLeave = async (
  id: string,
  meta: SectionMeta,
  value: string,
): Promise<boolean> => {
  if (meta.level === -1) {
    // Invalid frontmatter text is left unsaved — no split/merge logic applies here.
    return saveFrontmatterSection(id, meta.heading as "json" | "yaml", value);
  }

  // ── Regular section ──
  const { current, added } = normalizeSectionText(value.trim());

  const bodyMetas = editorState.metas().filter((m) => m.level >= 0);
  const canDelete = current.raw === "" && bodyMetas.length > 1;
  if (canDelete) {
    await deleteMeta(id);
    await deleteContent(id);
    setMetas((prev) => prev.filter((m) => m.id !== id));
    return true;
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
    return true;
  } else {
    // normalizeFracIndices is cheap (early-exits when no reindex needed).
    // mergeNoHeadingSections only matters when level-0 sections exist; skip
    // the IDB read when there are none.
    const normalized = await normalizeFracIndices(updatedMetas);
    if (normalized.some((m) => m.level === 0)) {
      const result = await mergeNoHeadingSections(normalized);
      setMetas(result.metas);
      return true;
    }
    setMetas(normalized);
  }
  return true;
};

// ── Debounce / auto-save ──

const debounce = createDebounce(
  async ({ id, commander }: { id: string; commander: EditorCommander }) => {
    const value = commander.getValue();
    if (id !== WHOLE_ID && !editorState.metas().find((m) => m.id === id))
      return;
    setSaveStatus("saving");
    try {
      if (id === WHOLE_ID) {
        await saveWholeContent(value);
      } else {
        const updated = await saveRaw(id, value.trim());
        if (updated)
          setMetas((prev) => prev.map((m) => (m.id === id ? updated : m)));
      }
      batch(() => {
        setSectionCount(countText(value));
        setSaveStatus("saved");
      });
    } catch {
      setSaveStatus("dirty");
    }
  },
);

export const notifyEdit = (id: string, commander: EditorCommander) => {
  setSaveStatus("dirty");
  debounce.notify({ id, commander });
};

export const disposeDebounce = () => {
  debounce.dispose();
};

// ── Manual flush ──

/**
 * Flush pending edits to IDB without normalization.
 * Called before navigation; normalizeSectionOnLeave handles the full normalize.
 */
export const flushSave = async (
  id: string,
  getValue: () => string,
): Promise<void> => {
  debounce.dispose();
  const value = getValue();
  const meta = editorState.metas().find((m) => m.id === id);
  setSaveStatus("saving");
  try {
    if (id === WHOLE_ID) {
      await saveWholeContent(value);
    } else if (meta?.level === -1) {
      const ok = await saveFrontmatterSection(
        id,
        meta.heading as "json" | "yaml",
        value,
      );
      if (!ok) throw new Error("Invalid frontmatter");
    } else {
      const updated = await saveRaw(id, value.trim());
      if (updated)
        setMetas((prev) => prev.map((m) => (m.id === id ? updated : m)));
    }
    batch(() => {
      setSectionCount(countText(value));
      setSaveStatus("saved");
    });
  } catch (e) {
    setSaveStatus("dirty");
    throw e;
  }
};

// ── Whole-file save ──

const saveWholeContent = async (raw: string): Promise<void> => {
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
  await touchLastUsedAt();

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
