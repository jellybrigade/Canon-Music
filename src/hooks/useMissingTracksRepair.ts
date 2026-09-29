import { useCallback, useEffect, useRef, useState } from "react";
import { shouldFetchMissingTracks } from "../lib/albumTracks";
import { useTrackListSessionStore } from "../store/trackListSessionStore";

/**
 * Fetches an open album's tracks when the mirror holds none. The outcome carries its album id
 * so a slow fetch for the previous album can't settle the next one.
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
