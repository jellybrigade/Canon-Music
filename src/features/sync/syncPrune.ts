import Database from "@tauri-apps/plugin-sql";
import { executeIdChunks, SQLITE_MAX_VARIABLES } from "../../lib/dbBatch";
import { prunedTrackIdTables, purgedTrackIdTables } from "../../db/trackIdTables";

// A track the server no longer has leaves rows behind that still show up in the
// grid, in search and in radio candidates, and 404 when played. Which tables
// those are, and why the user's own rows are spared, is db/trackIdTables.ts.
//
// Album-keyed album_identity and album_user_genres are left alone for the same
// reason the user's track rows are: they are user-authored or user-corrected and
// cost nothing to keep if the album comes back.
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

// Drop albums the server no longer lists, along with their tracks and every
// derived row keyed off either. Dependent rows go first so the subselects can
// still find the tracks they are keyed to.
//
// album_covers goes because it is a pure cache holding a base64 data_url, so a
// stranded row is tens to hundreds of KB no read path can reach. album_identity,
// album_user_genres and album_genre_exclusions stay for the reason given above
// deleteTracksByIds: they are user-authored or user-corrected, and the album ids
// survive a re-add of the same server. The track-keyed tables come from
// db/trackIdTables.ts.
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

// Drop every local row belonging to a server being removed. Without this the
// `servers` row goes and the mirrored library stays: the album grid does not
// filter by server_id (see `library_read/albums.rs`), so the old albums keep rendering
// and 404 when played, because stream URLs are built from whatever server is
// selected now against the removed server's track ids.
//
// Deletes run through subselects on server_id rather than collected id lists, so
// there is no chunking involved and none of the `NOT IN` hazard that forces
// `pruneAlbumTracks` below to bail out rather than split. Dependents go first so
// the subselects can still resolve the rows they are keyed to.
//
// Purged here but deliberately kept by the sync prune above: the user's own
// track-keyed rows (db/trackIdTables.ts names them - queued plays can never be
// delivered once the server is gone, and the history is dedupe state keyed to
// track ids that no longer exist), album_identity and album_user_genres (a
// re-added server mints a fresh UUID, so every id is rewritten and these rows
// could never be matched again anyway).
//
// Deliberately NOT purged: artist_identity, artist_covers, artist_aliases,
// radio_signal_cache, tag_mappings, user_tree_nodes. Those are keyed by artist
// name or are global user data, so they stay correct across servers.
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

// Rows whose server is gone are unreachable, not merely stale: every read is scoped by
// server_id and every prune subselects the server's own albums, so nothing left over from a
// purge that did not finish - or from a `servers` row lost any other way - can ever be
// deleted, searched or played again. Run once at startup, since a stranded server by
// definition never triggers a sync of its own.
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

// Drop tracks the album no longer contains. Without this a track deleted on the
// server keeps its row, the stored track count stays permanently above the
// album's songCount, and the sync's skipTracks check can never match again - so
// the album is re-fetched on every sync forever, dragging the FTS rebuild and
// the tag scans along with it.
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
