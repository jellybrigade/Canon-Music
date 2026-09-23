import { fetchPlaylists, fetchPlaylistTracks } from "../../clients/navidromePlaylists";
import { executeBatched, executeIdChunks } from "../../lib/dbBatch";
import { runPool } from "../../lib/asyncPool";
import { TransportStalledError } from "../../lib/transportHealth";
import type { SyncStageContext } from "./syncStage";

// Sync playlists, collect all track lists before deleting to avoid wipe on partial failure.
// Non-fatal for the same reason as the loved pass (syncLoved.ts): albums and tracks are already
// committed, so a failed playlist listing skips this pass instead of throwing away the
// whole sync.
export async function syncPlaylists(
  { db, server, credential, altUrl, skippedStages }: SyncStageContext,
): Promise<{ failedPlaylists: number; playlistsChanged: boolean }> {
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
        if (!(err instanceof TransportStalledError)) failedPlaylists++;
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

  return { failedPlaylists, playlistsChanged };
}
