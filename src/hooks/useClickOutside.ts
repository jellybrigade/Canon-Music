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
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
    // refs are stable (created once per component lifetime)
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
