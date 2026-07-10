import { deleteFileAllMeta, getFileMetas } from "../lib/db/meta";
import { getContent, putContent, deleteContents } from "../lib/db/content";
import { parseFrontmatterDataLoose } from "../lib/md/frontmatter";
import type { SyncFile } from "../lib/sync/interface";
import { unpackBackupName } from "../lib/path";
import { fuzzyMatch } from "../lib/re";

// ── Types ────────────────────────────────────────────────────────────────────

export type FileSummary = {
  fileId: string;
  docId?: string;
  filename: string;
  lastUsedAt: string;
  tags: string[];
  /** ISO timestamp if the file is in the Trash, undefined otherwise. */
  deletedAt?: string;
};

export type LocalListItem = {
  kind: "local";
  fileId: string;
  docId?: string;
  filename: string;
  sortAt: number;
  lastUsedAt: string;
  tags: string[];
};

export type CloudListItem = {
  kind: "cloud";
  file: SyncFile;
  displayName: string;
  /** Parsed from backup filename; used for grouping. */
  docId?: string;
  sortAt: number;
};

export type ListItem = LocalListItem | CloudListItem;

export type ItemGroup = {
  groupKey: string;
  docId: string | null;
  items: ListItem[];
};

// ── Formatters ───────────────────────────────────────────────────────────────

export function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Coarse "N unit(s) ago" label for a millisecond duration. Not meant to
 *  tick live — callers compute `ms` once (e.g. against the time the page
 *  was entered) rather than re-diffing against the current clock. */
export function formatRelativeTime(ms: number): string {
  if (ms < 5_000) return "just now";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

// ── Tag color ────────────────────────────────────────────────────────────────

const tagColorCache = new Map<string, string>();

export const tagColor = (tag: string): string => {
  const cached = tagColorCache.get(tag);
  if (cached) return cached;
  let h = 0;
  for (let i = 0; i < tag.length; i++)
    h = (h * 31 + tag.charCodeAt(i)) & 0xffff;
  const hue = ((h % 360) + 360) % 360;
  const sat = 55 + (h % 20);
  const color = `hsl(${hue}, ${sat}%, var(--badge-l))`;
  tagColorCache.set(tag, color);
  return color;
};

// ── DB operations ────────────────────────────────────────────────────────────

export const deleteLocalFile = async (fileId: string): Promise<void> => {
  const metas = await getFileMetas(fileId);
  const ids = metas.map((m) => m.id);
  await deleteFileAllMeta(fileId);
  await deleteContents(ids);
};

/** Soft-delete: flag the file's frontmatter as trashed (deleted=true) or
 *  restore it (deleted=false), without touching its content. */
export const setFileDeleted = async (
  fileId: string,
  deleted: boolean,
): Promise<void> => {
  const metas = await getFileMetas(fileId);
  const fmMeta = metas.find((m) => m.level === -1);
  if (!fmMeta) return;
  const row = await getContent(fmMeta.id);
  if (!row) return;
  const parsed = await parseFrontmatterDataLoose(row.content);
  if (!parsed) return;
  const { data } = parsed;
  const now = new Date().toISOString();
  if (deleted) data._deleted_at = now;
  else delete data._deleted_at;
  await putContent({
    id: fmMeta.id,
    content: JSON.stringify(data),
    updatedAt: now,
  });
};

// ── Group builder ────────────────────────────────────────────────────────────

export function buildGroups(
  localItems: FileSummary[],
  cloudItems: SyncFile[],
  query: string,
): ItemGroup[] {
  const locals: ListItem[] = localItems
    .filter(
      (f) =>
        fuzzyMatch(query, f.filename) ||
        f.tags.some((t) => fuzzyMatch(query, t)),
    )
    .map((f) => ({
      kind: "local" as const,
      fileId: f.fileId,
      docId: f.docId,
      filename: f.filename,
      sortAt: new Date(f.lastUsedAt).getTime(),
      lastUsedAt: f.lastUsedAt,
      tags: f.tags,
    }));

  // Single unpackBackupName call per item covers both filter and map.
  const clouds: ListItem[] = cloudItems.flatMap((f) => {
    const unpacked = unpackBackupName(f.name);
    const title =
      unpacked?.title ?? f.name.replace(/\.(md|markdown|txt)$/i, "");
    if (!fuzzyMatch(query, title)) return [];
    return [
      {
        kind: "cloud" as const,
        file: f,
        displayName: title,
        docId: unpacked?.id || undefined,
        sortAt: f.modifiedAt.getTime(),
      },
    ];
  });

  const merged = [...locals, ...clouds].sort((a, b) => b.sortAt - a.sortAt);

  const groupMap = new Map<string, ListItem[]>();
  const singletons: ItemGroup[] = [];

  for (const item of merged) {
    const docId = item.kind === "local" ? item.docId : item.docId;
    if (docId) {
      if (!groupMap.has(docId)) groupMap.set(docId, []);
      groupMap.get(docId)!.push(item);
    } else {
      const key =
        item.kind === "local"
          ? `file:${item.fileId}`
          : `cloud:${item.file.name}`;
      singletons.push({ groupKey: key, docId: null, items: [item] });
    }
  }

  const docGroups: ItemGroup[] = [...groupMap.entries()].map(
    ([docId, its]) => ({ groupKey: docId, docId, items: its }),
  );

  return [...docGroups, ...singletons].sort(
    (a, b) => (b.items[0]?.sortAt ?? 0) - (a.items[0]?.sortAt ?? 0),
  );
}
