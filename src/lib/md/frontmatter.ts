export type FrontmatterType = "json" | "yaml" | "toml";

// ── Low-level helpers ──

/** Returns the index of the closing brace of a JSON object. Returns -1 if not found. */
const findJsonEnd = (str: string, start = 0): number => {
  let depth = 0,
    inString = false,
    escaped = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      if (--depth === 0) return i;
    }
  }
  return -1;
};

export type FrontmatterInfo = {
  type: FrontmatterType;
  raw: string;
  data: Record<string, unknown>;
  /** Index immediately after the frontmatter (start of body). */
  end: number;
};

/**
 * Parses frontmatter from the start of a string. Returns null if absent or invalid.
 */
export const extractFrontmatter = async (
  text: string,
): Promise<FrontmatterInfo | null> => {
  if (text.startsWith("{")) {
    const endIdx = findJsonEnd(text, 0);
    if (endIdx !== -1) {
      const raw = text.slice(0, endIdx + 1);
      try {
        const data = JSON.parse(raw) as Record<string, unknown>;
        return { type: "json", raw, data, end: endIdx + 1 };
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  if (text.startsWith("---\n") || text.startsWith("---\r\n")) {
    const offset = text.startsWith("---\r\n") ? 5 : 4;
    const closeIdx = text.indexOf("\n---", offset);
    if (closeIdx !== -1) {
      const raw = text.slice(offset, closeIdx);
      const { load } = await import("js-yaml");
      try {
        const data = (load(raw) ?? {}) as Record<string, unknown>;
        return { type: "yaml", raw, data, end: closeIdx + 4 };
      } catch {
        return null;
      }
    }
    return null;
  }

  if (text.startsWith("+++\n") || text.startsWith("+++\r\n")) {
    const offset = text.startsWith("+++\r\n") ? 5 : 4;
    const closeIdx = text.indexOf("\n+++", offset);
    if (closeIdx !== -1) {
      const raw = text.slice(offset, closeIdx);
      const { parse } = await import("smol-toml");
      try {
        const data = parse(raw) as Record<string, unknown>;
        return { type: "toml", raw, data, end: closeIdx + 4 };
      } catch {
        return null;
      }
    }
    return null;
  }

  return null;
};

// ── Public API ──

/** Splits a markdown string into frontmatter and body. */
export const parseDocument = async (
  text: string,
): Promise<{
  frontmatter: {
    type: FrontmatterType;
    raw: string;
    data: Record<string, unknown>;
  } | null;
  body: string;
}> => {
  const fm = await extractFrontmatter(text);
  if (fm) {
    const body = text.slice(fm.end).replace(/^\n/, "");
    return { frontmatter: { type: fm.type, raw: fm.raw, data: fm.data }, body };
  }
  return { frontmatter: null, body: text };
};

/** Serializes frontmatter data to a raw string for the given format. */
export const serializeFrontmatter = async (
  type: FrontmatterType,
  data: Record<string, unknown>,
): Promise<string> => {
  switch (type) {
    case "json":
      return JSON.stringify(data, null, 2);
    case "yaml": {
      const { dump } = await import("js-yaml");
      return `---\n${dump(data)}---`;
    }
    case "toml": {
      const { stringify } = await import("smol-toml");
      return `+++\n${stringify(data as Parameters<typeof stringify>[0])}\n+++`;
    }
  }
};

/** Returns only user-defined fields, stripping huji internal fields (prefixed with _). */
export const getUserData = (
  data: Record<string, unknown>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!k.startsWith("_")) result[k] = v;
  }
  return result;
};
