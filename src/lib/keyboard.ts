/**
 * Is this keystroke going into a text field? Global shortcuts `preventDefault()`, so they must
 * ask before swallowing it.
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
