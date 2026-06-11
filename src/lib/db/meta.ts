import { getDB } from ".";
import type { SectionMeta } from "./schema";
import { FRAC_GAP, needsReindex, reindex } from "../utils/fracindex";

export const getFileMetas = async (fileId: string): Promise<SectionMeta[]> => {
  const db = await getDB();
  const rows = await db.getAllFromIndex("meta", "byFile", fileId);
  return rows.sort((a, b) => a.fracIndex - b.fracIndex);
};

export const putMeta = async (meta: SectionMeta): Promise<void> => {
  const db = await getDB();
  await db.put("meta", meta);
};

export const putMetas = async (metas: SectionMeta[]): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction("meta", "readwrite");
  await Promise.all([...metas.map((m) => tx.store.put(m)), tx.done]);
};

export const deleteMeta = async (id: string): Promise<void> => {
  const db = await getDB();
  await db.delete("meta", id);
};

export const deleteMetas = async (ids: string[]): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction("meta", "readwrite");
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
};

/** Re-indexes fracIndices if any gap has dropped below 1, persists to DB, and returns the updated list. */
export const normalizeFracIndices = async (
  metas: SectionMeta[],
): Promise<SectionMeta[]> => {
  const indices = metas.map((m) => m.fracIndex);
  if (!needsReindex(indices)) return metas;

  const newIndices = reindex(indices);
  const updated = metas.map((m, i) => ({ ...m, fracIndex: newIndices[i] }));
  await putMetas(updated);
  return updated;
};

/** Deletes all section metas for a file (used when deleting a file). */
export const deleteFileAllMeta = async (fileId: string): Promise<void> => {
  const metas = await getFileMetas(fileId);
  await deleteMetas(metas.map((m) => m.id));
};

/** Calculates the fracIndex for inserting a new section. Appends to end if afterFracIndex is undefined. */
export const calcInsertFracIndex = (
  metas: SectionMeta[],
  afterFracIndex?: number,
): number => {
  if (metas.length === 0) return FRAC_GAP;
  if (afterFracIndex === undefined)
    return metas[metas.length - 1].fracIndex + FRAC_GAP;

  const idx = metas.findIndex((m) => m.fracIndex === afterFracIndex);
  if (idx === -1 || idx === metas.length - 1)
    return metas[metas.length - 1].fracIndex + FRAC_GAP;

  return (metas[idx].fracIndex + metas[idx + 1].fracIndex) / 2;
};
