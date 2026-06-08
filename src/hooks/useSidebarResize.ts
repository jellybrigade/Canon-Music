import { useRef, useState } from "react";
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

    function onUp(ev: MouseEvent) {
      if (!dragRef.current) return;
      const finalWidth = computeWidth(ev.clientX);
      dragRef.current = null;
      setLiveWidth(null);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);

      const threshold = saveMin ?? min;
      if (finalWidth < threshold && onCollapse) {
        onCollapse();
      } else {
        void setRawWidth(String(Math.round(Math.max(threshold, finalWidth))));
      }
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return { liveWidth, savedWidth, isDragging: liveWidth !== null, handleMouseDown };
}
