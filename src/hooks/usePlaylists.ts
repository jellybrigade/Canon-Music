import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import type { ServerWithCredential } from "./useServer";
import { QK } from "../lib/query-keys";
import {
  createNavidromePlaylist,
  deleteNavidromePlaylist,
  addTrackToNavidromePlaylist,
  addTracksToNavidromePlaylist,
  updateNavidromePlaylist,
} from "../lib/navidrome";
import { stripServerPrefix } from "../utils/ids";

export interface PlaylistRow {
  id: string;
  server_id: string;
  name: string;
  comment: string | null;
  track_count: number;
  cover_art_url: string | null;
}

export function usePlaylists() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QK.playlists(),
    queryFn: async () => {
      const db = await getDb();
      return db.select<PlaylistRow[]>(
        "SELECT id, server_id, name, comment, track_count, cover_art_url FROM playlists ORDER BY name ASC",
        []
      );
    },
  });

  async function createPlaylist(name: string, swc: ServerWithCredential): Promise<void> {
    const { server, credential } = swc;
    const created = await createNavidromePlaylist(server.url, server.username, credential, name, server.alt_url ?? undefined);
    const db = await getDb();
    const plDbId = `${server.id}:${created.id}`;
    await db.execute(
      "INSERT OR REPLACE INTO playlists (id, server_id, name, comment, track_count) VALUES (?, ?, ?, ?, ?)",
      [plDbId, server.id, created.name, created.comment ?? null, created.songCount]
    );
    await queryClient.invalidateQueries({ queryKey: QK.playlists() });
  }

  async function deletePlaylist(playlist: PlaylistRow, swc: ServerWithCredential): Promise<void> {
    const { server, credential } = swc;
    const nativeId = stripServerPrefix(playlist.id, server.id);
    await deleteNavidromePlaylist(server.url, server.username, credential, nativeId, server.alt_url ?? undefined);
    const db = await getDb();
    await db.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", [playlist.id]);
    await db.execute("DELETE FROM playlists WHERE id = ?", [playlist.id]);
    await queryClient.invalidateQueries({ queryKey: QK.playlists() });
  }

  async function addTrackToPlaylist(
    playlist: PlaylistRow,
    trackId: string,
    swc: ServerWithCredential
  ): Promise<void> {
    const { server, credential } = swc;
    const nativePlaylistId = stripServerPrefix(playlist.id, server.id);
    const nativeTrackId = stripServerPrefix(trackId, server.id);
    await addTrackToNavidromePlaylist(server.url, server.username, credential, nativePlaylistId, nativeTrackId, server.alt_url ?? undefined);
    const db = await getDb();
    const rows = await db.select<{ max_pos: number | null }[]>(
      "SELECT MAX(position) AS max_pos FROM playlist_tracks WHERE playlist_id = ?",
      [playlist.id]
    );
    const nextPos = (rows[0]?.max_pos ?? -1) + 1;
    await db.execute(
      "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)",
      [playlist.id, trackId, nextPos]
    );
    await db.execute(
      "UPDATE playlists SET track_count = track_count + 1 WHERE id = ?",
      [playlist.id]
    );
    await queryClient.invalidateQueries({ queryKey: QK.playlists() });
    await queryClient.invalidateQueries({ queryKey: QK.playlistTracks(playlist.id) });
  }

  async function renamePlaylist(
    playlist: PlaylistRow,
    name: string,
    comment: string | null,
    swc: ServerWithCredential
  ): Promise<void> {
    const { server, credential } = swc;
    const nativeId = stripServerPrefix(playlist.id, server.id);
    await updateNavidromePlaylist(server.url, server.username, credential, nativeId, name, comment ?? undefined, server.alt_url ?? undefined);
    const db = await getDb();
    await db.execute(
      "UPDATE playlists SET name = ?, comment = ? WHERE id = ?",
      [name, comment, playlist.id]
    );
    await queryClient.invalidateQueries({ queryKey: QK.playlists() });
  }

  async function addAlbumToPlaylist(
    playlist: PlaylistRow,
    albumId: string,
    swc: ServerWithCredential
  ): Promise<void> {
    const { server, credential } = swc;
    const db = await getDb();
    const tracks = await db.select<{ id: string }[]>(
      "SELECT id FROM tracks WHERE album_id = ? ORDER BY disc_number ASC, track_number ASC",
      [albumId]
    );
    if (tracks.length === 0) return;
    const nativePlaylistId = stripServerPrefix(playlist.id, server.id);
    const nativeTrackIds = tracks.map((t) => stripServerPrefix(t.id, server.id));
    await addTracksToNavidromePlaylist(server.url, server.username, credential, nativePlaylistId, nativeTrackIds, server.alt_url ?? undefined);
    const rows = await db.select<{ max_pos: number | null }[]>(
      "SELECT MAX(position) AS max_pos FROM playlist_tracks WHERE playlist_id = ?",
      [playlist.id]
    );
    let nextPos = (rows[0]?.max_pos ?? -1) + 1;
    for (const t of tracks) {
      await db.execute(
        "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)",
        [playlist.id, t.id, nextPos++]
      );
    }
    await db.execute(
      "UPDATE playlists SET track_count = track_count + ? WHERE id = ?",
      [tracks.length, playlist.id]
    );
    await queryClient.invalidateQueries({ queryKey: QK.playlists() });
    await queryClient.invalidateQueries({ queryKey: QK.playlistTracks(playlist.id) });
  }

  return { ...query, createPlaylist, deletePlaylist, addTrackToPlaylist, renamePlaylist, addAlbumToPlaylist };
}
