/** Moves a popover to the app root so panel overflow and stacking never clip it.
 * The app root (not body) keeps Svelte's delegated event listeners working. */
export function portal(node: HTMLElement) {
  const root = document.getElementById("app") ?? document.body;
  root.appendChild(node);
  return { destroy: () => node.remove() };
}

/** Fixed-position coordinates for a popover beside an anchor, kept inside the window. */
export function anchoredPosition(anchor: DOMRect, width: number, height: number, gap = 6): { left: number; top: number } {
  const margin = 8;
  let left = anchor.left;
  let top = anchor.bottom + gap;
  if (top + height > window.innerHeight - margin) top = Math.max(margin, anchor.top - gap - height);
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  return { left, top };
}
