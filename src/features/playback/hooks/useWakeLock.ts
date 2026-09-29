import { useEffect, useRef } from "react";
import { usePlayerStore } from "../store/player";

export function useWakeLock() {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const lockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!("wakeLock" in navigator)) return;

    // request() is async: a pause during the request window could run cleanup before the
    // sentinel is stored, orphaning it awake forever. Release against this intent flag, not the ref.
    let cancelled = false;
    // A visibilitychange inside the request window would otherwise start a second
    // request whose sentinel overwrites the first, leaving that one unreleased.
    let isRequesting = false;

    async function acquire() {
      if (cancelled || isRequesting) return;
      // The browser auto-releases the lock when the document is hidden, so a stored
      // sentinel is only still ours while `released` is false.
      if (lockRef.current && !lockRef.current.released) return;
      if (!isPlaying || document.visibilityState !== "visible") return;
      isRequesting = true;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release().catch(() => {});
          return;
        }
        lockRef.current = sentinel;
      } catch { /* degraded silently */ } finally {
        isRequesting = false;
      }
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
