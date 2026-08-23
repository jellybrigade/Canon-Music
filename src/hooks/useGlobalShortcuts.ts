import { useEffect } from "react";
import { usePlayerStore, isNextDisabled } from "../store/player";
import type { ServerWithCredential } from "./useServer";
import { useLoved } from "./useLoved";
import { isTextEntryTarget } from "../lib/keyboard";

export function useGlobalShortcuts(serverWithCred: ServerWithCredential | null | undefined) {
  const { toggleTrackLove } = useLoved();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTextEntryTarget(e)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const store = usePlayerStore.getState();
      const { currentTrack, isPlaying, isLoading, elapsed, volume, queue, queueIndex, repeat, radioOnQueueEnd } = store;

      switch (e.key) {
        case " ": {
          if (!currentTrack) return;
          e.preventDefault();
          // Key auto-repeat would toggle at ~30/sec, each toggle starting a fade in the
          // audio engine. Held space should be one toggle, like the on-screen button.
          if (e.repeat) return;
          // Matches the transport buttons, which are disabled while a track loads.
          if (isLoading) return;
          isPlaying ? store.pause() : store.resume();
          break;
        }
        case "ArrowLeft": {
          if (e.shiftKey) break;
          if (!currentTrack) return;
          e.preventDefault();
          const duration = currentTrack.duration ?? Infinity;
          void store.seek(Math.max(0, Math.min(duration, elapsed - 5)));
          break;
        }
        case "ArrowRight": {
          if (e.shiftKey) break;
          if (!currentTrack) return;
          e.preventDefault();
          const durationR = currentTrack.duration ?? Infinity;
          void store.seek(Math.max(0, Math.min(durationR, elapsed + 5)));
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          void store.setVolume(Math.min(1, volume + 0.05));
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          void store.setVolume(Math.max(0, volume - 0.05));
          break;
        }
        case "l":
        case "L": {
          if (!currentTrack || !serverWithCred) return;
          void toggleTrackLove(currentTrack.id, serverWithCred);
          break;
        }
      }

      if (e.shiftKey) {
        switch (e.key) {
          case "ArrowLeft": {
            if (!currentTrack) return;
            e.preventDefault();
            void store.prev();
            break;
          }
          case "ArrowRight": {
            if (!currentTrack) return;
            e.preventDefault();
            if (!isNextDisabled(repeat, queueIndex, queue.length, radioOnQueueEnd)) void store.next();
            break;
          }
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [serverWithCred, toggleTrackLove]);
}
