// Brings `el` into view by scrolling ONLY its nearest scrollable ancestor —
// never the window/document. On layouts where the move list isn't its own
// scroll container (e.g. mobile, where it flows in the page), this is a no-op,
// so the page — and the board — stays put instead of chasing the active move.
export function scrollActiveIntoView(el: HTMLElement | null): void {
  if (!el) return;
  let parent = el.parentElement;
  while (parent) {
    const oy = getComputedStyle(parent).overflowY;
    const scrollable = (oy === 'auto' || oy === 'scroll') && parent.scrollHeight > parent.clientHeight;
    if (scrollable) {
      const pr = parent.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const pad = 8;
      if (er.top < pr.top + pad) {
        parent.scrollTop -= pr.top + pad - er.top;
      } else if (er.bottom > pr.bottom - pad) {
        parent.scrollTop += er.bottom - (pr.bottom - pad);
      }
      return;
    }
    parent = parent.parentElement;
  }
  // No scrollable container found → deliberately do nothing.
}
