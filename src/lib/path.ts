/** Returns true if the filename is a supported markdown file (.md or .md.gz). */
export const isMDFile = (name: string): boolean =>
  name.endsWith(".md") || name.endsWith(".md.gz");

/**
 * Replace ASCII characters that are unsafe across OS/filesystems and
 * whitespace with '_', then collapse consecutive '_' into one.
 *
 * Kept safe: Unicode letters/symbols, digits, '.', '-'.
 * Replaced:  control chars, whitespace, and: / \ # @ * | , ? : " < > % & ; = + [ ] { } ^ ~ ` ' !
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\x00-\x1f\x7f\s/\\#@*|,?:"<>%&;=+\[\]{}^~`'!]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Pack a backup filename stem (no extension):
 *   <title-max50>.<id>.<YY-MM-DDTHH-mm>
 *
 * - title is sanitized and truncated to 50 chars
 * - id is the document _id (empty string for files without one)
 */
export function packBackupName(
  title: string,
  id: string,
  date = new Date(),
): string {
  const safeTitle = sanitizeFilename(title).slice(0, 50).replace(/_+$/, "");
  const safeId = id.replace(/[^a-z0-9_-]/gi, "");
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${safeTitle}.${safeId}.${yy}-${mm}-${dd}T${hh}-${min}`;
}

/**
 * Unpack a backup filename (with or without .md/.markdown/.txt extension).
 * Returns { title, id } on success, or null if not a recognized backup format.
 *
 * Format: <title>.<id>.<YY-MM-DDTHH-mm>[.ext]   (id may be empty string)
 */
export function unpackBackupName(
  filename: string,
): { title: string; id: string } | null {
  const stem = filename.replace(/\.(md\.gz|md|markdown|txt)$/i, "");
  const m = stem.match(
    /^(.*)\.([A-Za-z0-9_-]*)\.(\d{2}-\d{2}-\d{2}T\d{2}-\d{2})$/,
  );
  if (m) return { title: m[1], id: m[2] };
  return null;
}
