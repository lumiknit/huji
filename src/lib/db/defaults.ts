export const DEFAULT_RENDER_RULES = {
  Simple: {
    exclude_all: "^\\s*\\(\\(",
    exclude_title: "^\\s*\\(",
  },
};

/** Ensures _render is a valid object; resets to defaults if missing or invalid. */
export const ensureRenderRules = (fmData: Record<string, unknown>): boolean => {
  if (
    fmData._render &&
    typeof fmData._render === "object" &&
    !Array.isArray(fmData._render)
  ) {
    return false;
  }
  fmData._render = DEFAULT_RENDER_RULES;
  return true;
};
