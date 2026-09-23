import Database from "@tauri-apps/plugin-sql";
import { fetchStarred2 } from "../../clients/navidrome";
import { escapeLike } from "../../lib/sql";
import { executeBatched } from "../../lib/dbBatch";
import type { SyncStageContext } from "./syncStage";

async function insertIdColumnBatch(db: Database, table: string, column: string, ids: string[]): Promise<void> {
  await executeBatched(
    db,
    ids.map((id) => [id]),
    "(?)",
    1,
    (placeholders) => `INSERT OR IGNORE INTO ${table} (${column}) VALUES ${placeholders}`
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
export async function syncLoved({ db, server, credential, altUrl, skippedStages }: SyncStageContext): Promise<boolean> {
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

  return lovedChanged;
}
