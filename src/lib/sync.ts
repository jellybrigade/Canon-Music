import Database from "@tauri-apps/plugin-sql";
import { getDb } from "../db";
import { keychain } from "../keychain";
import type { Server } from "../types/server";
import { fetchAllAlbums, fetchAlbumTracks, fetchStarred2, fetchPlaylists, fetchPlaylistTracks, fetchAndStoreOpenSubsonicExtensions } from "./navidrome";
import type { NavidromeCredential, NavidromeTrack } from "./navidrome";
import { scanForIssues } from "./tagIssues";
import { rebuildTagVocabCache } from "./tag-normalize";

const BATCH_NOTIFY_INTERVAL = 25;

// tauri-plugin-sql's SQLite pool has more than one connection, so a raw
// BEGIN/COMMIT split across two separate execute() calls can land on
// different connections and silently fail to wrap anything. Batch writes
// into fewer, larger multi-row statements instead of relying on transactions.
const INSERT_CHUNK_SIZE = 200;

async function insertTracksBatch(
  db: Database,
  serverId: string,
  serverType: string,
  albumDbId: string,
  tracks: NavidromeTrack[],
): Promise<void> {
  for (let start = 0; start < tracks.length; start += INSERT_CHUNK_SIZE) {
    const chunk = tracks.slice(start, start + INSERT_CHUNK_SIZE);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const params: unknown[] = [];
    for (const track of chunk) {
      params.push(
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
        track.bitRate ?? null,
        track.suffix ?? null,
        track.size ?? null,
        track.replayGain?.trackGain ?? null,
        track.replayGain?.trackPeak ?? null,
        track.replayGain?.albumGain ?? null,
        track.replayGain?.albumPeak ?? null,
      );
    }
    await db.execute(
      `INSERT OR REPLACE INTO tracks
         (id, server_id, server_type, title, artist, album_id, genre, track_number, disc_number, year, duration, file_path, play_count, bit_rate, suffix, file_size, replay_gain_track_gain, replay_gain_track_peak, replay_gain_album_gain, replay_gain_album_peak)
       VALUES ${placeholders}`,
      params
    );
  }

  const genreRows = tracks.filter((t) => t.genre);
  for (let start = 0; start < genreRows.length; start += INSERT_CHUNK_SIZE) {
    const chunk = genreRows.slice(start, start + INSERT_CHUNK_SIZE);
    const placeholders = chunk.map(() => "(?, 'genre', ?, 'server')").join(", ");
    const params: unknown[] = [];
    for (const track of chunk) params.push(`${serverId}:${track.id}`, track.genre);
    await db.execute(
      `INSERT OR IGNORE INTO track_tags (track_id, kind, raw_value, source) VALUES ${placeholders}`,
      params
    );
  }
}

async function insertIdColumnBatch(db: Database, table: string, column: string, ids: string[]): Promise<void> {
  for (let start = 0; start < ids.length; start += INSERT_CHUNK_SIZE) {
    const chunk = ids.slice(start, start + INSERT_CHUNK_SIZE);
    const placeholders = chunk.map(() => "(?)").join(", ");
    await db.execute(`INSERT OR IGNORE INTO ${table} (${column}) VALUES ${placeholders}`, chunk);
  }
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
}

export async function syncLibrary(
  server: Server,
  onAlbumBatch?: () => void,
): Promise<{ failedAlbums: number; failedPlaylists: number; skippedAlbums: number }> {
  const credJson = await keychain.get(`canon.server.${server.id}`, "credential");
  if (!credJson) throw new Error(`No credentials found for server ${server.id}`);
  let credential: NavidromeCredential;
  try {
    const parsed = JSON.parse(credJson) as Record<string, unknown>;
    // Migrate legacy credentials stored without a type field
    if (!parsed.type && typeof parsed.token === "string" && typeof parsed.salt === "string") {
      credential = { type: "md5", token: parsed.token, salt: parsed.salt };
    } else {
      credential = parsed as NavidromeCredential;
    }
  } catch {
    throw new Error(`Corrupt credentials for server ${server.id}. Re-enter in Settings.`);
  }

  const altUrl = server.alt_url ?? undefined;
  void fetchAndStoreOpenSubsonicExtensions(server.url, server.username, credential, server.id, altUrl);

  const albums = await fetchAllAlbums(server.url, server.username, credential, altUrl);

  const db = await getDb();
  let failedAlbums = 0;
  let skippedAlbums = 0;
  let processedCount = 0;

  // Incremental sync: bulk-prefetch existing album state once instead of a
  // per-album SELECT round trip, so the skip-tracks decision is pure JS.
  type ExistingAlbumRow = { id: string; navidrome_created: string | null };
  const existingAlbumRows = await db.select<ExistingAlbumRow[]>(
    "SELECT id, navidrome_created FROM albums WHERE server_id = ?",
    [server.id]
  );
  const existingCreatedById = new Map(existingAlbumRows.map((r) => [r.id, r.navidrome_created]));

  type TrackCountRow = { album_id: string; c: number };
  const trackCountRows = await db.select<TrackCountRow[]>(
    "SELECT album_id, COUNT(*) AS c FROM tracks WHERE server_id = ? GROUP BY album_id",
    [server.id]
  );
  const trackCountByAlbumId = new Map(trackCountRows.map((r) => [r.album_id, r.c]));

  const albumUpsertParams: unknown[][] = [];
  const albumsNeedingTracks: { album: typeof albums[number]; albumDbId: string }[] = [];

  for (const album of albums) {
    const albumDbId = `${server.id}:${album.id}`;
    const existingCreated = existingCreatedById.get(albumDbId) ?? null;
    const existingTrackCount = trackCountByAlbumId.get(albumDbId) ?? 0;
    const skipTracks =
      existingCreatedById.has(albumDbId) &&
      existingCreated !== null &&
      existingCreated === (album.created ?? null) &&
      (album.songCount === undefined || existingTrackCount === album.songCount);

    const releaseType = album.releaseTypes?.[0] ?? album.releaseType ?? null;
    albumUpsertParams.push([
      albumDbId, server.id, server.type, album.name, album.artist, album.year ?? null,
      album.coverArt ?? null, album.created ?? null, album.playCount ?? 0, releaseType,
    ]);

    if (skipTracks) {
      skippedAlbums++;
    } else {
      albumsNeedingTracks.push({ album, albumDbId });
    }
  }

  // Upsert album rows in batches, preserving computed_at/normalized_tags_json
  // so the background normalizer doesn't re-run on every sync.
  for (let start = 0; start < albumUpsertParams.length; start += INSERT_CHUNK_SIZE) {
    const chunk = albumUpsertParams.slice(start, start + INSERT_CHUNK_SIZE);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    await db.execute(
      `INSERT INTO albums (id, server_id, server_type, name, artist, year, artwork_url, navidrome_created, play_count, release_type)
       VALUES ${placeholders}
       ON CONFLICT(id) DO UPDATE SET
         server_id = excluded.server_id,
         server_type = excluded.server_type,
         name = excluded.name,
         artist = excluded.artist,
         year = excluded.year,
         artwork_url = excluded.artwork_url,
         navidrome_created = excluded.navidrome_created,
         play_count = excluded.play_count,
         release_type = excluded.release_type`,
      chunk.flat()
    );
  }

  processedCount = albumUpsertParams.length;
  if (onAlbumBatch && processedCount > 0) onAlbumBatch();

  let fetchedCount = 0;
  for (const { album, albumDbId } of albumsNeedingTracks) {
    let tracks;
    try {
      tracks = await fetchAlbumTracks(server.url, server.username, credential, album.id, altUrl);
    } catch (err) {
      console.error(`sync: failed to fetch tracks for album "${album.name}" (${album.id}):`, err);
      failedAlbums++;
      continue;
    }
    await insertTracksBatch(db, server.id, server.type, albumDbId, tracks);
    fetchedCount++;
    if (onAlbumBatch && (fetchedCount === 1 || fetchedCount % BATCH_NOTIFY_INTERVAL === 0)) onAlbumBatch();
  }

  // Rebuild artists table from albums
  await db.execute("DELETE FROM artists WHERE server_id = ?", [server.id]);
  await db.execute(
    `INSERT INTO artists (id, server_id, server_type, name, album_count, created_at)
     SELECT lower(hex(randomblob(8))), ?, ?, artist, COUNT(DISTINCT id), datetime('now')
     FROM albums WHERE server_id = ? AND artist IS NOT NULL AND artist != ''
     GROUP BY artist`,
    [server.id, server.type, server.id]
  );

  // Rebuild FTS as a single sweep after all tracks are written
  await db.execute(
    "DELETE FROM tracks_fts WHERE id IN (SELECT id FROM tracks WHERE server_id = ?)",
    [server.id]
  );
  await db.execute(
    `INSERT INTO tracks_fts (id, title, artist, album, genre)
     SELECT t.id, t.title, COALESCE(t.artist, ''), a.name, COALESCE(t.genre, '')
     FROM tracks t JOIN albums a ON t.album_id = a.id
     WHERE t.server_id = ?`,
    [server.id]
  );

  // Sync loved state via getStarred2, independent of incremental skip logic
  const starred = await fetchStarred2(server.url, server.username, credential, altUrl);

  await db.execute(
    "DELETE FROM loved_albums WHERE album_id IN (SELECT id FROM albums WHERE server_id = ?)",
    [server.id]
  );
  await insertIdColumnBatch(db, "loved_albums", "album_id", (starred.album ?? []).map((a) => `${server.id}:${a.id}`));

  await db.execute(
    "DELETE FROM loved_tracks WHERE track_id IN (SELECT id FROM tracks WHERE server_id = ?)",
    [server.id]
  );
  await insertIdColumnBatch(db, "loved_tracks", "track_id", (starred.song ?? []).map((s) => `${server.id}:${s.id}`));

  // Sync playlists, collect all track lists before deleting to avoid wipe on partial failure
  const playlists = await fetchPlaylists(server.url, server.username, credential, altUrl);
  let failedPlaylists = 0;
  type PlaylistWithTracks = { pl: typeof playlists[number]; tracks: Awaited<ReturnType<typeof fetchPlaylistTracks>> };
  const playlistsWithTracks: PlaylistWithTracks[] = [];
  for (const pl of playlists) {
    try {
      const tracks = await fetchPlaylistTracks(server.url, server.username, credential, pl.id, altUrl);
      playlistsWithTracks.push({ pl, tracks });
    } catch (err) {
      console.error(`sync: failed to fetch tracks for playlist "${pl.name}" (${pl.id}):`, err);
      failedPlaylists++;
    }
  }

  await db.execute(
    "DELETE FROM playlist_tracks WHERE playlist_id IN (SELECT id FROM playlists WHERE server_id = ?)",
    [server.id]
  );
  await db.execute("DELETE FROM playlists WHERE server_id = ?", [server.id]);
  for (const { pl, tracks } of playlistsWithTracks) {
    const plDbId = `${server.id}:${pl.id}`;
    await db.execute(
      "INSERT INTO playlists (id, server_id, name, comment, track_count, cover_art_url) VALUES (?, ?, ?, ?, ?, ?)",
      [plDbId, server.id, pl.name, pl.comment ?? null, pl.songCount, pl.coverArt ?? null]
    );
    const CHUNK_SIZE = 500;
    for (let start = 0; start < tracks.length; start += CHUNK_SIZE) {
      const chunk = tracks.slice(start, start + CHUNK_SIZE);
      const placeholders = chunk.map(() => "(?, ?, ?)").join(", ");
      const params: (string | number)[] = [];
      chunk.forEach((t, offset) => {
        params.push(plDbId, `${server.id}:${t.id}`, start + offset);
      });
      await db.execute(
        `INSERT OR REPLACE INTO playlist_tracks (playlist_id, track_id, position) VALUES ${placeholders}`,
        params
      );
    }
  }

  // Scan for tag issues after all data is updated
  await scanForIssues(server.id);

  await rebuildTagVocabCache();

  return { failedAlbums, failedPlaylists, skippedAlbums };
}
