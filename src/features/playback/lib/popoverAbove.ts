/** Anchors a fixed popover's bottom-right corner to the button's top-right; the gap lives in CSS. */
export function popoverAbove(button: HTMLElement): { right: number; bottom: number } {
  const rect = button.getBoundingClientRect();
  return { right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.top };
}
