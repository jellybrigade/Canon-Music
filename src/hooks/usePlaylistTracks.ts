import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import type { ServerWithCredential } from "./useServer";
import { removeTrackFromNavidromePlaylist } from "../lib/navidrome";
import { stripServerPrefix } from "../lib/ids";
import { QK } from "../lib/query-keys";

export interface PlaylistTrackRow {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  genre: string | null;
  track_number: number | null;
  position: number;
  artwork_url: string | null;
  album_name: string | null;
  album_id: string | null;
}

export function usePlaylistTracks(playlistId: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QK.playlistTracks(playlistId),
    queryFn: async () => {
      if (!playlistId) return [];
      const db = await getDb();
      return db.select<PlaylistTrackRow[]>(
        `SELECT t.id, t.title, t.artist, t.duration, t.genre, t.track_number,
                pt.position, a.artwork_url, a.name AS album_name, a.id AS album_id
         FROM playlist_tracks pt
         JOIN tracks t ON pt.track_id = t.id
         JOIN albums a ON t.album_id = a.id
         WHERE pt.playlist_id = ?
         ORDER BY pt.position ASC`,
        [playlistId]
      );
    },
    enabled: !!playlistId,
  });

  async function removeTrack(
    position: number,
    playlist: { id: string },
    swc: ServerWithCredential
  ): Promise<void> {
    const { server, credential } = swc;
    const nativePlaylistId = stripServerPrefix(playlist.id, server.id);
    await removeTrackFromNavidromePlaylist(server.url, server.username, credential, nativePlaylistId, position);
    const db = await getDb();
    await db.execute(
      "DELETE FROM playlist_tracks WHERE playlist_id = ? AND position = ?",
      [playlist.id, position]
    );
    await db.execute(
      "UPDATE playlists SET track_count = MAX(0, track_count - 1) WHERE id = ?",
      [playlist.id]
    );
    await queryClient.invalidateQueries({ queryKey: QK.playlistTracks(playlistId) });
    await queryClient.invalidateQueries({ queryKey: QK.playlists() });
  }

  return { ...query, removeTrack };
}
