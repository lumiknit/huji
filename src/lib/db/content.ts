import { getDB } from ".";
import type { SectionContent } from "./schema";

export const getContent = async (
  id: string,
): Promise<SectionContent | undefined> => {
  const db = await getDB();
  return db.get("content", id);
};

export const getContents = async (
  ids: string[],
): Promise<Map<string, string>> => {
  const db = await getDB();
  const tx = db.transaction("content", "readonly");
  const rows = await Promise.all(ids.map((id) => tx.store.get(id)));
  const map = new Map<string, string>();
  for (let i = 0; i < ids.length; i++) {
    map.set(ids[i], rows[i]?.content ?? "");
  }
  return map;
};

export const putContent = async (content: SectionContent): Promise<void> => {
  const db = await getDB();
  await db.put("content", { ...content, content: content.content.trim() });
};

export const putContents = async (
  contents: SectionContent[],
): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction("content", "readwrite");
  await Promise.all([
    ...contents.map((c) => tx.store.put({ ...c, content: c.content.trim() })),
    tx.done,
  ]);
};

export const deleteContent = async (id: string): Promise<void> => {
  const db = await getDB();
  await db.delete("content", id);
};

export const deleteContents = async (ids: string[]): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction("content", "readwrite");
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
};
