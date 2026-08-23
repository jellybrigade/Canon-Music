import { useEffect, useRef } from "react";
import { usePlayerStore } from "../store/player";

export function useWakeLock() {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const lockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!("wakeLock" in navigator)) return;

    // request() is async, so a pause arriving inside the request window used to run
    // this effect's cleanup while lockRef was still null: cleanup released nothing,
    // then the pending request resolved and stored a live sentinel nobody owned, and
    // the screen stayed awake for the rest of the session. Release against the intent
    // recorded here, not against whatever happened to be in the ref when cleanup ran.
    let cancelled = false;

    async function acquire() {
      if (cancelled) return;
      // The browser auto-releases the lock when the document is hidden, so a stored
      // sentinel is only still ours while `released` is false.
      if (lockRef.current && !lockRef.current.released) return;
      if (!isPlaying || document.visibilityState !== "visible") return;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release().catch(() => {});
          return;
        }
        lockRef.current = sentinel;
      } catch { /* degraded silently */ }
    }

    void acquire();
    document.addEventListener("visibilitychange", acquire);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    };
  }, [isPlaying]);
}
