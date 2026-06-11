export const genId = (): string =>
  Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);

export const genUniqueId = (existing: Set<string>): string => {
  let id = genId();
  while (existing.has(id)) id = genId();
  return id;
};
