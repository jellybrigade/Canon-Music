import { useEffect } from "react";
import { usePlayerStore } from "../store/player";
import { getCoverArtUrl } from "../../../clients/navidromeUrls";
import type { ServerWithCredential } from "../../../hooks/useServer";

// Own URL, not `currentTrack.coverArtUrl`: that's the 64px queue-row thumbnail
// (see App.tsx / useQueueSync), which would be upscaled into a much larger panel.
const ART_SIZE = 512;

/** Fires only on a genuine timeline jump: the OS extrapolates position from the wall
 * clock while playing, so a selector on `elapsed` would re-render this needlessly. */
function pushPositionState() {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  const { currentTrack, elapsed } = usePlayerStore.getState();
  const duration = currentTrack?.duration ?? 0;
  try {
    if (!currentTrack || duration <= 0) {
      navigator.mediaSession.setPositionState();
      return;
    }
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.max(0, Math.min(duration, elapsed)),
      // Always 1: the spec requires a non-zero rate, and a paused timeline is
      // communicated by playbackState rather than by the rate.
      playbackRate: 1,
    });
  } catch { /* engines reject transient out-of-range values; next push corrects it */ }
}

export function useMediaSession(serverWithCred?: ServerWithCredential | null) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const artworkRef = currentTrack?.artworkRef ?? null;
  const fallbackArt = currentTrack?.coverArtUrl ?? null;

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      return;
    }

    let artwork: MediaImage[] | undefined;
    if (artworkRef && serverWithCred) {
      const { server, credential } = serverWithCred;
      const src = getCoverArtUrl(server.url, server.username, credential, artworkRef, ART_SIZE);
      artwork = [{ src, sizes: `${ART_SIZE}x${ART_SIZE}` }];
    } else if (fallbackArt) {
      // Size and MIME type are unknown for this one, and claiming either would be a
      // lie the OS uses to pick between candidates. Omitting both is allowed.
      artwork = [{ src: fallbackArt }];
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist ?? undefined,
      album: currentTrack.album ?? undefined,
      artwork,
    });
    // Keyed on the fields actually read, not the track object: an identity-only change
    // would otherwise rebuild the metadata and make the OS re-fetch the artwork.
  }, [
    currentTrack?.id,
    currentTrack?.title,
    currentTrack?.artist,
    currentTrack?.album,
    artworkRef,
    fallbackArt,
    serverWithCred,
  ]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    pushPositionState();
  }, [isPlaying, currentTrack?.id]);

  // Seeks are the one timeline jump with no React-visible state change of its own, so
  // they are picked up straight off the store. The 200ms ticker moves `elapsed` in
  // small steps, which makes anything larger unambiguously a seek or a track change.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    return usePlayerStore.subscribe((s, prev) => {
      if (Math.abs(s.elapsed - prev.elapsed) > 1) pushPositionState();
    });
  }, []);

  // Wire action handlers once, reads live state inside handlers to avoid stale closures
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
    try {
      // Drives the scrubber in the OS panel, as opposed to the fixed-offset skip
      // buttons above. Registered separately because engines that do not implement
      // it throw here rather than ignoring it.
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (details.seekTime == null) return;
        void usePlayerStore.getState().seek(details.seekTime);
      });
    } catch { /* unsupported action */ }

    return () => {
      const actions: MediaSessionAction[] = ["play", "pause", "previoustrack", "nexttrack", "seekbackward", "seekforward", "seekto"];
      for (const action of actions) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch { /* unsupported action */ }
      }
    };
  }, []); // mounted once; handlers read live state from store
}
