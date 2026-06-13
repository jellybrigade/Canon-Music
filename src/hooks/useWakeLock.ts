import { useEffect, useRef } from "react";
import { usePlayerStore } from "../store/player";

export function useWakeLock() {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const lockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!("wakeLock" in navigator)) return;

    async function acquire() {
      if (isPlaying && document.visibilityState === "visible") {
        try {
          lockRef.current = await navigator.wakeLock.request("screen");
        } catch { /* degraded silently */ }
      }
    }

    void acquire();
    document.addEventListener("visibilitychange", acquire);

    return () => {
      document.removeEventListener("visibilitychange", acquire);
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    };
  }, [isPlaying]);
}
