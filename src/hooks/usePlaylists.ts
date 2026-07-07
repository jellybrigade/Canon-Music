import { useQuery, useQueryClient } from "@tanstack/react-query";
import type Database from "@tauri-apps/plugin-sql";
import { getDb } from "../db";
import type { ServerWithCredential } from "./useServer";
import { QK } from "../lib/query-keys";
import {
  createNavidromePlaylist,
  deleteNavidromePlaylist,
  addTrackToNavidromePlaylist,
  addTracksToNavidromePlaylist,
  updateNavidromePlaylist,
  replaceNavidromePlaylistTracks,
} from "../lib/navidrome";
import { stripServerPrefix } from "../utils/ids";
import { buildSmartQuery, type SmartFilters } from "../lib/smartPlaylist";

// tauri-plugin-sql's SQLite pool has more than one connection, so a raw
// BEGIN/COMMIT split across two separate execute() calls can land on
// different connections and silently fail to wrap anything. Batch writes
// into fewer, larger multi-row statements instead. Chunk size is derived
// from SQLite's bound-parameter ceiling divided by params-per-row (same
// pattern as lib/sync.ts / lib/tag-normalize.ts).
const SQLITE_MAX_VARIABLES = 32000;

async function insertPlaylistTracksBatch(
  db: Database,
  playlistId: string,
  trackIds: string[],
  startPos: number
): Promise<void> {
  if (trackIds.length === 0) return;
  const paramsPerRow = 3;
  const chunkSize = Math.max(1, Math.floor(SQLITE_MAX_VARIABLES / paramsPerRow));
  for (let start = 0; start < trackIds.length; start += chunkSize) {
    const chunk = trackIds.slice(start, start + chunkSize);
    const placeholders = chunk.map(() => "(?, ?, ?)").join(", ");
    const params = chunk.flatMap((trackId, i) => [playlistId, trackId, startPos + start + i]);
    await db.execute(
      `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES ${placeholders}`,
      params
    );
  }
}

export interface PlaylistRow {
  id: string;
  server_id: string;
  name: string;
  comment: string | null;
  track_count: number;
  cover_art_url: string | null;
  custom_cover_data: string | null;
  is_smart: number;
  rules_json: string | null;
}

export function usePlaylists() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QK.playlists(),
    queryFn: async () => {
      const db = await getDb();
      return db.select<PlaylistRow[]>(
        "SELECT id, server_id, name, comment, track_count, cover_art_url, custom_cover_data, is_smart, rules_json FROM playlists ORDER BY name ASC",
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
    const nextPos = (rows[0]?.max_pos ?? -1) + 1;
    await insertPlaylistTracksBatch(db, playlist.id, tracks.map((t) => t.id), nextPos);
    await db.execute(
      "UPDATE playlists SET track_count = track_count + ? WHERE id = ?",
      [tracks.length, playlist.id]
    );
    await queryClient.invalidateQueries({ queryKey: QK.playlists() });
    await queryClient.invalidateQueries({ queryKey: QK.playlistTracks(playlist.id) });
  }

  async function setCustomCover(playlistId: string, dataUri: string | null): Promise<void> {
    const db = await getDb();
    await db.execute("UPDATE playlists SET custom_cover_data = ? WHERE id = ?", [dataUri, playlistId]);
    await queryClient.invalidateQueries({ queryKey: QK.playlists() });
  }

  async function createSmartPlaylist(filters: SmartFilters, swc: ServerWithCredential): Promise<void> {
    const { server, credential } = swc;
    const db = await getDb();
    const { sql, params } = buildSmartQuery(filters, server.id);
    const trackRows = await db.select<{ id: string }[]>(sql, params);
    const created = await createNavidromePlaylist(server.url, server.username, credential, filters.name, server.alt_url ?? undefined);
    const plDbId = `${server.id}:${created.id}`;
    if (trackRows.length > 0) {
      const nativeTrackIds = trackRows.map((t) => stripServerPrefix(t.id, server.id));
      await addTracksToNavidromePlaylist(server.url, server.username, credential, created.id, nativeTrackIds, server.alt_url ?? undefined);
    }
    await db.execute(
      "INSERT OR REPLACE INTO playlists (id, server_id, name, comment, track_count, is_smart, rules_json) VALUES (?, ?, ?, ?, ?, 1, ?)",
      [plDbId, server.id, filters.name, null, trackRows.length, JSON.stringify(filters)]
    );
    await insertPlaylistTracksBatch(db, plDbId, trackRows.map((t) => t.id), 0);
    await queryClient.invalidateQueries({ queryKey: QK.playlists() });
  }

  async function refreshSmartPlaylist(playlist: PlaylistRow, swc: ServerWithCredential): Promise<void> {
    if (!playlist.is_smart || !playlist.rules_json) return;
    const filters = JSON.parse(playlist.rules_json) as SmartFilters;
    const { server, credential } = swc;
    const db = await getDb();
    const { sql, params } = buildSmartQuery(filters, server.id);
    const trackRows = await db.select<{ id: string }[]>(sql, params);
    const nativePlaylistId = stripServerPrefix(playlist.id, server.id);
    const nativeTrackIds = trackRows.map((t) => stripServerPrefix(t.id, server.id));
    await replaceNavidromePlaylistTracks(
      server.url, server.username, credential,
      nativePlaylistId, nativeTrackIds, playlist.track_count,
      server.alt_url ?? undefined
    );
    await db.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", [playlist.id]);
    await insertPlaylistTracksBatch(db, playlist.id, trackRows.map((t) => t.id), 0);
    await db.execute("UPDATE playlists SET track_count = ? WHERE id = ?", [trackRows.length, playlist.id]);
    await queryClient.invalidateQueries({ queryKey: QK.playlists() });
    await queryClient.invalidateQueries({ queryKey: QK.playlistTracks(playlist.id) });
  }

  async function updateSmartPlaylistRules(playlist: PlaylistRow, filters: SmartFilters, swc: ServerWithCredential): Promise<void> {
    const db = await getDb();
    await db.execute("UPDATE playlists SET name = ?, rules_json = ? WHERE id = ?", [filters.name, JSON.stringify(filters), playlist.id]);
    const { server, credential } = swc;
    const nativePlaylistId = stripServerPrefix(playlist.id, server.id);
    await updateNavidromePlaylist(server.url, server.username, credential, nativePlaylistId, filters.name, undefined, server.alt_url ?? undefined);
    await queryClient.invalidateQueries({ queryKey: QK.playlists() });
    await refreshSmartPlaylist({ ...playlist, name: filters.name, rules_json: JSON.stringify(filters) }, swc);
  }

  return { ...query, createPlaylist, deletePlaylist, addTrackToPlaylist, renamePlaylist, addAlbumToPlaylist, setCustomCover, createSmartPlaylist, refreshSmartPlaylist, updateSmartPlaylistRules };
}
