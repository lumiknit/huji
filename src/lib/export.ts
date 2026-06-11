import { getFileMetas } from "./db/meta";
import { getContent } from "./db/content";
import { assembleSections } from "./md/section";
import { renderMarkdown, extractText } from "./md/render";
import {
  extractFrontmatter,
  getUserData,
  serializeFrontmatter,
} from "./md/frontmatter";
import type { FrontmatterType } from "./md/frontmatter";

export type FmMode = "remove-huji" | "exclude";

export type ExportEntry = {
  content: string;
  excluded?: boolean;
};

/** Sections whose heading starts with "((" are always hidden. */
export const isHiddenHeading = (heading: string): boolean =>
  heading.startsWith("((");

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
      const info = await extractFrontmatter(content).catch(() => null);
      if (info) {
        fmContent = content;
        if (typeof info.data._filename === "string")
          filename = info.data._filename;
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
