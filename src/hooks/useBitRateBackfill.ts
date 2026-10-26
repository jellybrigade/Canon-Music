import { useEffect, useRef } from "react";

// Tracks synced before bit rates were stored (v32) all read null; one re-sync fills them in.
// One attempt per album, or the refetch it triggers would re-satisfy the condition and loop.
export function useBitRateBackfill(
  albumId: string,
  tracks: readonly { bit_rate: number | null }[] | undefined,
  syncTracks: () => Promise<void>,
): void {
  const attemptedAlbumRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tracks || tracks.length === 0) return;
    if (attemptedAlbumRef.current === albumId) return;
    if (!tracks.every((track) => track.bit_rate === null)) return;
    attemptedAlbumRef.current = albumId;
    syncTracks().catch((err) => console.error("AlbumDetail: bit rate re-sync failed", err));
  }, [albumId, tracks, syncTracks]);
}
