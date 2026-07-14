import type { SectionMeta } from "../db/schema";

export type RawSection = {
  level: number;
  heading: string;
  raw: string;
};

/** For heading-less content, derive a short preview from the first non-whitespace
 *  run, capped at maxLen chars, with all whitespace collapsed to a single space. */
export const derivePlainHeading = (raw: string, maxLen = 32): string => {
  const idx = raw.search(/\S/);
  if (idx === -1) return "";
  // Array.from splits by code point, so a maxLen cut never lands inside a
  // surrogate pair (e.g. an emoji) the way a plain UTF-16 slice() would.
  const codePoints = Array.from(raw.slice(idx));
  return codePoints.slice(0, maxLen).join("").replace(/\s+/g, " ");
};

/** Split markdown body into sections by heading boundaries.
 *  Frontmatter must be stripped before calling this. */
export const splitSections = (body: string): RawSection[] => {
  if (!body.trim()) return [];

  const sections: RawSection[] = [];
  let currentLevel = 0;
  let currentHeading = "";
  let current: string[] = [];
  let inFence = false;
  let fenceSeq = "";

  const flush = () => {
    const raw = current.join("\n");
    if (currentLevel === 0 && !raw.trim()) return;
    const heading =
      currentLevel === 0 ? derivePlainHeading(raw) : currentHeading;
    sections.push({ level: currentLevel, heading, raw });
  };

  let pos = 0;
  while (pos <= body.length) {
    const nl = body.indexOf("\n", pos);
    const lineEnd = nl === -1 ? body.length : nl;
    const line = body.slice(pos, lineEnd);
    pos = lineEnd + 1;
    if (nl === -1 && line === "") break;
    const fenceMatch = line.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceSeq = fenceMatch[1];
      } else if (
        fenceMatch[1][0] === fenceSeq[0] &&
        fenceMatch[1].length >= fenceSeq.length
      ) {
        inFence = false;
        fenceSeq = "";
      }
    }

    if (!inFence) {
      const m = line.match(/^(#{1,6})\s+(.*)$/);
      if (m) {
        flush();
        currentLevel = m[1].length;
        currentHeading = m[2].trim();
        current = [line];
        continue;
      }
    }

    current.push(line);
  }
  flush();

  return sections;
};

/** Extract heading level and text from the first line of raw section text. */
export const extractHeading = (
  raw: string,
): { level: number; heading: string } => {
  const nl = raw.indexOf("\n");
  const firstLine = nl === -1 ? raw : raw.slice(0, nl);
  const m = firstLine.match(/^(#{1,6})\s+(.*)$/);
  if (m) return { level: m[1].length, heading: m[2].trim() };
  return { level: 0, heading: derivePlainHeading(raw) };
};

/** Build hierarchical label like "1-3-2. heading" for the section at index. */
export const buildSectionLabel = (
  metas: SectionMeta[],
  index: number,
): string => {
  const meta = metas[index];
  if (!meta) return "";
  if (meta.level === -1) return "[FrontMatter]";
  if (meta.level === 0) return meta.heading.trim() ? meta.heading : "(empty)";

  const counters = [0, 0, 0, 0, 0, 0, 0];
  let result = "";

  for (let i = 0; i <= index; i++) {
    const m = metas[i];
    if (m.level <= 0) continue;
    counters[m.level]++;
    for (let l = m.level + 1; l <= 6; l++) counters[l] = 0;

    if (i === index) {
      const parts: number[] = [];
      for (let l = 1; l <= m.level; l++) parts.push(counters[l]);
      result = parts.join(".") + ". " + m.heading;
    }
  }
  return result;
};

export type NormalizeResult = {
  current: { heading: string; level: number; raw: string };
  added: RawSection[];
};

/** Parse textarea content and detect if new sections were created inside it. */
export const normalizeSectionText = (raw: string): NormalizeResult => {
  const sections = splitSections(raw.trim());

  if (sections.length === 0) {
    return { current: { heading: "", level: 0, raw: "" }, added: [] };
  }

  const [first, ...rest] = sections;
  // Filter out empty added sections — no point creating blank stubs
  const nonEmptyAdded = rest.filter((s) => s.raw.trim() !== "");

  return {
    current: { heading: first.heading, level: first.level, raw: first.raw },
    added: nonEmptyAdded,
  };
};

/** Assemble full markdown string from frontmatter + sections (for export). */
export const assembleSections = (
  frontmatterRaw: string | null,
  sections: Array<{ raw: string }>,
): string => {
  const parts: string[] = [];
  if (frontmatterRaw) parts.push(frontmatterRaw);
  for (const s of sections) {
    if (s.raw) parts.push(s.raw);
  }
  return parts.join("\n\n");
};

/** Merge a heading-less intro text onto the end of a previous section. */
export const mergeIntroToPrev = (prev: string, intro: string): string => {
  if (!intro.trim()) return prev;
  return prev.trimEnd() + "\n\n" + intro.trimStart();
};
