import Database from "@tauri-apps/plugin-sql";
import { getDb } from "../db";
import { keychain } from "../keychain";
import type { Server } from "../types/server";
import { fetchAllAlbums, fetchAlbumTracks, fetchStarred2, fetchPlaylists, fetchPlaylistTracks, fetchAndStoreOpenSubsonicExtensions } from "./navidrome";
import type { NavidromeCredential, NavidromeTrack } from "./navidrome";
import { scanForIssues } from "./tagIssues";
import { escapeLike } from "./sql";
import { rebuildTagVocabCache } from "./tag-normalize";
import { executeBatched, executeIdChunks, SQLITE_MAX_VARIABLES } from "./db-batch";
import { runPool } from "./async-pool";

const BATCH_NOTIFY_INTERVAL = 25;

// Tables that mirror server content, keyed by track id. A track the server no
// longer has leaves rows here that still show up in the grid, in search and in
// radio candidates, and 404 when played.
//
// Deliberately NOT listed: scrobble_queue and scrobble_history (the user's
// listening history, not the server's data), pending_edits and edit_history
// (inert legacy schema). Album-keyed album_identity and album_user_genres are
// left alone for the same reason: they are user-authored or user-corrected and
// cost nothing to keep if the album comes back.
async function deleteTracksByIds(db: Database, trackIds: readonly string[]): Promise<void> {
  if (trackIds.length === 0) return;
  const statements = [
    (ph: string) => `DELETE FROM tracks_fts WHERE id IN (${ph})`,
    (ph: string) => `DELETE FROM track_tags WHERE track_id IN (${ph})`,
    (ph: string) => `DELETE FROM loved_tracks WHERE track_id IN (${ph})`,
    (ph: string) => `DELETE FROM playlist_tracks WHERE track_id IN (${ph})`,
    (ph: string) => `DELETE FROM tag_issues WHERE track_id IN (${ph})`,
    (ph: string) => `DELETE FROM lyrics WHERE track_id IN (${ph})`,
    (ph: string) => `DELETE FROM waveform_cache WHERE track_id IN (${ph})`,
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
// survive a re-add of the same server.
async function pruneAlbums(db: Database, albumIds: readonly string[]): Promise<void> {
  if (albumIds.length === 0) return;
  const viaTracks = (table: string, column: string) => (ph: string) =>
    `DELETE FROM ${table} WHERE ${column} IN (SELECT id FROM tracks WHERE album_id IN (${ph}))`;
  const statements = [
    viaTracks("tracks_fts", "id"),
    viaTracks("track_tags", "track_id"),
    viaTracks("loved_tracks", "track_id"),
    viaTracks("playlist_tracks", "track_id"),
    viaTracks("tag_issues", "track_id"),
    viaTracks("lyrics", "track_id"),
    viaTracks("waveform_cache", "track_id"),
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
// filter by server_id (see `library_read.rs`), so the old albums keep rendering
// and 404 when played, because stream URLs are built from whatever server is
// selected now against the removed server's track ids.
//
// Deletes run through subselects on server_id rather than collected id lists, so
// there is no chunking involved and none of the `NOT IN` hazard that forces
// `pruneAlbumTracks` above to bail out rather than split. Dependents go first so
// the subselects can still resolve the rows they are keyed to.
//
// Purged here but deliberately kept by the sync prune above: scrobble_queue and
// scrobble_history (queued plays can never be delivered once the server is gone,
// and the history is dedupe state keyed to track ids that no longer exist),
// album_identity and album_user_genres (a re-added server mints a fresh UUID, so
// every id is rewritten and these rows could never be matched again anyway).
//
// Deliberately NOT purged: artist_identity, artist_covers, artist_aliases,
// radio_signal_cache, tag_mappings, user_tree_nodes. Those are keyed by artist
// name or are global user data, so they stay correct across servers.
export async function purgeServerData(db: Database, serverId: string): Promise<void> {
  const viaTracks = (table: string, column: string) =>
    `DELETE FROM ${table} WHERE ${column} IN (SELECT id FROM tracks WHERE server_id = ?)`;
  const viaAlbums = (table: string, column: string) =>
    `DELETE FROM ${table} WHERE ${column} IN (SELECT id FROM albums WHERE server_id = ?)`;
  const statements = [
    viaTracks("tracks_fts", "id"),
    viaTracks("track_tags", "track_id"),
    viaTracks("loved_tracks", "track_id"),
    viaTracks("playlist_tracks", "track_id"),
    viaTracks("tag_issues", "track_id"),
    viaTracks("lyrics", "track_id"),
    viaTracks("waveform_cache", "track_id"),
    viaTracks("scrobble_queue", "track_id"),
    viaTracks("scrobble_history", "track_id"),
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

// Drop tracks the album no longer contains. Without this a track deleted on the
// server keeps its row, the stored track count stays permanently above the
// album's songCount, and the skipTracks check below can never match again - so
// the album is re-fetched on every sync forever, dragging the FTS rebuild and
// the tag scans along with it.
async function pruneAlbumTracks(
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

/** How far the album track pass has got, for in-run UI. */
export interface SyncProgress {
  done: number;
  total: number;
}

export async function syncLibrary(
  server: Server,
  onAlbumBatch?: (progress: SyncProgress) => void,
): Promise<{
  failedAlbums: number;
  failedPlaylists: number;
  skippedAlbums: number;
  /** Albums and tracks dropped because the server no longer has them. */
  prunedAlbums: number;
  prunedTracks: number;
  /** True when the album track pass gave up early on a run of failures, so some
   *  albums still hold stale or missing tracks until the next sync. */
  albumTracksIncomplete: boolean;
  /** Stages skipped because their fetch failed, e.g. "loved" or "playlists". Stored data
   *  for those stages is left untouched rather than half-written. */
  skippedStages: string[];
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
  const skippedStages: string[] = [];
  // Deliberately not awaited: extension discovery is advisory. It still needs its own
  // catch, or a transient network failure surfaces as an unhandled rejection.
  fetchAndStoreOpenSubsonicExtensions(server.url, server.username, credential, server.id, altUrl).catch(
    (err: unknown) => {
      console.error("sync: failed to fetch OpenSubsonic extensions:", err);
    }
  );

  // Fatal by design: without the album list there is no sync to run.
  const albums = await fetchAllAlbums(server.url, server.username, credential, altUrl);

  const db = await getDb();
  let failedAlbums = 0;
  let skippedAlbums = 0;

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
    played_at: string | null;
    release_type: string | null;
  };
  type TrackCountRow = { album_id: string; c: number };
  const [existingAlbumRows, trackCountRows] = await Promise.all([
    db.select<ExistingAlbumRow[]>(
      `SELECT id, server_type, name, artist, year, artwork_url, navidrome_created, play_count, played_at, release_type
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
  const albumsNeedingTracks: {
    album: typeof albums[number];
    albumDbId: string;
    existingTrackCount: number;
  }[] = [];
  // Artists is a derived table (GROUP BY artist over albums), FTS carries the
  // album name - so each only needs rebuilding when its own input moved. FTS is
  // rebuilt per album rather than per server, so collect which albums moved.
  let artistsDirty = false;
  const ftsDirtyAlbumIds = new Set<string>();

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
      album.coverArt ?? null, album.created ?? null, album.playCount ?? 0, album.played ?? null, releaseType,
    ];

    if (existing === undefined) {
      albumUpsertParams.push(row);
      artistsDirty = true;
      ftsDirtyAlbumIds.add(albumDbId);
    } else {
      const unchanged =
        sameValue(existing.server_type, server.type) &&
        sameValue(existing.name, album.name) &&
        sameValue(existing.artist, album.artist) &&
        sameValue(existing.year, album.year) &&
        sameValue(existing.artwork_url, album.coverArt) &&
        sameValue(existing.navidrome_created, album.created) &&
        sameValue(existing.play_count ?? 0, album.playCount ?? 0) &&
        sameValue(existing.played_at, album.played) &&
        sameValue(existing.release_type, releaseType);
      if (!unchanged) {
        albumUpsertParams.push(row);
        if (!sameValue(existing.artist, album.artist)) artistsDirty = true;
        // The FTS row carries the album name, so a rename dirties it even when
        // no track was fetched.
        if (!sameValue(existing.name, album.name)) ftsDirtyAlbumIds.add(albumDbId);
      }
    }

    if (skipTracks) {
      skippedAlbums++;
    } else {
      albumsNeedingTracks.push({ album, albumDbId, existingTrackCount });
    }
  }

  // Upsert album rows in batches, preserving computed_at/normalized_tags_json
  // so the background normalizer doesn't re-run on every sync.
  await executeBatched(
    db,
    albumUpsertParams,
    "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    11,
    (placeholders) => `INSERT INTO albums (id, server_id, server_type, name, artist, year, artwork_url, navidrome_created, play_count, played_at, release_type)
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
         played_at = excluded.played_at,
         release_type = excluded.release_type`
  );

  // Drop what the server no longer has. `fetchAllAlbums` throws on any failed
  // page rather than returning a short list, so a returned list is complete and
  // a missing album is a real deletion, not a partial read. An empty list
  // against a non-empty stored library is treated as suspect regardless and
  // prunes nothing, so a misconfigured or freshly-empty server cannot wipe the
  // local library in one tick.
  const fetchedAlbumIds = new Set(albums.map((a) => `${server.id}:${a.id}`));
  const staleAlbumIds = existingAlbumRows.map((r) => r.id).filter((id) => !fetchedAlbumIds.has(id));
  let prunedAlbums = 0;
  let prunedTracks = 0;
  if (albums.length > 0 && staleAlbumIds.length > 0) {
    await pruneAlbums(db, staleAlbumIds);
    prunedAlbums = staleAlbumIds.length;
    // artists is a GROUP BY over albums, so losing albums can drop an artist
    // outright or change an album_count.
    artistsDirty = true;
  }

  // `done` counts attempts, not successes: a bar that stalls short of the total
  // whenever an album fetch fails cannot be told apart from a hung sync, and the
  // failures are already reported as `failedAlbums`. Gated on the work outstanding
  // rather than on what the album upsert did, because an album whose row is
  // unchanged but whose tracks were pruned still has a whole track pass to run.
  let reportedDone = 0;
  function reportProgress(done: number) {
    if (!onAlbumBatch || albumsNeedingTracks.length === 0) return;
    reportedDone = done;
    onAlbumBatch({ done, total: albumsNeedingTracks.length });
  }
  reportProgress(0);

  let fetchedCount = 0;
  // Each fetch already retries with its own timeout, so a server that went away mid-sync
  // would otherwise cost that full budget once per remaining album. A run of consecutive
  // failures means the server, not the album, is the problem: give up on the rest and let
  // the next sync pick them up (they stay unfetched, so nothing is lost).
  const CONSECUTIVE_FAILURE_LIMIT = 5;
  let consecutiveFailures = 0;
  let albumTracksIncomplete = false;
  let attemptedCount = 0;
  for (const { album, albumDbId, existingTrackCount } of albumsNeedingTracks) {
    let tracks;
    attemptedCount++;
    try {
      tracks = await fetchAlbumTracks(server.url, server.username, credential, album.id, altUrl);
      consecutiveFailures = 0;
    } catch (err) {
      console.error(`sync: failed to fetch tracks for album "${album.name}" (${album.id}):`, err);
      failedAlbums++;
      consecutiveFailures++;
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        console.error(
          `sync: ${consecutiveFailures} album track fetches failed in a row, stopping the album pass early`
        );
        albumTracksIncomplete = true;
        break;
      }
      continue;
    }
    await insertTracksBatch(db, server.id, server.type, albumDbId, tracks);
    // Only worth a query for an album that already had rows: on a first sync
    // there is nothing to prune and this would be one wasted round trip per album.
    if (existingTrackCount > 0) {
      prunedTracks += await pruneAlbumTracks(
        db,
        albumDbId,
        tracks.map((t) => `${server.id}:${t.id}`)
      );
    }
    fetchedCount++;
    ftsDirtyAlbumIds.add(albumDbId);
    if (fetchedCount === 1 || fetchedCount % BATCH_NOTIFY_INTERVAL === 0) {
      reportProgress(attemptedCount);
    }
  }

  // The interval only lands on multiples of BATCH_NOTIFY_INTERVAL, so without this
  // the last report is up to an interval short of where the pass got. On the
  // early-break path the shortfall is the point: the bar stays under the total,
  // which is what `albumTracksIncomplete` is telling the user.
  if (attemptedCount !== reportedDone) reportProgress(attemptedCount);

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

  // Rebuild FTS after all tracks are written, scoped to the albums that actually
  // moved. Sweeping the whole server rewrote every FTS row in the library for a
  // single changed album. Album ids are server-prefixed, so scoping by album_id
  // is already scoped by server.
  if (ftsDirtyAlbumIds.size > 0) {
    const dirtyIds = [...ftsDirtyAlbumIds];
    await executeIdChunks(
      db,
      dirtyIds,
      (ph) => `DELETE FROM tracks_fts WHERE id IN (SELECT id FROM tracks WHERE album_id IN (${ph}))`
    );
    await executeIdChunks(
      db,
      dirtyIds,
      (ph) => `INSERT INTO tracks_fts (id, title, artist, album, genre)
       SELECT t.id, t.title, COALESCE(t.artist, ''), a.name, COALESCE(t.genre, '')
       FROM tracks t JOIN albums a ON t.album_id = a.id
       WHERE t.album_id IN (${ph})`
    );
  }

  // Sync loved state via getStarred2, independent of incremental skip logic.
  // Compared against what is already stored so an unchanged starred list writes
  // nothing and leaves the loved session store untouched (~8 mounted consumers).
  //
  // Non-fatal: album and track rows are already committed at this point, so a network
  // failure here skips the loved pass and leaves the stored state alone rather than
  // throwing away a completed library sync. Skipping is also the only safe response,
  // since the pass below treats the fetched list as authoritative and DELETEs first.
  let lovedChanged = false;
  const starred = await fetchStarred2(server.url, server.username, credential, altUrl).catch(
    (err: unknown) => {
      console.error("sync: failed to fetch starred items, keeping stored loved state:", err);
      skippedStages.push("loved");
      return null;
    }
  );

  if (starred) {
    const starredAlbumIds = (starred.album ?? []).map((a) => `${server.id}:${a.id}`);
    const starredTrackIds = (starred.song ?? []).map((s) => `${server.id}:${s.id}`);

    // Scoped by id prefix, not by a join to albums/tracks. The write below is
    // unscoped (it inserts every starred id the server reported), so a starred item
    // with no local row - an album whose track fetch failed, a track pruned server
    // side but still starred - would be written and then be invisible to this read.
    // The counts could never match again, so lovedChanged stayed true on every sync,
    // rewriting both tables and bumping the session store (~8 mounted consumers)
    // every auto-sync tick forever, while the join-scoped DELETE left the orphan in
    // place. Reading and deleting the same set the write produces closes both.
    const idPrefix = `${escapeLike(server.id)}:%`;
    const [existingLovedAlbums, existingLovedTracks] = await Promise.all([
      db.select<{ album_id: string }[]>(
        "SELECT album_id FROM loved_albums WHERE album_id LIKE ? ESCAPE '\\'",
        [idPrefix]
      ),
      db.select<{ track_id: string }[]>(
        "SELECT track_id FROM loved_tracks WHERE track_id LIKE ? ESCAPE '\\'",
        [idPrefix]
      ),
    ]);

    const existingLovedAlbumIds = new Set(existingLovedAlbums.map((r) => r.album_id));
    if (
      existingLovedAlbumIds.size !== new Set(starredAlbumIds).size ||
      starredAlbumIds.some((id) => !existingLovedAlbumIds.has(id))
    ) {
      lovedChanged = true;
      await db.execute("DELETE FROM loved_albums WHERE album_id LIKE ? ESCAPE '\\'", [
        idPrefix,
      ]);
      await insertIdColumnBatch(db, "loved_albums", "album_id", starredAlbumIds);
    }

    const existingLovedTrackIds = new Set(existingLovedTracks.map((r) => r.track_id));
    if (
      existingLovedTrackIds.size !== new Set(starredTrackIds).size ||
      starredTrackIds.some((id) => !existingLovedTrackIds.has(id))
    ) {
      lovedChanged = true;
      await db.execute("DELETE FROM loved_tracks WHERE track_id LIKE ? ESCAPE '\\'", [
        idPrefix,
      ]);
      await insertIdColumnBatch(db, "loved_tracks", "track_id", starredTrackIds);
    }
  }

  // Sync playlists, collect all track lists before deleting to avoid wipe on partial failure.
  // Non-fatal for the same reason as the loved pass above: albums and tracks are already
  // committed, so a failed playlist listing skips this pass instead of throwing away the
  // whole sync.
  let failedPlaylists = 0;
  // The write below prunes playlists absent from the fetched list, so an incomplete
  // picture of the server's playlists must not reach it: a playlist whose track list
  // failed would be erased outright. Any fetch failure in this pass blocks the write and
  // leaves the stored playlists as they are until a later sync reads them cleanly.
  let playlistWritesBlocked = false;
  const playlists = await fetchPlaylists(server.url, server.username, credential, altUrl).catch(
    (err: unknown) => {
      console.error("sync: failed to fetch playlists, keeping stored playlists:", err);
      skippedStages.push("playlists");
      playlistWritesBlocked = true;
      return [];
    }
  );
  type PlaylistWithTracks = { pl: typeof playlists[number]; tracks: Awaited<ReturnType<typeof fetchPlaylistTracks>> };
  // One getPlaylist round trip per playlist, and every auto-sync tick pays for all of
  // them because the comparison below needs the track lists to build its signature.
  // Serially that is playlistCount * round-trip on the critical path of every sync;
  // the pool bounds how many are in flight without changing what is fetched.
  const fetchedByIndex = new Array<PlaylistWithTracks | undefined>(playlists.length);
  await runPool(
    playlists,
    async (pl, index) => {
      try {
        const tracks = await fetchPlaylistTracks(server.url, server.username, credential, pl.id, altUrl);
        fetchedByIndex[index] = { pl, tracks };
      } catch (err) {
        console.error(`sync: failed to fetch tracks for playlist "${pl.name}" (${pl.id}):`, err);
        // Blocks the write for every playlist, not just this one, so it owes the caller
        // the same stage the listing failure reports. The listing failure cannot also be
        // in flight here (it returns [], leaving the pool nothing to iterate), but the
        // stage is pushed once regardless rather than relying on that.
        if (!playlistWritesBlocked) skippedStages.push("playlists");
        playlistWritesBlocked = true;
        failedPlaylists++;
      }
    },
    { concurrency: 4 }
  );
  const playlistsWithTracks: PlaylistWithTracks[] = fetchedByIndex.filter(
    (entry): entry is PlaylistWithTracks => entry !== undefined
  );

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
    db.select<{ playlist_id: string; track_id: string; position: number }[]>(
      `SELECT playlist_id, track_id, position FROM playlist_tracks
       WHERE playlist_id IN (SELECT id FROM playlists WHERE server_id = ?)
       ORDER BY playlist_id, position`,
      [server.id]
    ),
  ]);

  const existingTrackIdsByPlaylist = new Map<string, string[]>();
  // Playlists whose stored positions are no longer 0..n-1. The album prune deletes the
  // playlist_tracks rows of the tracks it drops and leaves the positions around them alone,
  // and the server drops the same tracks from the playlist, so every gate below that compares
  // the two sides sees an identical name, count and ordered id list. `position` is the
  // songIndexToRemove PlaylistDetail sends, so a hole makes the next removal delete the wrong
  // track server side. Rewriting the playlist is what closes it, so the hole has to reach the
  // gates that decide whether to rewrite.
  const holedPlaylists = new Set<string>();
  for (const row of existingPlaylistTracks) {
    const list = existingTrackIdsByPlaylist.get(row.playlist_id);
    if (list) list.push(row.track_id);
    else existingTrackIdsByPlaylist.set(row.playlist_id, [row.track_id]);
    if (row.position !== (existingTrackIdsByPlaylist.get(row.playlist_id)!.length - 1)) {
      holedPlaylists.add(row.playlist_id);
    }
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

  const playlistsChanged =
    !playlistWritesBlocked && (fetchedSignature !== existingSignature || holedPlaylists.size > 0);
  if (playlistsChanged) {
    // Upsert the server-owned columns rather than DELETE-all-then-INSERT. is_smart,
    // rules_json and custom_cover_data are local-only and the server knows nothing
    // about them, so re-inserting from the fetched payload erased them: a smart
    // playlist lost its rules and silently became an ordinary one the first time any
    // playlist's signature changed, which a freshly created smart playlist causes by
    // itself (the server reports a coverArt the local insert never wrote).
    const fetchedIds = new Set(playlistsWithTracks.map(({ pl }) => `${server.id}:${pl.id}`));
    const removedIds = existingPlaylists.map((r) => r.id).filter((id) => !fetchedIds.has(id));
    if (removedIds.length > 0) {
      await executeIdChunks(db, removedIds, (ph) => `DELETE FROM playlist_tracks WHERE playlist_id IN (${ph})`);
      await executeIdChunks(db, removedIds, (ph) => `DELETE FROM playlist_resume WHERE playlist_id IN (${ph})`);
      await executeIdChunks(db, removedIds, (ph) => `DELETE FROM playlists WHERE id IN (${ph})`);
    }

    for (const { pl, tracks } of playlistsWithTracks) {
      const plDbId = `${server.id}:${pl.id}`;
      await db.execute(
        `INSERT INTO playlists (id, server_id, name, comment, track_count, cover_art_url)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           comment = excluded.comment,
           track_count = excluded.track_count,
           cover_art_url = excluded.cover_art_url`,
        [plDbId, server.id, pl.name, pl.comment ?? null, pl.songCount, pl.coverArt ?? null]
      );
      // Only rewrite the track rows of playlists whose own ordered list moved. The
      // signature above is server-wide, so one edited playlist used to rewrite every
      // playlist's rows.
      const fetchedTrackIds = tracks.map((t) => `${server.id}:${t.id}`);
      const storedTrackIds = existingTrackIdsByPlaylist.get(plDbId) ?? [];
      const sameTracks =
        storedTrackIds.length === fetchedTrackIds.length &&
        fetchedTrackIds.every((id, i) => storedTrackIds[i] === id);
      if (sameTracks && !holedPlaylists.has(plDbId)) continue;

      await db.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", [plDbId]);
      const trackRows = fetchedTrackIds.map((trackId, position) => [plDbId, trackId, position]);
      await executeBatched(
        db,
        trackRows,
        "(?, ?, ?)",
        3,
        (placeholders) => `INSERT OR REPLACE INTO playlist_tracks (playlist_id, track_id, position) VALUES ${placeholders}`
      );
    }
  }

  const albumsChanged = albumUpsertParams.length > 0 || prunedAlbums > 0;
  const tracksChanged = fetchedCount > 0 || prunedAlbums > 0 || prunedTracks > 0;

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
    prunedAlbums,
    prunedTracks,
    albumTracksIncomplete,
    skippedStages,
    changed: {
      albums: albumsChanged,
      tracks: tracksChanged,
      artists: artistsDirty,
      loved: lovedChanged,
      playlists: playlistsChanged,
    },
  };
}
