import { useCallback, useEffect, useRef, useState } from "react";
import { shouldFetchMissingTracks } from "../lib/albumTracks";
import { useTrackListSessionStore } from "../store/trackListSessionStore";

/**
 * Fetches an open album's tracks from the server when the mirror holds none.
 *
 * A library sync that stopped short leaves an album with no track rows at all, and the user
 * had no way back from that except running a whole sync, so opening the album is the repair.
 * The outcome carries the album it belongs to: the view stays mounted while the user walks
 * between albums, and a slower fetch for the previous one must not settle the next one.
 */
export function useMissingTracksRepair(read: {
  albumId: string;
  tracks: readonly unknown[] | undefined;
  isLoading: boolean;
  error: unknown;
  fetchTracks: () => Promise<void>;
}) {
  const { albumId, tracks, isLoading, error, fetchTracks } = read;
  const attemptedAlbumIdRef = useRef<string | null>(null);
  const [outcome, setOutcome] = useState<{ albumId: string; isFetching: boolean; error: string | null } | null>(null);

  useEffect(() => {
    if (!shouldFetchMissingTracks({ isLoading, error, tracks, albumId, attemptedAlbumId: attemptedAlbumIdRef.current })) return;
    attemptedAlbumIdRef.current = albumId;
    setOutcome({ albumId, isFetching: true, error: null });
    const settle = (message: string | null) =>
      setOutcome((prev) => (prev?.albumId === albumId ? { albumId, isFetching: false, error: message } : prev));
    fetchTracks().then(
      () => settle(null),
      (err: unknown) => settle(err instanceof Error ? err.message : String(err)),
    );
  }, [tracks, isLoading, error, albumId, fetchTracks]);

  const retry = useCallback(() => {
    attemptedAlbumIdRef.current = null;
    useTrackListSessionStore.getState().bumpRefresh();
  }, []);

  const current = outcome?.albumId === albumId ? outcome : null;
  return { isFetching: current?.isFetching ?? false, error: current?.error ?? null, retry };
}
