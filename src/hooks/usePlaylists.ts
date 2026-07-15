import { useEffect, useState } from "react";
import type Database from "@tauri-apps/plugin-sql";
import { getDb } from "../db";
import type { ServerWithCredential } from "./useServer";
import { usePlaylistSessionStore } from "../store/playlistSessionStore";
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
import { executeBatched } from "../lib/db-batch";

async function insertPlaylistTracksBatch(
  db: Database,
  playlistId: string,
  trackIds: string[],
  startPos: number
): Promise<void> {
  if (trackIds.length === 0) return;
  const rows = trackIds.map((trackId, i) => [playlistId, trackId, startPos + i]);
  await executeBatched(
    db,
    rows,
    "(?, ?, ?)",
    3,
    (placeholders) => `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES ${placeholders}`
  );
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
  const refreshTick = usePlaylistSessionStore((s) => s.playlistsTick);
  const [data, setData] = useState<PlaylistRow[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      const db = await getDb();
      const rows = await db.select<PlaylistRow[]>(
        "SELECT id, server_id, name, comment, track_count, cover_art_url, custom_cover_data, is_smart, rules_json FROM playlists ORDER BY name ASC",
        []
      );
      if (!cancelled) {
        setData(rows);
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  async function createPlaylist(name: string, swc: ServerWithCredential): Promise<void> {
    const { server, credential } = swc;
    const created = await createNavidromePlaylist(server.url, server.username, credential, name, server.alt_url ?? undefined);
    const db = await getDb();
    const plDbId = `${server.id}:${created.id}`;
    await db.execute(
      "INSERT OR REPLACE INTO playlists (id, server_id, name, comment, track_count) VALUES (?, ?, ?, ?, ?)",
      [plDbId, server.id, created.name, created.comment ?? null, created.songCount]
    );
    usePlaylistSessionStore.getState().bumpPlaylists();
  }

  async function deletePlaylist(playlist: PlaylistRow, swc: ServerWithCredential): Promise<void> {
    const { server, credential } = swc;
    const nativeId = stripServerPrefix(playlist.id, server.id);
    await deleteNavidromePlaylist(server.url, server.username, credential, nativeId, server.alt_url ?? undefined);
    const db = await getDb();
    await db.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", [playlist.id]);
    await db.execute("DELETE FROM playlists WHERE id = ?", [playlist.id]);
    usePlaylistSessionStore.getState().bumpPlaylists();
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
    usePlaylistSessionStore.getState().bumpPlaylists();
    usePlaylistSessionStore.getState().bumpPlaylistTracks();
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
    usePlaylistSessionStore.getState().bumpPlaylists();
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
    usePlaylistSessionStore.getState().bumpPlaylists();
    usePlaylistSessionStore.getState().bumpPlaylistTracks();
  }

  async function setCustomCover(playlistId: string, dataUri: string | null): Promise<void> {
    const db = await getDb();
    await db.execute("UPDATE playlists SET custom_cover_data = ? WHERE id = ?", [dataUri, playlistId]);
    usePlaylistSessionStore.getState().bumpPlaylists();
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
    usePlaylistSessionStore.getState().bumpPlaylists();
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
    usePlaylistSessionStore.getState().bumpPlaylists();
    usePlaylistSessionStore.getState().bumpPlaylistTracks();
  }

  async function updateSmartPlaylistRules(playlist: PlaylistRow, filters: SmartFilters, swc: ServerWithCredential): Promise<void> {
    const db = await getDb();
    await db.execute("UPDATE playlists SET name = ?, rules_json = ? WHERE id = ?", [filters.name, JSON.stringify(filters), playlist.id]);
    const { server, credential } = swc;
    const nativePlaylistId = stripServerPrefix(playlist.id, server.id);
    await updateNavidromePlaylist(server.url, server.username, credential, nativePlaylistId, filters.name, undefined, server.alt_url ?? undefined);
    usePlaylistSessionStore.getState().bumpPlaylists();
    await refreshSmartPlaylist({ ...playlist, name: filters.name, rules_json: JSON.stringify(filters) }, swc);
  }

  return { data, isLoading, createPlaylist, deletePlaylist, addTrackToPlaylist, renamePlaylist, addAlbumToPlaylist, setCustomCover, createSmartPlaylist, refreshSmartPlaylist, updateSmartPlaylistRules };
}
