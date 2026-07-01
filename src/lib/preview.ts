import { getFileMetas } from "./db/meta";
import { getContent } from "./db/content";
import { extractFrontmatter } from "./md/frontmatter";
import { buildHiddenIds } from "./export";
import type { SectionMeta } from "./db/schema";
import type { FrontmatterType } from "./md/frontmatter";

export type RenderRule = { excludeAll?: string; excludeTitle?: string };
export type SectionEntry = { meta: SectionMeta; content: string };
export type PreviewData = {
  entries: SectionEntry[];
  filename: string;
  fmRaw: string | null;
  fmType: FrontmatterType | null;
  fmData: Record<string, unknown>;
  renderRules: Record<string, RenderRule>;
};

export const loadPreviewData = async (fileId: string): Promise<PreviewData> => {
  const metas = await getFileMetas(fileId);
  const entries: SectionEntry[] = [];
  let fmRaw: string | null = null;
  let fmType: FrontmatterType | null = null;
  let fmData: Record<string, unknown> = {};
  let filename = fileId;

  for (const m of metas) {
    const row = await getContent(m.id);
    const content = row?.content ?? "";

    if (m.level === -1) {
      try {
        const info = await extractFrontmatter(content);
        if (info) {
          fmRaw = content;
          fmType = info.type;
          fmData = info.data;
          if (typeof fmData._filename === "string") filename = fmData._filename;
        }
      } catch {
        /* ignore */
      }
      continue;
    }

    entries.push({ meta: m, content });
  }

  const renderRules: Record<string, RenderRule> = {};
  if (fmData._render && typeof fmData._render === "object") {
    for (const [k, v] of Object.entries(
      fmData._render as Record<string, unknown>,
    )) {
      if (v && typeof v === "object") {
        const r = v as Record<string, unknown>;
        renderRules[k] = {
          excludeAll:
            typeof r.exclude_all === "string" ? r.exclude_all : undefined,
          excludeTitle:
            typeof r.exclude_title === "string" ? r.exclude_title : undefined,
        };
      }
    }
  }

  return { entries, filename, fmRaw, fmType, fmData, renderRules };
};

export const stripMdExt = (name: string) =>
  name.replace(/\.(md|markdown)$/i, "");

export const applyRenderRule = (
  entries: SectionEntry[],
  rule: RenderRule | null,
): SectionEntry[] => {
  const hiddenIds = buildHiddenIds(
    entries.map((e) => e.meta),
    rule?.excludeAll,
  );
  let excludeTitleRe: RegExp | null = null;
  if (rule?.excludeTitle) {
    try {
      excludeTitleRe = new RegExp(rule.excludeTitle);
    } catch {
      /* ignore invalid regex */
    }
  }
  return entries
    .filter((e) => !hiddenIds.has(e.meta.id))
    .map((e) => {
      if (excludeTitleRe?.test(e.meta.heading)) {
        const lines = e.content.split("\n");
        return { ...e, content: lines.slice(1).join("\n").trimStart() };
      }
      return e;
    });
};

export type CountMode = "default" | "ignore-spaces";

export const countChars = (text: string, mode: CountMode): number => {
  if (mode === "ignore-spaces") return text.replace(/\s/g, "").length;
  return text.length;
};

export const countWords = (text: string): number => {
  const t = text.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
};

export const plainText = (raw: string): string => {
  // Strip markdown syntax for a rough plain-text representation
  return raw
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "");
};
