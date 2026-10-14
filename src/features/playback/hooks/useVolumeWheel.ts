import { useEffect, useRef } from "react";
import { usePlayerStore } from "../store/player";

/** Attached natively, not via onWheel: React's passive root listener makes preventDefault()
 * a no-op there, so the page would scroll under the user while they adjust volume. */
export function useVolumeWheel() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { volume, setVolume } = usePlayerStore.getState();
      void setVolume(Math.max(0, Math.min(1, volume - e.deltaY * 0.001)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  return ref;
}
