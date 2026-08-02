import { useEffect, useRef, useState } from "react";
import { getDb } from "../db";
import type { ServerWithCredential } from "./useServer";
import { removeTrackFromNavidromePlaylist } from "../lib/navidrome";
import { stripServerPrefix } from "../utils/ids";
import { usePlaylistSessionStore } from "../store/playlistSessionStore";
import type { PlaylistTrackRow } from "../types/library";
export type { PlaylistTrackRow } from "../types/library";

export function usePlaylistTracks(playlistId: string | null) {
  const refreshTick = usePlaylistSessionStore((s) => s.playlistTracksTick);
  const [data, setData] = useState<PlaylistTrackRow[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(!!playlistId);
  const prevPlaylistIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!playlistId) {
      setData([]);
      setIsLoading(false);
      prevPlaylistIdRef.current = null;
      return;
    }
    if (prevPlaylistIdRef.current !== playlistId) {
      setData(undefined);
    }
    prevPlaylistIdRef.current = playlistId;
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const db = await getDb();
        const rows = await db.select<PlaylistTrackRow[]>(
          `SELECT t.id, t.title, t.artist, t.duration, t.genre, t.year, t.track_number,
                  t.bit_rate, t.suffix,
                  pt.position, a.artwork_url, a.name AS album_name, a.id AS album_id
           FROM playlist_tracks pt
           JOIN tracks t ON pt.track_id = t.id
           JOIN albums a ON t.album_id = a.id
           WHERE pt.playlist_id = ?
           ORDER BY pt.position ASC`,
          [playlistId]
        );
        if (!cancelled) {
          setData(rows);
          setIsLoading(false);
        }
      } catch (err) {
        console.error("usePlaylistTracks: failed to load tracks", err);
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playlistId, refreshTick]);

  async function removeTrack(
    position: number,
    playlist: { id: string },
    swc: ServerWithCredential
  ): Promise<void> {
    const { server, credential } = swc;
    const nativePlaylistId = stripServerPrefix(playlist.id, server.id);
    await removeTrackFromNavidromePlaylist(server.url, server.username, credential, nativePlaylistId, position, server.alt_url ?? undefined);
    const db = await getDb();
    await db.execute(
      "DELETE FROM playlist_tracks WHERE playlist_id = ? AND position = ?",
      [playlist.id, position]
    );
    // Close the hole the delete left. `position` doubles as the server's
    // songIndexToRemove (see the call in PlaylistDetail), and the server compacts its
    // own indexes on removal, so leaving a gap here means the next removal in the same
    // session sends a stale index and deletes the wrong track server side. It is also
    // what the row numbering renders, so a gap shows up as 1, 2, 4.
    //
    // Two passes through negative space because PRIMARY KEY (playlist_id, position)
    // is enforced per row: a single in-place decrement collides with the row still
    // holding the target position whenever SQLite happens to scan descending.
    await db.execute(
      "UPDATE playlist_tracks SET position = -(position - 1) WHERE playlist_id = ? AND position > ?",
      [playlist.id, position]
    );
    await db.execute(
      "UPDATE playlist_tracks SET position = -position WHERE playlist_id = ? AND position < 0",
      [playlist.id]
    );
    await db.execute(
      "UPDATE playlists SET track_count = MAX(0, track_count - 1) WHERE id = ?",
      [playlist.id]
    );
    usePlaylistSessionStore.getState().bumpPlaylistTracks();
    usePlaylistSessionStore.getState().bumpPlaylists();
  }

  return { data, isLoading, removeTrack };
}
