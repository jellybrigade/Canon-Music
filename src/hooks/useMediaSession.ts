import { useEffect } from "react";
import { usePlayerStore } from "../store/player";

export function useMediaSession() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist ?? undefined,
      album: currentTrack.album ?? undefined,
      artwork: currentTrack.coverArtUrl
        ? [{ src: currentTrack.coverArtUrl, sizes: "500x500", type: "image/jpeg" }]
        : undefined,
    });
  }, [currentTrack]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  // Wire action handlers once — reads live state inside handlers to avoid stale closures
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.setActionHandler("play", () => {
      usePlayerStore.getState().resume();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      usePlayerStore.getState().pause();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      void usePlayerStore.getState().prev();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      void usePlayerStore.getState().next();
    });
    navigator.mediaSession.setActionHandler("seekbackward", (details) => {
      const offset = details.seekOffset ?? 10;
      const { elapsed } = usePlayerStore.getState();
      void usePlayerStore.getState().seek(Math.max(0, elapsed - offset));
    });
    navigator.mediaSession.setActionHandler("seekforward", (details) => {
      const offset = details.seekOffset ?? 10;
      const { elapsed, currentTrack: ct } = usePlayerStore.getState();
      const dur = ct?.duration ?? null;
      void usePlayerStore.getState().seek(dur ? Math.min(dur, elapsed + offset) : elapsed + offset);
    });

    return () => {
      try {
        const actions: MediaSessionAction[] = ["play", "pause", "previoustrack", "nexttrack", "seekbackward", "seekforward"];
        for (const action of actions) {
          navigator.mediaSession.setActionHandler(action, null);
        }
      } catch { /* ignore */ }
    };
  }, []); // mounted once; handlers read live state from store
}
