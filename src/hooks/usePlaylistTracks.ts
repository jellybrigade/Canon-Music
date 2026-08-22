import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
        // LEFT JOIN on albums, not an inner one: `album_name` and `album_id` are already
        // nullable on PlaylistTrackRow, and an inner join dropped any track whose album
        // row is missing (pruned by a sync, or a single not-yet-mirrored album) out of the
        // list entirely, so the playlist silently rendered fewer tracks than it holds.
        const rows = await db.select<PlaylistTrackRow[]>(
          `SELECT t.id, t.title, t.artist, t.duration, t.genre, t.year, t.track_number,
                  t.bit_rate, t.suffix,
                  pt.position, a.artwork_url, a.name AS album_name, a.id AS album_id
           FROM playlist_tracks pt
           JOIN tracks t ON pt.track_id = t.id
           LEFT JOIN albums a ON t.album_id = a.id
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
    // The delete and the position compaction after it run as one transaction in Rust, not
    // here: tauri-plugin-sql has no connection affinity, so a "BEGIN" issued from TS is only
    // a real transaction while nothing else queries, which a user-triggered edit overlapping
    // the 5-minute sync cannot promise. The compaction transits through negative positions,
    // and a half-applied one is a state nothing repairs (see known-issues.md).
    await invoke("playlist_remove_track", { playlistId: playlist.id, position });
    usePlaylistSessionStore.getState().bumpPlaylistTracks();
    usePlaylistSessionStore.getState().bumpPlaylists();
  }

  return { data, isLoading, removeTrack };
}
