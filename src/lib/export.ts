import { getFileMetas } from "./db/meta";
import { getContent } from "./db/content";
import { assembleSections } from "./md/section";
import { renderMarkdown, extractText } from "./md/render";
import {
  getUserData,
  parseFrontmatterDataLoose,
  serializeFrontmatter,
} from "./md/frontmatter";
import type { FrontmatterType } from "./md/frontmatter";

export type FmMode = "remove-huji" | "exclude";

export type ExportEntry = {
  content: string;
  excluded?: boolean;
};

/**
 * Build a Set of section IDs that should be hidden based on excludeAll pattern.
 * A matching heading hides itself and all immediately following sections
 * with a deeper level, until a section at the same or shallower level appears.
 */
export const buildHiddenIds = (
  metas: Array<{ id: string; level: number; heading: string }>,
  excludeAllPattern: string | undefined,
): Set<string> => {
  if (!excludeAllPattern) return new Set();
  let regex: RegExp;
  try {
    regex = new RegExp(excludeAllPattern);
  } catch {
    return new Set();
  }
  const hidden = new Set<string>();
  let hideUntilLevel: number | null = null;
  for (const m of metas) {
    if (hideUntilLevel !== null && m.level > hideUntilLevel) {
      hidden.add(m.id);
    } else {
      hideUntilLevel = null;
      if (regex.test(m.heading)) {
        hideUntilLevel = m.level;
        hidden.add(m.id);
      }
    }
  }
  return hidden;
};

/** Normalize whitespace between paragraphs: collapse 3+ newlines (possibly with spaces) to exactly 2. */
export const normalizeNewlines = (text: string): string =>
  text.trim().replace(/(\n[ \t]*){3,}/g, "\n\n");

export const buildFmRaw = async (
  fmContent: string | null,
  fmType: FrontmatterType | null,
  fmData: Record<string, unknown>,
  mode: FmMode,
): Promise<string | null> => {
  if (mode === "exclude" || !fmContent || !fmType) return null;
  return serializeFrontmatter(fmType, getUserData(fmData));
};

export const buildMarkdown = async (
  fmContent: string | null,
  fmType: FrontmatterType | null,
  fmData: Record<string, unknown>,
  entries: ExportEntry[],
  fmMode: FmMode,
): Promise<string> => {
  const fm = await buildFmRaw(fmContent, fmType, fmData, fmMode);
  return assembleSections(
    fm,
    entries.filter((e) => !e.excluded).map((e) => ({ raw: e.content })),
  );
};

export const buildHtml = (entries: ExportEntry[]): string =>
  entries
    .filter((e) => !e.excluded)
    .map((e) => renderMarkdown(e.content))
    .join("\n");

export const buildPlainText = (entries: ExportEntry[]): string =>
  normalizeNewlines(
    entries
      .filter((e) => !e.excluded)
      .map((e) => extractText(e.content))
      .join("\n\n"),
  );

/** Pack markdown string into a Blob, optionally gzip-compressed. */
export const packMDBlob = async (
  md: string,
  opts?: { gzip?: boolean },
): Promise<Blob> => {
  const raw = new Blob([md], { type: "text/markdown" });
  if (!opts?.gzip) return raw;
  const stream = raw.stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
};

/** Unpack a markdown Blob to string. Detects gzip via magic bytes (1f 8b). */
export const unpackMDBlob = async (blob: Blob): Promise<string> => {
  const header = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (header.length >= 2 && header[0] === 0x1f && header[1] === 0x8b) {
    const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }
  return blob.text();
};

export const downloadBlob = (
  content: string | Blob,
  mime: string,
  filename: string,
) => {
  const blob =
    typeof content === "string" ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const buildDocx = async (entries: ExportEntry[]): Promise<Blob> => {
  const html = buildHtml(entries);
  const { convert } = await import("./html_to_docx");
  return convert(html);
};

/** Load all sections for a file and return raw markdown (no render rules applied). */
export const loadRawMarkdown = async (
  fileId: string,
): Promise<{ md: string; filename: string }> => {
  const metas = await getFileMetas(fileId);
  let fmContent: string | null = null;
  let filename = fileId;
  const entries: ExportEntry[] = [];

  for (const m of metas) {
    const row = await getContent(m.id);
    const content = row?.content ?? "";
    if (m.level === -1) {
      const parsed = await parseFrontmatterDataLoose(content);
      if (parsed) {
        const { data } = parsed;
        if (typeof data._filename === "string") filename = data._filename;
        const format: FrontmatterType = m.heading === "yaml" ? "yaml" : "json";
        fmContent = await serializeFrontmatter(format, data);
      }
      continue;
    }
    entries.push({ content });
  }

  const fm = fmContent;
  const md = assembleSections(
    fm,
    entries.map((e) => ({ raw: e.content })),
  );
  return { md, filename };
};
