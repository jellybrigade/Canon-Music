import Database from "@tauri-apps/plugin-sql";
import { executeIdChunks, SQLITE_MAX_VARIABLES } from "../../lib/dbBatch";
import { prunedTrackIdTables, purgedTrackIdTables } from "../../db/trackIdTables";

// Which tables carry track-keyed rows, and why the user's own rows are spared, is
// db/trackIdTables.ts. album_identity/album_user_genres are spared for the same reason.
async function deleteTracksByIds(db: Database, trackIds: readonly string[]): Promise<void> {
  if (trackIds.length === 0) return;
  const statements = [
    ...prunedTrackIdTables().map(
      ({ table, column }) =>
        (ph: string) =>
          `DELETE FROM ${table} WHERE ${column} IN (${ph})`
    ),
    (ph: string) => `DELETE FROM tracks WHERE id IN (${ph})`,
  ];
  for (const build of statements) {
    await executeIdChunks(db, trackIds, build);
  }
}

// Drop albums the server no longer lists, plus their tracks and derived rows, dependants
// first. album_covers goes (pure cache); user-authored album rows stay.
export async function pruneAlbums(db: Database, albumIds: readonly string[]): Promise<void> {
  if (albumIds.length === 0) return;
  const viaTracks = ({ table, column }: { table: string; column: string }) => (ph: string) =>
    `DELETE FROM ${table} WHERE ${column} IN (SELECT id FROM tracks WHERE album_id IN (${ph}))`;
  const statements = [
    ...prunedTrackIdTables().map(viaTracks),
    (ph: string) => `DELETE FROM tracks WHERE album_id IN (${ph})`,
    (ph: string) => `DELETE FROM loved_albums WHERE album_id IN (${ph})`,
    (ph: string) => `DELETE FROM album_genres WHERE album_id IN (${ph})`,
    (ph: string) => `DELETE FROM album_unresolved_genres WHERE album_id IN (${ph})`,
    (ph: string) => `DELETE FROM album_covers WHERE album_id IN (${ph})`,
    (ph: string) => `DELETE FROM albums WHERE id IN (${ph})`,
  ];
  for (const build of statements) {
    await executeIdChunks(db, albumIds, build);
  }
}

// Subselects on server_id, dependents first. Global/artist-name-keyed user tables
// (artist_identity/covers/aliases, radio_signal_cache, tag_mappings, user_tree_nodes) are spared.
export async function purgeServerData(db: Database, serverId: string): Promise<void> {
  const viaTracks = ({ table, column }: { table: string; column: string }) =>
    `DELETE FROM ${table} WHERE ${column} IN (SELECT id FROM tracks WHERE server_id = ?)`;
  const viaAlbums = (table: string, column: string) =>
    `DELETE FROM ${table} WHERE ${column} IN (SELECT id FROM albums WHERE server_id = ?)`;
  const statements = [
    ...purgedTrackIdTables().map(viaTracks),
    "DELETE FROM tracks WHERE server_id = ?",
    viaAlbums("loved_albums", "album_id"),
    viaAlbums("album_genres", "album_id"),
    viaAlbums("album_unresolved_genres", "album_id"),
    viaAlbums("album_genre_exclusions", "album_id"),
    viaAlbums("album_user_genres", "album_id"),
    viaAlbums("album_identity", "album_id"),
    viaAlbums("album_covers", "album_id"),
    "DELETE FROM albums WHERE server_id = ?",
    "DELETE FROM playlist_resume WHERE playlist_id IN (SELECT id FROM playlists WHERE server_id = ?)",
    "DELETE FROM playlist_tracks WHERE playlist_id IN (SELECT id FROM playlists WHERE server_id = ?)",
    "DELETE FROM playlists WHERE server_id = ?",
    "DELETE FROM artists WHERE server_id = ?",
  ];
  for (const sql of statements) {
    await db.execute(sql, [serverId]);
  }
  await db.execute("DELETE FROM settings WHERE key = ?", [
    `server.opensub_extensions.${serverId}`,
  ]);
}

// Every read is scoped by server_id, so rows left by an unfinished purge or a `servers` row
// lost another way are unreachable, not merely stale. Run once at startup; a stranded server never syncs itself.
export async function purgeStrandedServers(db: Database): Promise<string[]> {
  const rows = await db.select<{ server_id: string }[]>(
    `SELECT server_id FROM albums
     UNION SELECT server_id FROM tracks
     UNION SELECT server_id FROM artists
     UNION SELECT server_id FROM playlists`
    + ` EXCEPT SELECT id FROM servers`,
    []
  );
  const stranded = rows.map((r) => r.server_id).filter((id): id is string => id !== null);
  for (const serverId of stranded) {
    console.warn(`sync: purging rows left behind by removed server ${serverId}`);
    await purgeServerData(db, serverId);
  }
  return stranded;
}

// Without this a deleted track's row lingers, the stored count stays above songCount, and
// skipTracks can never match again - re-fetching the album (and its FTS/tag work) forever.
export async function pruneAlbumTracks(
  db: Database,
  albumDbId: string,
  keepTrackIds: readonly string[],
): Promise<number> {
  // An album that returned no tracks is far more likely a server hiccup than a
  // genuinely empty album, and `NOT IN ()` cannot be expressed anyway.
  if (keepTrackIds.length === 0) return 0;
  // A NOT IN cannot be chunked without each chunk deleting what the others keep.
  // Real album track lists are orders of magnitude below the ceiling; if one
  // somehow is not, skip the prune rather than corrupt the table.
  if (keepTrackIds.length >= SQLITE_MAX_VARIABLES - 1) return 0;
  const placeholders = keepTrackIds.map(() => "?").join(", ");
  const stale = await db.select<{ id: string }[]>(
    `SELECT id FROM tracks WHERE album_id = ? AND id NOT IN (${placeholders})`,
    [albumDbId, ...keepTrackIds]
  );
  if (stale.length === 0) return 0;
  await deleteTracksByIds(db, stale.map((r) => r.id));
  return stale.length;
}
