import { getDb } from "../db";
import { keychain } from "../keychain";
import type { Server } from "../types/server";
import { fetchAllAlbums, fetchAlbumTracks, fetchStarred2, fetchPlaylists, fetchPlaylistTracks } from "./navidrome";
import type { NavidromeCredential } from "./navidrome";
import { scanForIssues } from "./tagIssues";
import { rebuildTagVocabCache } from "./tag-normalize";

const BATCH_NOTIFY_INTERVAL = 25;

export async function syncLibrary(
  server: Server,
  onAlbumBatch?: () => void,
): Promise<{ failedAlbums: number; failedPlaylists: number; skippedAlbums: number }> {
  const credJson = await keychain.get(`canon.server.${server.id}`, "credential");
  if (!credJson) throw new Error(`No credentials found for server ${server.id}`);
  let credential: NavidromeCredential;
  try {
    credential = JSON.parse(credJson) as NavidromeCredential;
  } catch {
    throw new Error(`Corrupt credentials for server ${server.id} — re-enter in Settings`);
  }

  const albums = await fetchAllAlbums(server.url, server.username, credential);

  const db = await getDb();
  let failedAlbums = 0;
  let skippedAlbums = 0;
  let processedCount = 0;

  for (const album of albums) {
    const albumDbId = `${server.id}:${album.id}`;

    // Incremental sync: skip track fetch when album is unchanged
    type ExistingAlbumInfo = { navidrome_created: string | null; track_count: number };
    const existingRows = await db.select<ExistingAlbumInfo[]>(
      `SELECT navidrome_created,
              (SELECT COUNT(*) FROM tracks WHERE album_id = ?) AS track_count
       FROM albums WHERE id = ?`,
      [albumDbId, albumDbId]
    );
    const existing = existingRows[0] ?? null;
    const skipTracks =
      existing !== null &&
      existing.navidrome_created !== null &&
      existing.navidrome_created === (album.created ?? null) &&
      (album.songCount === undefined || existing.track_count === album.songCount);

    // Upsert album row — preserve computed_at/normalized_tags_json so background normalizer
    // doesn't re-run on every sync.
    await db.execute(
      `INSERT INTO albums (id, server_id, server_type, name, artist, year, artwork_url, navidrome_created, play_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         server_id = excluded.server_id,
         server_type = excluded.server_type,
         name = excluded.name,
         artist = excluded.artist,
         year = excluded.year,
         artwork_url = excluded.artwork_url,
         navidrome_created = excluded.navidrome_created,
         play_count = excluded.play_count`,
      [albumDbId, server.id, server.type, album.name, album.artist, album.year ?? null, album.coverArt ?? null, album.created ?? null, album.playCount ?? 0]
    );

    processedCount++;
    if (onAlbumBatch && (processedCount === 1 || processedCount % BATCH_NOTIFY_INTERVAL === 0)) {
      onAlbumBatch();
    }

    if (skipTracks) {
      skippedAlbums++;
      continue;
    }

    let tracks;
    try {
      tracks = await fetchAlbumTracks(server.url, server.username, credential, album.id);
    } catch (err) {
      console.error(`sync: failed to fetch tracks for album "${album.name}" (${album.id}):`, err);
      failedAlbums++;
      continue;
    }
    for (const track of tracks) {
      const trackDbId = `${server.id}:${track.id}`;
      await db.execute(
        `INSERT OR REPLACE INTO tracks
           (id, server_id, server_type, title, artist, album_id, genre, track_number, disc_number, year, duration, file_path, play_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trackDbId,
          server.id,
          server.type,
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
        ]
      );
      if (track.genre) {
        await db.execute(
          `INSERT OR IGNORE INTO track_tags (track_id, kind, raw_value, source)
           VALUES (?, 'genre', ?, 'server')`,
          [trackDbId, track.genre]
        );
      }
    }
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

  // Sync loved state via getStarred2 — independent of incremental skip logic
  const starred = await fetchStarred2(server.url, server.username, credential);

  await db.execute(
    "DELETE FROM loved_albums WHERE album_id IN (SELECT id FROM albums WHERE server_id = ?)",
    [server.id]
  );
  for (const album of starred.album ?? []) {
    await db.execute(
      "INSERT OR IGNORE INTO loved_albums (album_id) VALUES (?)",
      [`${server.id}:${album.id}`]
    );
  }

  await db.execute(
    "DELETE FROM loved_tracks WHERE track_id IN (SELECT id FROM tracks WHERE server_id = ?)",
    [server.id]
  );
  for (const song of starred.song ?? []) {
    await db.execute(
      "INSERT OR IGNORE INTO loved_tracks (track_id) VALUES (?)",
      [`${server.id}:${song.id}`]
    );
  }

  // Sync playlists — collect all track lists before deleting to avoid wipe on partial failure
  const playlists = await fetchPlaylists(server.url, server.username, credential);
  let failedPlaylists = 0;
  type PlaylistWithTracks = { pl: typeof playlists[number]; tracks: Awaited<ReturnType<typeof fetchPlaylistTracks>> };
  const playlistsWithTracks: PlaylistWithTracks[] = [];
  for (const pl of playlists) {
    try {
      const tracks = await fetchPlaylistTracks(server.url, server.username, credential, pl.id);
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
      "INSERT INTO playlists (id, server_id, name, comment, track_count) VALUES (?, ?, ?, ?, ?)",
      [plDbId, server.id, pl.name, pl.comment ?? null, pl.songCount]
    );
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i]!;
      await db.execute(
        "INSERT OR REPLACE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)",
        [plDbId, `${server.id}:${t.id}`, i]
      );
    }
  }

  // Scan for tag issues after all data is updated
  await scanForIssues(server.id);

  await rebuildTagVocabCache();

  return { failedAlbums, failedPlaylists, skippedAlbums };
}
