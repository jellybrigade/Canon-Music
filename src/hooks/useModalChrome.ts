import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Shared chrome for the portal modals: Escape-to-close, a focus trap, focus restoration, and
 * the `role="dialog"` markup that goes with them. Pair it with `useOverlayDismiss`, which owns
 * the backdrop gesture; between them a modal needs no keyboard or pointer handlers of its own.
 *
 * Three things here are deliberate, and each one is a bug that shipped before:
 *
 * 1. **Escape belongs to the topmost layer, and the layer underneath has to be *told*.**
 *    `useSearchShortcuts` already learned this once (`overlayAbove`), but it learned it as a
 *    hand-written list of the two overlays `App.tsx` happens to know about. That list cannot
 *    reach a dialog whose open state lives in `SearchResults`, three levels down - so a modal
 *    opened inside the search overlay was dismissed by the overlay's own Escape handler, taking
 *    the half-filled form with it. The registry below replaces the list: every modal using this
 *    hook registers itself, and the bottom layer reads a count. A new modal is covered the day
 *    it is written rather than the day somebody remembers to edit `App.tsx`.
 *
 * 2. **Registration order is not a stacking mechanism.** Nothing in this app calls
 *    `stopPropagation` on Escape, and the existing handlers are split across `window` and
 *    `document`, so "who registered last" decides nothing. Only the topmost *registered* modal
 *    acts on the press; every other one stands down by identity, not by timing.
 *
 * 3. **A handle another party can invalidate is not a liveness test.** The element focused when
 *    a modal opened is very often a `ContextMenu` item, and the menu unmounts on select - so
 *    "restore focus to the opener" would restore to a detached node and silently drop focus to
 *    nowhere. Restoration checks `isConnected` and falls back to `document.body`.
 *
 * Escape from inside the modal's own text fields *does* close it. These are form fields with no
 * Escape semantics of their own, which is the opposite of the rename inputs in `PlaylistDetail`
 * and `TagTreeTab` - those own Escape to revert and must keep it, which is why this hook scopes
 * itself to the modal container rather than installing a blanket window guard.
 */

// ── The open-modal registry ────────────────────────────────────────────────────
//
// Module-level rather than context, because the reader (`App.tsx`) is an ancestor of every
// writer and a context would have to be threaded through the portal boundary anyway. Ordered,
// not counted: the Escape branch needs to know *which* modal is topmost, not just how many.

let openModals: symbol[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function registerModal(id: symbol): () => void {
  openModals = [...openModals, id];
  notify();
  return () => {
    openModals = openModals.filter((m) => m !== id);
    notify();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return openModals.length > 0;
}

/**
 * Whether any modal using `useModalChrome` is currently open. Read by `App.tsx` as the third
 * term of `useSearchShortcuts`' `overlayAbove`, so the search overlay stands down while a modal
 * is painted over it.
 */
export function useAnyModalOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test-only reset, so a leaked registration in one case cannot silently pass the next. */
export function __resetModalRegistry() {
  openModals = [];
  notify();
}

// ── Focus ──────────────────────────────────────────────────────────────────────

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // `offsetParent` is null for `display: none`; jsdom reports null for everything, so the
    // hidden-element filter has to be a property test rather than a layout one.
    (el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true",
  );
}

export interface ModalChromeOptions {
  /**
   * Whether Escape may close the modal right now. Pass `false` while a save is in flight, so
   * Escape matches the Cancel button that is already disabled for the same reason - otherwise
   * Escape is a second route around a gate the modal owns.
   */
  closable?: boolean;
}

export interface ModalChrome {
  /** Attach to the dialog element (the box inside the backdrop), not to the backdrop. */
  ref: (node: HTMLElement | null) => void;
  role: "dialog";
  "aria-modal": true;
}

export function useModalChrome(onClose: () => void, options: ModalChromeOptions = {}): ModalChrome {
  const { closable = true } = options;
  const [node, setNode] = useState<HTMLElement | null>(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closableRef = useRef(closable);
  closableRef.current = closable;

  // Identity for the stacking check. One per mount, stable across re-renders.
  const idRef = useRef<symbol | null>(null);
  if (idRef.current === null) idRef.current = Symbol("modal");
  const id = idRef.current;

  // Registration is a mount concern and must not be tied to `node`, or a re-render that
  // remounts the dialog element would briefly empty the registry and let the layer underneath
  // steal the next Escape.
  useEffect(() => registerModal(id), [id]);

  // Focus restoration. Captured on mount, released on unmount, and deliberately not dependent
  // on `node` - the opener is whatever had focus before this modal existed.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus();
      else document.body.focus?.();
    };
  }, []);

  // Initial focus. Only when nothing inside already holds it, so a modal with its own
  // `autoFocus` (SmartPlaylistModal's Name field, ArtistMergeModal's search) keeps the field it
  // chose rather than being yanked to whatever happens to be first in the DOM.
  useEffect(() => {
    if (!node) return;
    if (node.contains(document.activeElement)) return;
    const first = focusableWithin(node)[0];
    (first ?? node).focus?.();
  }, [node]);

  useEffect(() => {
    if (!node) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Topmost only. Every open modal has this listener installed; without the identity
        // check one press would collapse the whole stack, which is the exact failure the
        // search overlay had against the command palette.
        if (openModals[openModals.length - 1] !== id) return;
        if (!closableRef.current) return;
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      if (e.key !== "Tab" || !node) return;
      const items = focusableWithin(node);
      if (items.length === 0) {
        // Nothing to move to; keep focus on the dialog rather than letting it escape behind.
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !node.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    // `window` in the bubble phase, matching `CommandPalette`. The modal is scoped by the
    // registry check rather than by where the listener sits, so the phase only has to be
    // consistent, not clever.
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [node, id]);

  return { ref: setNode, role: "dialog", "aria-modal": true };
}
