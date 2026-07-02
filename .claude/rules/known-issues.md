# Known Issues & Platform Gotchas

Bugs + non-obvious behaviors worth remember — not conventions (see `coding-standards.md` for those).

## WebKitGTK closes left-click-opened menus on their own opening click

`ContextMenu` (`src/components/ContextMenu.tsx`) closes on outside click via `document.addEventListener("click", ...)` added in `useEffect`. On Linux/WebKitGTK, listener can attach fast enough to still catch tail of *same* click that opened menu — closes it instantly, before ever visibly render.

Only affects menus opened via `onClick` (left click). Menus opened via `onContextMenu` (right click) unaffected — different event type.

**Symptom:** button's `onClick` fires, state update, `ContextMenu` even run render function — but `document.querySelector('.context-menu')` come back empty. Look like "button does nothing."

**Fix already applied:** outside-click listener in `ContextMenu.tsx` deferred with `setTimeout(..., 0)` so can't catch opening click.

**If new left-click popover "does nothing":** don't assume fresh bug. Confirm with `console.log` in popover's render body plus `document.querySelectorAll(...)` right after — if render fire but DOM query come back empty, same class of bug.