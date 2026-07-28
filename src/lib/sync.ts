import Database from "@tauri-apps/plugin-sql";
import { getDb } from "../db";
import { keychain } from "../keychain";
import type { Server } from "../types/server";
import { fetchAllAlbums, fetchAlbumTracks, fetchStarred2, fetchPlaylists, fetchPlaylistTracks, fetchAndStoreOpenSubsonicExtensions } from "./navidrome";
import type { NavidromeCredential, NavidromeTrack } from "./navidrome";
import { scanForIssues } from "./tagIssues";
import { rebuildTagVocabCache } from "./tag-normalize";
import { executeBatched } from "./db-batch";

const BATCH_NOTIFY_INTERVAL = 25;

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
    "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    20,
    (placeholders) => `INSERT OR REPLACE INTO tracks
         (id, server_id, server_type, title, artist, album_id, genre, track_number, disc_number, year, duration, file_path, play_count, bit_rate, suffix, file_size, replay_gain_track_gain, replay_gain_track_peak, replay_gain_album_gain, replay_gain_album_peak)
       VALUES ${placeholders}`
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

async function insertIdColumnBatch(db: Database, table: string, column: string, ids: string[]): Promise<void> {
  await executeBatched(
    db,
    ids.map((id) => [id]),
    "(?)",
    1,
    (placeholders) => `INSERT OR IGNORE INTO ${table} (${column}) VALUES ${placeholders}`
  );
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

// Which domains a sync actually wrote to. Callers use this to bump only the
// session stores whose data moved instead of invalidating every cached table
// on every auto-sync tick (default every 5 min), which forced a full re-read of
// albums + artists + tracks + genres + loved even when the server returned
// byte-identical data.
export interface SyncChanges {
  albums: boolean;
  tracks: boolean;
  artists: boolean;
  loved: boolean;
  playlists: boolean;
}

// Compare a fetched value against the DB's version loosely: SQLite hands back
// numbers where the API may hand back strings (year, play_count), and null and
// "" are interchangeable for these columns.
function sameValue(a: unknown, b: unknown): boolean {
  return String(a ?? "") === String(b ?? "");
}

export async function syncLibrary(
  server: Server,
  onAlbumBatch?: () => void,
): Promise<{
  failedAlbums: number;
  failedPlaylists: number;
  skippedAlbums: number;
  changed: SyncChanges;
}> {
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
  // Every column the upsert below writes is fetched, so an album whose row is
  // already identical can skip the write entirely and stay out of the change
  // flags - that is what lets an idle auto-sync bump nothing at all.
  type ExistingAlbumRow = {
    id: string;
    server_type: string;
    name: string;
    artist: string | null;
    year: number | null;
    artwork_url: string | null;
    navidrome_created: string | null;
    play_count: number | null;
    release_type: string | null;
  };
  type TrackCountRow = { album_id: string; c: number };
  const [existingAlbumRows, trackCountRows] = await Promise.all([
    db.select<ExistingAlbumRow[]>(
      `SELECT id, server_type, name, artist, year, artwork_url, navidrome_created, play_count, release_type
       FROM albums WHERE server_id = ?`,
      [server.id]
    ),
    db.select<TrackCountRow[]>(
      "SELECT album_id, COUNT(*) AS c FROM tracks WHERE server_id = ? GROUP BY album_id",
      [server.id]
    ),
  ]);
  const existingAlbumById = new Map(existingAlbumRows.map((r) => [r.id, r]));
  const trackCountByAlbumId = new Map(trackCountRows.map((r) => [r.album_id, r.c]));

  const albumUpsertParams: unknown[][] = [];
  const albumsNeedingTracks: { album: typeof albums[number]; albumDbId: string }[] = [];
  // Artists is a derived table (GROUP BY artist over albums), FTS carries the
  // album name - so each only needs rebuilding when its own input moved.
  let artistsDirty = false;
  let albumNameChanged = false;

  for (const album of albums) {
    const albumDbId = `${server.id}:${album.id}`;
    const existing = existingAlbumById.get(albumDbId);
    const existingCreated = existing?.navidrome_created ?? null;
    const existingTrackCount = trackCountByAlbumId.get(albumDbId) ?? 0;
    const skipTracks =
      existing !== undefined &&
      existingCreated !== null &&
      existingCreated === (album.created ?? null) &&
      (album.songCount === undefined || existingTrackCount === album.songCount);

    const releaseType = album.releaseTypes?.[0] ?? album.releaseType ?? null;
    const row = [
      albumDbId, server.id, server.type, album.name, album.artist, album.year ?? null,
      album.coverArt ?? null, album.created ?? null, album.playCount ?? 0, releaseType,
    ];

    if (existing === undefined) {
      albumUpsertParams.push(row);
      artistsDirty = true;
      albumNameChanged = true;
    } else {
      const unchanged =
        sameValue(existing.server_type, server.type) &&
        sameValue(existing.name, album.name) &&
        sameValue(existing.artist, album.artist) &&
        sameValue(existing.year, album.year) &&
        sameValue(existing.artwork_url, album.coverArt) &&
        sameValue(existing.navidrome_created, album.created) &&
        sameValue(existing.play_count ?? 0, album.playCount ?? 0) &&
        sameValue(existing.release_type, releaseType);
      if (!unchanged) {
        albumUpsertParams.push(row);
        if (!sameValue(existing.artist, album.artist)) artistsDirty = true;
        if (!sameValue(existing.name, album.name)) albumNameChanged = true;
      }
    }

    if (skipTracks) {
      skippedAlbums++;
    } else {
      albumsNeedingTracks.push({ album, albumDbId });
    }
  }

  // Upsert album rows in batches, preserving computed_at/normalized_tags_json
  // so the background normalizer doesn't re-run on every sync.
  await executeBatched(
    db,
    albumUpsertParams,
    "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    10,
    (placeholders) => `INSERT INTO albums (id, server_id, server_type, name, artist, year, artwork_url, navidrome_created, play_count, release_type)
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
         release_type = excluded.release_type`
  );

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

  // Rebuild artists table from albums, only when an album was added or had its
  // artist changed - otherwise the DELETE + re-INSERT rewrites ~2000 identical
  // rows on every auto-sync.
  if (artistsDirty) {
    await db.execute("DELETE FROM artists WHERE server_id = ?", [server.id]);
    await db.execute(
      `INSERT INTO artists (id, server_id, server_type, name, album_count, created_at)
       SELECT lower(hex(randomblob(8))), ?, ?, artist, COUNT(DISTINCT id), datetime('now')
       FROM albums WHERE server_id = ? AND artist IS NOT NULL AND artist != ''
       GROUP BY artist`,
      [server.id, server.type, server.id]
    );
  }

  // Rebuild FTS as a single sweep after all tracks are written. Its rows carry
  // track fields plus the album name, so it only needs rebuilding when tracks
  // were written or an album was renamed.
  if (fetchedCount > 0 || albumNameChanged) {
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
  }

  // Sync loved state via getStarred2, independent of incremental skip logic.
  // Compared against what is already stored so an unchanged starred list writes
  // nothing and leaves the loved session store untouched (~8 mounted consumers).
  const starred = await fetchStarred2(server.url, server.username, credential, altUrl);
  const starredAlbumIds = (starred.album ?? []).map((a) => `${server.id}:${a.id}`);
  const starredTrackIds = (starred.song ?? []).map((s) => `${server.id}:${s.id}`);

  const [existingLovedAlbums, existingLovedTracks] = await Promise.all([
    db.select<{ album_id: string }[]>(
      "SELECT album_id FROM loved_albums WHERE album_id IN (SELECT id FROM albums WHERE server_id = ?)",
      [server.id]
    ),
    db.select<{ track_id: string }[]>(
      "SELECT track_id FROM loved_tracks WHERE track_id IN (SELECT id FROM tracks WHERE server_id = ?)",
      [server.id]
    ),
  ]);

  let lovedChanged = false;
  const existingLovedAlbumIds = new Set(existingLovedAlbums.map((r) => r.album_id));
  if (
    existingLovedAlbumIds.size !== new Set(starredAlbumIds).size ||
    starredAlbumIds.some((id) => !existingLovedAlbumIds.has(id))
  ) {
    lovedChanged = true;
    await db.execute(
      "DELETE FROM loved_albums WHERE album_id IN (SELECT id FROM albums WHERE server_id = ?)",
      [server.id]
    );
    await insertIdColumnBatch(db, "loved_albums", "album_id", starredAlbumIds);
  }

  const existingLovedTrackIds = new Set(existingLovedTracks.map((r) => r.track_id));
  if (
    existingLovedTrackIds.size !== new Set(starredTrackIds).size ||
    starredTrackIds.some((id) => !existingLovedTrackIds.has(id))
  ) {
    lovedChanged = true;
    await db.execute(
      "DELETE FROM loved_tracks WHERE track_id IN (SELECT id FROM tracks WHERE server_id = ?)",
      [server.id]
    );
    await insertIdColumnBatch(db, "loved_tracks", "track_id", starredTrackIds);
  }

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

  // Same idea as loved: build a signature of the fetched playlists (metadata plus
  // ordered track ids) and compare it to what is stored, so an unchanged
  // playlist set skips the DELETE + re-INSERT and the store bump.
  type ExistingPlaylistRow = {
    id: string;
    name: string;
    comment: string | null;
    track_count: number | null;
    cover_art_url: string | null;
  };
  const [existingPlaylists, existingPlaylistTracks] = await Promise.all([
    db.select<ExistingPlaylistRow[]>(
      "SELECT id, name, comment, track_count, cover_art_url FROM playlists WHERE server_id = ? ORDER BY id",
      [server.id]
    ),
    db.select<{ playlist_id: string; track_id: string }[]>(
      `SELECT playlist_id, track_id FROM playlist_tracks
       WHERE playlist_id IN (SELECT id FROM playlists WHERE server_id = ?)
       ORDER BY playlist_id, position`,
      [server.id]
    ),
  ]);

  const existingTrackIdsByPlaylist = new Map<string, string[]>();
  for (const row of existingPlaylistTracks) {
    const list = existingTrackIdsByPlaylist.get(row.playlist_id);
    if (list) list.push(row.track_id);
    else existingTrackIdsByPlaylist.set(row.playlist_id, [row.track_id]);
  }

  function playlistSignature(
    rows: { id: string; name: string; comment: string | null; trackCount: unknown; coverArt: string | null; trackIds: string[] }[]
  ): string {
    return rows
      .slice()
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((r) =>
        [r.id, r.name, r.comment ?? "", String(r.trackCount ?? ""), r.coverArt ?? "", r.trackIds.join(",")].join("\u0001")
      )
      .join("\u0002");
  }

  const fetchedSignature = playlistSignature(
    playlistsWithTracks.map(({ pl, tracks }) => ({
      id: `${server.id}:${pl.id}`,
      name: pl.name,
      comment: pl.comment ?? null,
      trackCount: pl.songCount,
      coverArt: pl.coverArt ?? null,
      trackIds: tracks.map((t) => `${server.id}:${t.id}`),
    }))
  );
  const existingSignature = playlistSignature(
    existingPlaylists.map((r) => ({
      id: r.id,
      name: r.name,
      comment: r.comment,
      trackCount: r.track_count,
      coverArt: r.cover_art_url,
      trackIds: existingTrackIdsByPlaylist.get(r.id) ?? [],
    }))
  );

  const playlistsChanged = fetchedSignature !== existingSignature;
  if (playlistsChanged) {
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
      const trackRows = tracks.map((t, position) => [plDbId, `${server.id}:${t.id}`, position]);
      await executeBatched(
        db,
        trackRows,
        "(?, ?, ?)",
        3,
        (placeholders) => `INSERT OR REPLACE INTO playlist_tracks (playlist_id, track_id, position) VALUES ${placeholders}`
      );
    }
  }

  const albumsChanged = albumUpsertParams.length > 0;
  const tracksChanged = fetchedCount > 0;

  // Both are whole-table sweeps over tracks / track_tags (see performance-issues
  // items 9 and 18), so they only run when this sync actually touched that data.
  if (albumsChanged || tracksChanged) {
    // Scan for tag issues after all data is updated
    await scanForIssues(server.id);

    await rebuildTagVocabCache();
  }

  return {
    failedAlbums,
    failedPlaylists,
    skippedAlbums,
    changed: {
      albums: albumsChanged,
      tracks: tracksChanged,
      artists: artistsDirty,
      loved: lovedChanged,
      playlists: playlistsChanged,
    },
  };
}
