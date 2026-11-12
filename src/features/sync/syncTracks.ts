import { invoke } from "@tauri-apps/api/core";
import type Database from "@tauri-apps/plugin-sql";
import type { NavidromeTrack } from "../../clients/navidrome";
import { fetchAlbumTracks } from "../../clients/navidrome";
import type { NavidromeCredential } from "../../clients/navidromeUrls";
import { getDb } from "../../db";
import { executeBatched, executeIdChunks } from "../../lib/dbBatch";
import type { Server } from "../../types/server";
import { pruneAlbumTracks } from "./syncPrune";
import { publishTrackIdRemaps } from "./trackIdRemapEvents";
import type { TrackIdRemap } from "./trackRemap";
import { planTrackIdRemap } from "./trackRemap";

/** Deletes the search rows of the given albums' tracks, found by track row. */
export function ftsDeleteForAlbumsSql(albumPlaceholders: string): string {
  return `DELETE FROM tracks_fts WHERE rowid IN (SELECT rowid FROM tracks WHERE album_id IN (${albumPlaceholders}))`;
}

/**
 * Rebuild FTS rows for the moved albums. Each row sits at its track's rowid, which a remapped
 * track keeps, so the album's delete also reaches the row still naming the old id.
 */
export async function rebuildTracksFts(db: Database, albumDbIds: readonly string[]): Promise<void> {
  if (albumDbIds.length === 0) return;
  const albumIds = [...albumDbIds];
  await executeIdChunks(db, albumIds, ftsDeleteForAlbumsSql);
  await executeIdChunks(
    db,
    albumIds,
    (ph) => `INSERT INTO tracks_fts (rowid, id, title, artist, album, genre)
       SELECT t.rowid, t.id, t.title, COALESCE(t.artist, ''), a.name, COALESCE(t.genre, '')
       FROM tracks t JOIN albums a ON t.album_id = a.id
       WHERE t.album_id IN (${ph})`,
  );
}

// Counts only tracks the rebuild can index (it joins albums), or one orphan rescans every sync.
export const HEAL_FTS_COUNTS_SQL = `
  SELECT (SELECT COUNT(*) FROM tracks t JOIN albums a ON a.id = t.album_id WHERE t.server_id = ?) AS stored,
         (SELECT COUNT(*) FROM tracks t JOIN albums a ON a.id = t.album_id
          WHERE t.server_id = ? AND EXISTS (SELECT 1 FROM tracks_fts f WHERE f.rowid = t.rowid AND f.id = t.id)) AS indexed`;

export const UNINDEXED_ALBUMS_SQL = `
  SELECT DISTINCT t.album_id FROM tracks t JOIN albums a ON a.id = t.album_id
  WHERE t.server_id = ? AND NOT EXISTS (SELECT 1 FROM tracks_fts f WHERE f.rowid = t.rowid AND f.id = t.id)
  ORDER BY t.album_id`;

/**
 * Index tracks a sync stored but never reached the rebuild for (the app quit mid-pass), which
 * the skip heuristic would otherwise pass over for good. Only a count mismatch pays for the lookup.
 */
export async function healTracksFts(db: Database, serverId: string): Promise<void> {
  const [counts] = await db.select<{ stored: number; indexed: number }[]>(HEAL_FTS_COUNTS_SQL, [serverId, serverId]);
  if (counts === undefined || counts.stored === counts.indexed) return;
  const unindexed = await db.select<{ album_id: string }[]>(UNINDEXED_ALBUMS_SQL, [serverId]);
  await rebuildTracksFts(
    db,
    unindexed.map((row) => row.album_id),
  );
}

// Must run before the upsert; afterwards a rename is indistinguishable from an add.
async function planRenamedTracks(
  db: Database,
  serverId: string,
  albumDbId: string,
  tracks: readonly NavidromeTrack[],
): Promise<TrackIdRemap[]> {
  const existing = await db.select<{ id: string; file_path: string | null }[]>(
    "SELECT id, file_path FROM tracks WHERE album_id = ? AND server_id = ?",
    [albumDbId, serverId],
  );
  return planTrackIdRemap(
    existing,
    tracks.map((track) => ({ id: `${serverId}:${track.id}`, path: track.path ?? null })),
  );
}

// Move the local-only rows onto the new ids, before the prune deletes everything still
// under the old ones. One `invoke` per album that has renamed tracks, none otherwise.
async function carryRenamedTracks(albumDbId: string, remaps: readonly TrackIdRemap[]): Promise<number> {
  if (remaps.length === 0) return 0;
  // Non-fatal: a failed carry costs the local-only rows of these tracks, which the prune
  // was going to take anyway. Failing the whole sync over it would cost the library.
  return await invoke<number>("remap_track_ids", { remaps }).catch((err: unknown) => {
    console.error(`sync: failed to carry renamed tracks for album ${albumDbId}:`, err);
    return 0;
  });
}

interface AlbumTracksWrite {
  server: Server;
  albumDbId: string;
  tracks: NavidromeTrack[];
  /** False skips the rename lookup for an album with nothing stored yet. */
  hasStoredTracks?: boolean;
}

/** Every write of a fetched album's tracks: a rename is planned before the upsert and announced after it. */
export async function writeAlbumTracks(
  db: Database,
  { server, albumDbId, tracks, hasStoredTracks = true }: AlbumTracksWrite,
): Promise<{ remaps: TrackIdRemap[]; carried: number }> {
  const remaps = hasStoredTracks ? await planRenamedTracks(db, server.id, albumDbId, tracks) : [];
  const carried = await carryRenamedTracks(albumDbId, remaps);
  await insertTracksBatch(db, server.id, server.type, albumDbId, tracks);
  publishTrackIdRemaps(remaps);
  return { remaps, carried };
}

async function insertTracksBatch(
  db: Database,
  serverId: string,
  serverType: string,
  albumDbId: string,
  tracks: NavidromeTrack[],
): Promise<void> {
  const trackRows = tracks.map((track) => [
    `${serverId}:${track.id}`,
    serverId,
    serverType,
    track.title,
    track.artist ?? null,
    albumDbId,
    track.genre ?? null,
    track.track ?? null,
    track.discNumber ?? null,
    track.year ?? null,
    track.duration ?? null,
    track.path ?? null,
    track.playCount ?? 0,
    track.played ?? null,
    track.bitRate ?? null,
    track.suffix ?? null,
    track.size ?? null,
    track.replayGain?.trackGain ?? null,
    track.replayGain?.trackPeak ?? null,
    track.replayGain?.albumGain ?? null,
    track.replayGain?.albumPeak ?? null,
  ]);
  await executeBatched(
    db,
    trackRows,
    "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    21,
    // Named-column upsert, not INSERT OR REPLACE: a replace resets unlisted columns to
    // default, clearing `tags_enriched_at` and forcing a wasted re-fetch from Last.fm.
    (placeholders) => `INSERT INTO tracks
         (id, server_id, server_type, title, artist, album_id, genre, track_number, disc_number, year, duration, file_path, play_count, played_at, bit_rate, suffix, file_size, replay_gain_track_gain, replay_gain_track_peak, replay_gain_album_gain, replay_gain_album_peak)
       VALUES ${placeholders}
       ON CONFLICT(id) DO UPDATE SET
         server_id = excluded.server_id,
         server_type = excluded.server_type,
         title = excluded.title,
         artist = excluded.artist,
         album_id = excluded.album_id,
         genre = excluded.genre,
         track_number = excluded.track_number,
         disc_number = excluded.disc_number,
         year = excluded.year,
         duration = excluded.duration,
         file_path = excluded.file_path,
         play_count = excluded.play_count,
         played_at = excluded.played_at,
         bit_rate = excluded.bit_rate,
         suffix = excluded.suffix,
         file_size = excluded.file_size,
         replay_gain_track_gain = excluded.replay_gain_track_gain,
         replay_gain_track_peak = excluded.replay_gain_track_peak,
         replay_gain_album_gain = excluded.replay_gain_album_gain,
         replay_gain_album_peak = excluded.replay_gain_album_peak`,
  );

  const genreRows = tracks.filter((t) => t.genre).map((t) => [`${serverId}:${t.id}`, t.genre]);
  await executeBatched(
    db,
    genreRows,
    "(?, 'genre', ?, 'server')",
    2,
    (placeholders) => `INSERT OR IGNORE INTO track_tags (track_id, kind, raw_value, source) VALUES ${placeholders}`,
  );
}

/**
 * Re-resolve one album's tracks, carrying rows for rewritten ids and dropping lost ones.
 * Returns the carried pairs. The play-time answer to Subsonic 70.
 */
export async function repairAlbumTrackIds(
  server: Server,
  credential: NavidromeCredential,
  dbAlbumId: string,
): Promise<TrackIdRemap[]> {
  const navidromeAlbumId = dbAlbumId.slice(server.id.length + 1);
  const tracks = await fetchAlbumTracks(
    server.url,
    server.username,
    credential,
    navidromeAlbumId,
    server.alt_url ?? undefined,
  );
  // Same reasoning as pruneAlbumTracks: an album that returned nothing is a server hiccup far
  // more often than an emptied album, and acting on it would delete the rows being repaired.
  if (tracks.length === 0) return [];
  const db = await getDb();
  const { remaps } = await writeAlbumTracks(db, { server, albumDbId: dbAlbumId, tracks });
  await pruneAlbumTracks(
    db,
    dbAlbumId,
    tracks.map((track) => `${server.id}:${track.id}`),
  );
  await rebuildTracksFts(db, [dbAlbumId]);
  return remaps;
}

export async function syncAlbumTracks(
  server: Server,
  credential: NavidromeCredential,
  dbAlbumId: string,
): Promise<void> {
  const navidromeAlbumId = dbAlbumId.slice(server.id.length + 1);
  const altUrl = server.alt_url ?? undefined;
  const tracks = await fetchAlbumTracks(server.url, server.username, credential, navidromeAlbumId, altUrl);
  const db = await getDb();
  // Without the carry, a renamed track upserts beside its old row and the album lists it twice.
  await writeAlbumTracks(db, { server, albumDbId: dbAlbumId, tracks });
  await rebuildTracksFts(db, [dbAlbumId]);
}
