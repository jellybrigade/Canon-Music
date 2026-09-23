import { getDb } from "../../db";
import type { Server } from "../../types/server";
import { fetchAllAlbums, fetchAlbumTracks, fetchAndStoreOpenSubsonicExtensions, fetchScanStatus } from "../../clients/navidrome";
import type { NavidromeCredential } from "../../clients/navidromeUrls";
import { scanForIssues } from "../tags/lib/tagIssues";
import { rebuildTagVocabCache } from "../tags/lib/tagNormalize";
import { executeBatched, SQLITE_MAX_VARIABLES } from "../../lib/dbBatch";
import { TransportStalledError } from "../../lib/transportHealth";
import { mirroredTrackIdsStillResolve, sameValue, scanIdentity, watermarkMoved, type ServerWatermark } from "./syncWatermark";
import { pruneAlbums, pruneAlbumTracks } from "./syncPrune";
import { carryRenamedTracks, insertTracksBatch, planRenamedTracks, rebuildTracksFts } from "./syncTracks";
import { syncLoved } from "./syncLoved";
import { syncPlaylists } from "./syncPlaylists";

const BATCH_NOTIFY_INTERVAL = 25;

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

/** How far the album track pass has got, for in-run UI. */
export interface SyncProgress {
  done: number;
  total: number;
}

/** What the caller knows that the sync's own evidence cannot tell it. */
export interface SyncOptions {
  /** Read every album's tracks whatever the watermark and the probe say. */
  forceTrackPass?: boolean;
}

export async function syncLibrary(
  server: Server,
  credential: NavidromeCredential,
  onAlbumBatch?: (progress: SyncProgress) => void,
  options?: SyncOptions,
): Promise<{
  failedAlbums: number;
  failedPlaylists: number;
  skippedAlbums: number;
  /** Albums and tracks dropped because the server no longer has them. */
  prunedAlbums: number;
  prunedTracks: number;
  /** Tracks whose id the server rewrote, carried onto the new id instead of pruned. */
  remappedTracks: number;
  /** True when the album track pass gave up early on a run of failures, so some
   *  albums still hold stale or missing tracks until the next sync. */
  albumTracksIncomplete: boolean;
  /** Stages skipped because their fetch failed, e.g. "loved" or "playlists". Stored data
   *  for those stages is left untouched rather than half-written. */
  skippedStages: string[];
  changed: SyncChanges;
}> {
  const altUrl = server.alt_url ?? undefined;
  const skippedStages: string[] = [];
  // Deliberately not awaited: extension discovery is advisory. It still needs its own
  // catch, or a transient network failure surfaces as an unhandled rejection.
  fetchAndStoreOpenSubsonicExtensions(server.url, server.username, credential, server.id, altUrl).catch(
    (err: unknown) => {
      console.error("sync: failed to fetch OpenSubsonic extensions:", err);
    }
  );

  // Fatal by design: without the album list there is no sync to run. The scan status
  // rides alongside it because it is one request and its failure is survivable: some
  // deployments restrict getScanStatus to admins, and "no evidence" must fall through to
  // the id probe below rather than read as "nothing changed".
  const [albums, scanStatus] = await Promise.all([
    fetchAllAlbums(server.url, server.username, credential, altUrl),
    fetchScanStatus(server.url, server.username, credential, altUrl).catch((err: unknown) => {
      console.error("sync: failed to read the server scan status, falling back to the id probe:", err);
      return null;
    }),
  ]);

  const db = await getDb();

  // Decide once, before the album loop, whether anything may be skipped at all. A server
  // version bump is exactly when a migration rewrites ids, and a scan stamp or song count
  // that moved means rows were rewritten under album metadata that can look unchanged.
  const storedWatermark = (
    await db.select<ServerWatermark[]>(
      "SELECT last_scan_at, server_version, song_count FROM servers WHERE id = ?",
      [server.id]
    )
  )[0];
  const serverIdentityMoved = watermarkMoved(storedWatermark, scanStatus);
  // The caller's flag comes first, and not as a cleared watermark: `watermarkMoved` reads
  // "no scan status" as "no evidence", which on a deployment that restricts getScanStatus to
  // admins flattens a user asking for a resync into the same skipped sync they already had.
  // Short-circuit deliberate: a forced full pass has nothing left to learn from the probe.
  const passIdentity = scanStatus === null ? null : scanIdentity(scanStatus);
  // Only a pass forced by the identity alone may resume. An explicit resync is a request to
  // read everything, and a failed id probe under an unchanged identity is evidence against
  // albums already stamped with that identity.
  const resumable = serverIdentityMoved && options?.forceTrackPass !== true && passIdentity !== null;
  const forceTrackPass =
    options?.forceTrackPass === true ||
    serverIdentityMoved ||
    !(await mirroredTrackIdsStillResolve(db, server, credential, altUrl));
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
    tracks_read_scan: string | null;
  };
  type TrackCountRow = { album_id: string; c: number };
  const [existingAlbumRows, trackCountRows] = await Promise.all([
    db.select<ExistingAlbumRow[]>(
      `SELECT id, server_type, name, artist, year, artwork_url, navidrome_created, play_count, played_at, release_type, tracks_read_scan
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
  const renamedTrackIds: string[] = [];

  for (const album of albums) {
    const albumDbId = `${server.id}:${album.id}`;
    const existing = existingAlbumById.get(albumDbId);
    const existingCreated = existing?.navidrome_created ?? null;
    const existingTrackCount = trackCountByAlbumId.get(albumDbId) ?? 0;
    const albumUnchanged =
      existing !== undefined &&
      existingCreated !== null &&
      existingCreated === (album.created ?? null) &&
      (album.songCount === undefined || existingTrackCount === album.songCount);
    const readInThisPass = resumable && existing?.tracks_read_scan === passIdentity;
    const skipTracks = albumUnchanged && (!forceTrackPass || readInThisPass);

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
  let remappedTracks = 0;
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
  const readAlbumIds: string[] = [];
  for (const { album, albumDbId, existingTrackCount } of albumsNeedingTracks) {
    let tracks;
    attemptedCount++;
    try {
      tracks = await fetchAlbumTracks(server.url, server.username, credential, album.id, altUrl);
      consecutiveFailures = 0;
    } catch (err) {
      if (err instanceof TransportStalledError) {
        console.error(`sync: stopping the album pass early, the connection is paused: ${err.message}`);
        albumTracksIncomplete = true;
        break;
      }
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
    // Only worth a query for an album that already had rows: on a first sync
    // there is nothing to carry or prune and this would be wasted round trips per album.
    if (existingTrackCount > 0) {
      const remaps = await planRenamedTracks(db, server.id, albumDbId, tracks);
      // Collected whatever the carry reported: an id the carry declined keeps its own track
      // row, which the prune then takes along with its FTS row, so clearing it here early is
      // at worst a no-op and never leaves one behind.
      for (const remap of remaps) renamedTrackIds.push(remap.oldId);
      remappedTracks += await carryRenamedTracks(albumDbId, remaps);
    }
    await insertTracksBatch(db, server.id, server.type, albumDbId, tracks);
    if (existingTrackCount > 0) {
      prunedTracks += await pruneAlbumTracks(
        db,
        albumDbId,
        tracks.map((t) => `${server.id}:${t.id}`)
      );
    }
    fetchedCount++;
    readAlbumIds.push(albumDbId);
    ftsDirtyAlbumIds.add(albumDbId);
    if (fetchedCount === 1 || fetchedCount % BATCH_NOTIFY_INTERVAL === 0) {
      reportProgress(attemptedCount);
    }
  }

  // Written after the loop, early break included, since progress kept only by a pass that
  // completed is the livelock this column exists to break.
  if (passIdentity !== null) {
    const chunkSize = SQLITE_MAX_VARIABLES - 1;
    for (let start = 0; start < readAlbumIds.length; start += chunkSize) {
      const chunk = readAlbumIds.slice(start, start + chunkSize);
      await db.execute(
        `UPDATE albums SET tracks_read_scan = ? WHERE id IN (${chunk.map(() => "?").join(", ")})`,
        [passIdentity, ...chunk]
      );
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
  await rebuildTracksFts(db, [...ftsDirtyAlbumIds], renamedTrackIds);

  const stage = { db, server, credential, altUrl, skippedStages };
  const lovedChanged = await syncLoved(stage);
  const { failedPlaylists, playlistsChanged } = await syncPlaylists(stage);

  // Only a pass that actually finished may move the watermark: storing it after a run that
  // broke early or lost albums to failures would tell the next sync those albums were read
  // when they were not, and the evidence that they need re-reading is gone.
  if (scanStatus !== null && serverIdentityMoved && !albumTracksIncomplete && failedAlbums === 0) {
    await db.execute(
      "UPDATE servers SET last_scan_at = ?, server_version = ?, song_count = ? WHERE id = ?",
      [scanStatus.lastScan, scanStatus.serverVersion, scanStatus.songCount, server.id]
    );
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
    remappedTracks,
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
