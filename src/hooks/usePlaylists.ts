import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { buildSmartQuery, parseSmartFilters, type SmartFilters } from "../lib/smartPlaylist";
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

// Load path reads via rusqlite (src-tauri/src/library_read.rs, psysonic pattern) and
// caches rows on the session store keyed by tick, so the several components mounting
// this hook share one fetch. Mutations below stay on tauri-plugin-sql - writes and
// migrations are not part of the read split.
export function usePlaylists() {
  const refreshTick = usePlaylistSessionStore((s) => s.playlistsTick);
  const [data, setData] = useState<PlaylistRow[] | undefined>(() => {
    const s = usePlaylistSessionStore.getState();
    return s.rows && s.cachedTick === s.playlistsTick ? (s.rows as PlaylistRow[]) : undefined;
  });
  const [isLoading, setIsLoading] = useState(() => data === undefined);

  useEffect(() => {
    const s = usePlaylistSessionStore.getState();
    if (s.rows && s.cachedTick === refreshTick) {
      setData(s.rows as PlaylistRow[]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        // Wait for tauri-plugin-sql's migrations before reading via rusqlite - both
        // engines share canon.db and this read path has no schema awareness of its own.
        await getDb();
        const rows = await invoke<PlaylistRow[]>("get_playlists");
        if (!cancelled) {
          usePlaylistSessionStore.getState().setRows(rows, refreshTick);
          setData(rows);
          setIsLoading(false);
        }
      } catch (err) {
        console.error("usePlaylists: failed to load playlists", err);
        if (!cancelled) setIsLoading(false);
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
    if (!playlist.is_smart) return;
    const filters = parseSmartFilters(playlist.rules_json);
    if (!filters) {
      throw new Error("This smart playlist's saved rules could not be read");
    }
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
    const { server, credential } = swc;
    const nativePlaylistId = stripServerPrefix(playlist.id, server.id);
    // Remote first, local second, matching renamePlaylist: a rejected rename used to
    // leave the local row already carrying a name and rules the server never accepted.
    await updateNavidromePlaylist(server.url, server.username, credential, nativePlaylistId, filters.name, undefined, server.alt_url ?? undefined);
    await db.execute("UPDATE playlists SET name = ?, rules_json = ? WHERE id = ?", [filters.name, JSON.stringify(filters), playlist.id]);
    usePlaylistSessionStore.getState().bumpPlaylists();
    await refreshSmartPlaylist({ ...playlist, name: filters.name, rules_json: JSON.stringify(filters) }, swc);
  }

  return { data, isLoading, createPlaylist, deletePlaylist, addTrackToPlaylist, renamePlaylist, addAlbumToPlaylist, setCustomCover, createSmartPlaylist, refreshSmartPlaylist, updateSmartPlaylistRules };
}
