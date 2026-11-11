import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { removeTrackFromNavidromePlaylist } from "../../clients/navidromePlaylists";
import { getDb } from "../../db";
import type { ServerWithCredential } from "../../hooks/useServer";
import { stripServerPrefix } from "../../lib/ids";
import { REPLAY_GAIN_COLUMNS } from "../../lib/replayGainRow";
import { usePlaylistSessionStore } from "../../store/playlistSessionStore";
import type { PlaylistTrackRow } from "../../types/library";

export type { PlaylistTrackRow } from "../../types/library";

const NO_ROWS: PlaylistTrackRow[] = [];

export function usePlaylistTracks(playlistId: string | null) {
  const refreshTick = usePlaylistSessionStore((s) => s.playlistTracksTick);
  // Keyed by the playlist it was read for, so the render that switches playlists never shows
  // (or lets a removal act on) the previous playlist's rows under the new header.
  const [result, setResult] = useState<{
    playlistId: string;
    rows: PlaylistTrackRow[] | undefined;
    isLoading: boolean;
  } | null>(null);

  useEffect(() => {
    if (!playlistId) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setResult((prev) => {
      const rows = prev?.playlistId === playlistId ? prev.rows : undefined;
      // A refresh with rows on screen is not loading: the list would swap them for a skeleton.
      return { playlistId, rows, isLoading: rows === undefined };
    });
    (async () => {
      try {
        const db = await getDb();
        // Both joins LEFT: an entry whose track or album isn't mirrored yet still holds its
        // position, so the list matches the server's count and removal indexes stay right.
        const selected = await db.select<(Omit<PlaylistTrackRow, "is_unavailable"> & { missing: number })[]>(
          `SELECT COALESCE(t.id, pt.track_id) AS id, COALESCE(t.title, '') AS title, t.artist, t.duration,
                  t.genre, t.year, t.track_number, t.bit_rate, t.suffix, ${REPLAY_GAIN_COLUMNS},
                  pt.position, a.artwork_url, a.name AS album_name, a.id AS album_id,
                  t.id IS NULL AS missing
           FROM playlist_tracks pt
           LEFT JOIN tracks t ON pt.track_id = t.id
           LEFT JOIN albums a ON t.album_id = a.id
           WHERE pt.playlist_id = ?
           ORDER BY pt.position ASC`,
          [playlistId],
        );
        const rows = selected.map(({ missing, ...row }) => ({ ...row, is_unavailable: missing === 1 }));
        if (!cancelled) setResult({ playlistId, rows, isLoading: false });
      } catch (err) {
        console.error("usePlaylistTracks: failed to load tracks", err);
        if (!cancelled) {
          setResult((prev) => ({
            playlistId,
            rows: prev?.playlistId === playlistId ? prev.rows : undefined,
            isLoading: false,
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playlistId, refreshTick]);

  const current = playlistId && result?.playlistId === playlistId ? result : null;
  const data = playlistId ? current?.rows : NO_ROWS;
  const isLoading = !!playlistId && (current?.isLoading ?? true);

  async function removeTrack(position: number, playlist: { id: string }, swc: ServerWithCredential): Promise<void> {
    const { server, credential } = swc;
    const nativePlaylistId = stripServerPrefix(playlist.id, server.id);
    await removeTrackFromNavidromePlaylist(
      server.url,
      server.username,
      credential,
      nativePlaylistId,
      position,
      server.alt_url ?? undefined,
    );
    // Delete + position compaction run as one Rust transaction: tauri-plugin-sql has no
    // connection affinity, so a TS "BEGIN" isn't safe against a sync racing this edit.
    await invoke("playlist_remove_track", { playlistId: playlist.id, position });
    usePlaylistSessionStore.getState().bumpPlaylistTracks();
    usePlaylistSessionStore.getState().bumpPlaylists();
  }

  return { data, isLoading, removeTrack };
}
