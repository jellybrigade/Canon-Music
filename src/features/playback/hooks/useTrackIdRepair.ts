import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

import { SUBSONIC_NOT_FOUND } from "../../../clients/navidrome";
import { repairAlbumTrackIds } from "../../sync/sync";
import { usePlayerStore } from "../store/player";
import type { ServerWithCredential } from "../../../hooks/useServer";

/**
 * Subsonic error 70 at play time means the server does not know the id Canon asked for, which
 * after a server-side id migration is true of most of the library at once. Re-resolve that one
 * album against the server, carry the local-only rows onto the new ids, and play again.
 *
 * Deliberately per album rather than a full resync: the user pressed play, not sync, and a full
 * pass is 1500+ requests. An album is repaired at most once per session, because a repair that
 * did not help would otherwise answer its own error forever.
 */
export function useTrackIdRepair(serverWithCredential: ServerWithCredential | undefined): void {
  // Read through a ref so a credential arriving does not tear down and re-arm the listener.
  const serverRef = useRef(serverWithCredential);
  serverRef.current = serverWithCredential;
  const repairedAlbumIds = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    const pending = listen<{ url: string; subsonicCode?: number | null }>("audio-error", (event) => {
      if (event.payload.subsonicCode !== SUBSONIC_NOT_FOUND) return;
      const target = serverRef.current;
      if (!target) return;
      const { currentTrack, streamUrl } = usePlayerStore.getState();
      // The error names the stream it happened on. Anything else is a track the user has
      // already moved off, and repairing its album would fight whatever is playing now.
      if (!currentTrack || streamUrl !== event.payload.url) return;
      const albumId = currentTrack.albumId;
      if (!albumId || repairedAlbumIds.current.has(albumId)) return;
      repairedAlbumIds.current.add(albumId);

      void repairAlbumTrackIds(target.server, target.credential, albumId)
        .then((remaps) => {
          if (cancelled) return;
          const currentMoved = usePlayerStore.getState().applyTrackIdRemap(remaps);
          if (currentMoved) usePlayerStore.getState().retryCurrent();
        })
        .catch((err: unknown) => {
          console.error(`playback: failed to re-resolve album ${albumId}:`, err);
        });
    });

    return () => {
      cancelled = true;
      void pending.then((unlisten) => unlisten());
    };
  }, []);
}
