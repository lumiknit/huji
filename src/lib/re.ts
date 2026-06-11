/** Escape a string for use as a literal in a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a fuzzy-match RegExp from a query string.
 * Each character is escaped and joined with `.*` so that "abc" matches
 * "a_b_c", "abbc", "xaxbxc", etc.  Case-insensitive.
 */
export function fuzzyRegex(query: string): RegExp {
  const pattern = [...query].map(escapeRe).join(".*");
  return new RegExp(pattern, "i");
}

/** Returns true if `text` fuzzy-matches `query`. Empty query always matches. */
export function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  return fuzzyRegex(query).test(text);
}
