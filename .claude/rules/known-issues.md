# Known Issues & Platform Gotchas

Bugs and non-obvious behaviors worth remembering — not conventions (see `coding-standards.md` for those).

## WebKitGTK closes left-click-opened menus on their own opening click

`ContextMenu` (`src/components/ContextMenu.tsx`) closes on outside click via a `document.addEventListener("click", ...)` added in a `useEffect`. On Linux/WebKitGTK, this listener can attach fast enough to still catch the tail of the *same* click event that opened the menu — closing it instantly, before it's ever visibly rendered.

Only affects menus opened via `onClick` (left click). Menus opened via `onContextMenu` (right click) are unaffected — different event type.

**Symptom:** button's `onClick` fires, state updates, `ContextMenu` even runs its render function — but `document.querySelector('.context-menu')` comes back empty. Looks like "the button does nothing."

**Fix already applied:** the outside-click listener in `ContextMenu.tsx` is deferred with `setTimeout(..., 0)` so it can't catch the opening click.

**If a new left-click popover "does nothing":** don't assume it's a fresh bug. Confirm with `console.log` in the popover's render body plus `document.querySelectorAll(...)` immediately after — if render fires but the DOM query comes back empty, this is the same class of bug.
