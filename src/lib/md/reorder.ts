import type { FrontmatterType } from "./frontmatter";

export type ReorderEntry =
  | { kind: "fm"; format: FrontmatterType }
  | { kind: "section"; fingerprint: string; level: number; heading: string }
  | { kind: "new"; level: number; heading: string };

export type ReorderParseResult =
  | { ok: true; fmFormat: FrontmatterType | null; entries: ReorderEntry[] }
  | { ok: false; error: string };

const FM_RE = /^(---|\+\+\+|\{\})$/;
const SECTION_RE = /^(#{1,6})\s+([A-Za-z0-9_-]{1,64}):\s*(.*)$/;
const NEW_HEADING_RE = /^(#{1,6})\s+(.+)$/;

/**
 * Parses reorder text. Each line: blank = skip, ---/+++/{} = fm format,
 * "# fp: heading" = existing section, "# heading" = new section.
 */
export const parseReorderText = (text: string): ReorderParseResult => {
  const lines = text.split("\n");
  const entries: ReorderEntry[] = [];
  let fmFormat: FrontmatterType | null = null;
  const errors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fmMatch = FM_RE.exec(line);
    if (fmMatch) {
      fmFormat =
        fmMatch[1] === "---" ? "yaml" : fmMatch[1] === "+++" ? "toml" : "json";
      continue;
    }

    const sectionMatch = SECTION_RE.exec(line);
    if (sectionMatch) {
      entries.push({
        kind: "section",
        level: sectionMatch[1].length,
        fingerprint: sectionMatch[2],
        heading: sectionMatch[3].trim(),
      });
      continue;
    }

    const newMatch = NEW_HEADING_RE.exec(line);
    if (newMatch) {
      entries.push({
        kind: "new",
        level: newMatch[1].length,
        heading: newMatch[2].trim(),
      });
      continue;
    }

    errors.push(`Line ${i + 1}: unrecognized — "${line}"`);
  }

  if (errors.length > 0) {
    return { ok: false, error: errors.join("\n") };
  }

  return { ok: true, fmFormat, entries };
};

export type ReorderTextResult = {
  text: string;
  /** short fingerprint → real section ID */
  fingerprintMap: Map<string, string>;
};

/** Builds reorder text. Fingerprints are the first 3 chars of the section ID; random if collision. */
export const buildReorderText = (
  fmType: FrontmatterType | null,
  sections: Array<{ id: string; level: number; heading: string }>,
): ReorderTextResult => {
  const lines: string[] = [];
  const used = new Set<string>();
  const fingerprintMap = new Map<string, string>();

  if (fmType === "yaml") lines.push("---");
  else if (fmType === "toml") lines.push("+++");
  else if (fmType === "json") lines.push("{}");

  for (const s of sections) {
    if (s.level <= 0) continue;

    let fp = s.id.slice(0, 3);
    if (used.has(fp)) {
      do {
        fp = Math.random().toString(36).slice(2, 5);
      } while (used.has(fp));
    }
    used.add(fp);
    fingerprintMap.set(fp, s.id);

    const hashes = "#".repeat(s.level);
    lines.push(`${hashes} ${fp}: ${s.heading}`);
  }

  return { text: lines.join("\n"), fingerprintMap };
};
