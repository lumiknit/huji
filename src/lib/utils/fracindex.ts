export const FRAC_GAP = 1024;

/** Returns the midpoint between two indices. */
export const between = (prev: number, next: number): number =>
  (prev + next) / 2;

/** Returns the index for appending after the last entry. */
export const after = (last: number): number => last + FRAC_GAP;

/** Rebuilds indices with FRAC_GAP spacing. Call when any gap drops below 1. */
export const reindex = (indices: number[]): number[] =>
  indices.map((_, i) => (i + 1) * FRAC_GAP);

/** Returns true if any adjacent gap is less than 1. */
export const needsReindex = (indices: number[]): boolean => {
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] - indices[i - 1] < 1) return true;
  }
  return false;
};
