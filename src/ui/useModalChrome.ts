import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Escape-to-close, focus trap, focus restoration and dialog markup for portal modals.
 * Pair with `useOverlayDismiss` for the backdrop gesture.
 */

// Ordered, not counted: only the topmost registered modal acts on Escape, by identity.
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
 * Whether any modal using `useModalChrome` is open. Feeds `useSearchShortcuts`'
 * `overlayAbove` so the search overlay stands down while a modal is painted over it.
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
   * Whether Escape may close the modal. Pass `false` while a save is in flight, matching
   * the disabled Cancel button - otherwise Escape bypasses a gate the modal owns.
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
      // The opener is often a ContextMenu item that unmounted on select.
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
