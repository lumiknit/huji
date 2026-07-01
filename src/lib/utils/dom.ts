export const scrollSelectionToCenter = () => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  const hh = document.documentElement.clientHeight / 2;
  window.scrollTo({
    top: window.scrollY + rect.top - hh,
    behavior: "smooth",
  });
};
