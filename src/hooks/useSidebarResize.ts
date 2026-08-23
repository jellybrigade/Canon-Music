import { useEffect, useRef, useState } from "react";
import { useSetting } from "./useSetting";

interface UseSidebarResizeOptions {
  /** ltr: drag right to expand (sidebar). rtl: drag left to expand (queue panel). */
  direction: "ltr" | "rtl";
  /** Hard clamp applied during live drag. */
  min: number;
  max: number;
  /** When final width drops below this, call onCollapse instead of saving. Defaults to min. */
  saveMin?: number;
  settingKey: string;
  defaultWidth: number;
  onCollapse?: () => void;
}

export function useSidebarResize({
  direction,
  min,
  max,
  saveMin,
  settingKey,
  defaultWidth,
  onCollapse,
}: UseSidebarResizeOptions) {
  const [rawWidth, setRawWidth] = useSetting(settingKey, String(defaultWidth));
  const savedWidth = Math.max(min, Math.min(max, parseInt(rawWidth, 10) || defaultWidth));
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // The drag's document listeners and the body style overrides are installed by
  // an event handler, not by an effect, so nothing frees them if the handle
  // unmounts mid-drag (collapsing the sidebar removes it from the tree). That
  // would leak both listeners and leave the whole app stuck with text selection
  // disabled and an ew-resize cursor. This ref carries the teardown out to the
  // unmount cleanup below.
  const teardownRef = useRef<(() => void) | null>(null);

  useEffect(() => () => { teardownRef.current?.(); }, []);

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const startWidth = liveWidth ?? savedWidth;
    dragRef.current = { startX: e.clientX, startWidth };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ew-resize";

    function computeWidth(clientX: number) {
      if (!dragRef.current) return startWidth;
      const delta = direction === "ltr"
        ? clientX - dragRef.current.startX
        : dragRef.current.startX - clientX;
      return Math.max(min, Math.min(max, dragRef.current.startWidth + delta));
    }

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      setLiveWidth(computeWidth(ev.clientX));
    }

    function teardown() {
      dragRef.current = null;
      teardownRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }

    function onUp(ev: MouseEvent) {
      if (!dragRef.current) return;
      const finalWidth = computeWidth(ev.clientX);
      teardown();
      setLiveWidth(null);

      const threshold = saveMin ?? min;
      if (finalWidth < threshold && onCollapse) {
        onCollapse();
      } else {
        void setRawWidth(String(Math.round(Math.max(threshold, finalWidth))));
      }
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    teardownRef.current = teardown;
  }

  return { liveWidth, savedWidth, isDragging: liveWidth !== null, handleMouseDown };
}
