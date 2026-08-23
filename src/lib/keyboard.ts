/**
 * Is this keystroke being typed into a text-entry surface?
 *
 * Window/document-level shortcuts have to ask before acting, because they `preventDefault()`
 * and therefore *swallow* the keystroke rather than merely duplicating it. Shared so the two
 * global listeners (`useGlobalShortcuts`, `useSearchShortcuts`) answer it the same way; a
 * second private copy is how one of them ended up with no guard at all.
 */
export function isTextEntryTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement ||
    t.isContentEditable === true
  );
}
