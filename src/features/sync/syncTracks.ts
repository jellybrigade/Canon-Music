import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../../db";
import type { Server } from "../../types/server";
import { fetchAlbumTracks } from "../../clients/navidrome";
import type { NavidromeTrack } from "../../clients/navidrome";
import type { NavidromeCredential } from "../../clients/navidromeUrls";
import { executeBatched, executeIdChunks } from "../../lib/dbBatch";
import { planTrackIdRemap } from "./trackRemap";
import type { TrackIdRemap } from "./trackRemap";
import { pruneAlbumTracks } from "./syncPrune";

// Which of an album's mirrored tracks the server merely renamed. Read before the
// upsert writes the new rows: once it has, the old and new ids both exist locally and
// nothing can tell a rename from a genuine add.
/**
 * Bring the FTS mirror back in line with `tracks` for the albums that moved.
 *
 * One writer, because the delete has two halves and a caller doing only the obvious one
 * leaves rows nothing can ever reach again: a renamed track keeps its row (the remap
 * rewrites `tracks.id` rather than deleting it), so the prune never sees the old id and
 * the album subselect below only finds the new one. An orphan is not merely stale - the
 * search ranks and caps its pool before joining `tracks`, so orphans take slots from real
 * matches and return nothing.
 */
export async function rebuildTracksFts(
  db: Database,
  albumDbIds: readonly string[],
  staleTrackIds: readonly string[],
): Promise<void> {
  if (staleTrackIds.length > 0) {
    await executeIdChunks(db, [...staleTrackIds], (ph) => `DELETE FROM tracks_fts WHERE id IN (${ph})`);
  }
  if (albumDbIds.length === 0) return;
  const albumIds = [...albumDbIds];
  await executeIdChunks(
    db,
    albumIds,
    (ph) => `DELETE FROM tracks_fts WHERE id IN (SELECT id FROM tracks WHERE album_id IN (${ph}))`
  );
  await executeIdChunks(
    db,
    albumIds,
    (ph) => `INSERT INTO tracks_fts (id, title, artist, album, genre)
       SELECT t.id, t.title, COALESCE(t.artist, ''), a.name, COALESCE(t.genre, '')
       FROM tracks t JOIN albums a ON t.album_id = a.id
       WHERE t.album_id IN (${ph})`
  );
}

export async function planRenamedTracks(
  db: Database,
  serverId: string,
  albumDbId: string,
  tracks: readonly NavidromeTrack[],
): Promise<TrackIdRemap[]> {
  const existing = await db.select<{ id: string; file_path: string | null }[]>(
    "SELECT id, file_path FROM tracks WHERE album_id = ? AND server_id = ?",
    [albumDbId, serverId]
  );
  return planTrackIdRemap(
    existing,
    tracks.map((track) => ({ id: `${serverId}:${track.id}`, path: track.path ?? null }))
  );
}

// Move the local-only rows onto the new ids, before the prune deletes everything still
// under the old ones. One `invoke` per album that has renamed tracks, none otherwise.
export async function carryRenamedTracks(albumDbId: string, remaps: readonly TrackIdRemap[]): Promise<number> {
  if (remaps.length === 0) return 0;
  // Non-fatal: a failed carry costs the local-only rows of these tracks, which the prune
  // was going to take anyway. Failing the whole sync over it would cost the library.
  return await invoke<number>("remap_track_ids", { remaps }).catch((err: unknown) => {
    console.error(`sync: failed to carry renamed tracks for album ${albumDbId}:`, err);
    return 0;
  });
}

export async function insertTracksBatch(
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
    // Named-column upsert, not INSERT OR REPLACE: a replace deletes the row and
    // reinserts it, so every column this statement does not list falls back to its
    // default. `tags_enriched_at` is one of them, and clearing it makes the next
    // enrichment pass re-fetch the whole album from Last.fm for nothing.
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
         replay_gain_album_peak = excluded.replay_gain_album_peak`
  );

  const genreRows = tracks.filter((t) => t.genre).map((t) => [`${serverId}:${t.id}`, t.genre]);
  await executeBatched(
    db,
    genreRows,
    "(?, 'genre', ?, 'server')",
    2,
    (placeholders) => `INSERT OR IGNORE INTO track_tags (track_id, kind, raw_value, source) VALUES ${placeholders}`
  );
}

/**
 * Re-resolve one album's tracks against the server, carrying the local-only rows of any track
 * whose id was rewritten and dropping the ones it really lost. Returns the pairs it carried.
 *
 * The play-time answer to Subsonic error 70: the server does not know the id Canon just asked
 * for, which after an id migration is true of most of the library at once. Repairing the one
 * album the user is trying to play beats a full 1500-request resync they did not ask for.
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
    server.alt_url ?? undefined
  );
  // Same reasoning as pruneAlbumTracks: an album that returned nothing is a server hiccup far
  // more often than an emptied album, and acting on it would delete the rows being repaired.
  if (tracks.length === 0) return [];
  const db = await getDb();
  const remaps = await planRenamedTracks(db, server.id, dbAlbumId, tracks);
  await carryRenamedTracks(dbAlbumId, remaps);
  await insertTracksBatch(db, server.id, server.type, dbAlbumId, tracks);
  await pruneAlbumTracks(db, dbAlbumId, tracks.map((track) => `${server.id}:${track.id}`));
  await rebuildTracksFts(db, [dbAlbumId], remaps.map((remap) => remap.oldId));
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
  await insertTracksBatch(db, server.id, server.type, dbAlbumId, tracks);
  await rebuildTracksFts(db, [dbAlbumId], []);
}
