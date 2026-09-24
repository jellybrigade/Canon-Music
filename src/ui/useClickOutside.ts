import { useEffect, useRef, type RefObject } from "react";

export function useClickOutside(
  refs: RefObject<Element | null> | RefObject<Element | null>[],
  handler: () => void,
  enabled = true
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const arr = Array.isArray(refs) ? refs : [refs];
    function onMouseDown(e: MouseEvent) {
      if (arr.some((r) => r.current?.contains(e.target as Node))) return;
      handlerRef.current();
    }
    // Deferred attach and capture phase are both load-bearing, see known-issues.md
    // "Left-click popup self-closes": on WebKitGTK the tail of the left-click that opened
    // the popover is still dispatching when this effect runs, and capture keeps a subtree
    // that swallows bubbling from holding the popover open.
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", onMouseDown, { capture: true });
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onMouseDown, { capture: true });
    };
    // refs are stable (created once per component lifetime)
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
