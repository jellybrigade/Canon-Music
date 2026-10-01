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

// Loved state via getStarred2; unchanged lists write nothing. Non-fatal: a fetch failure
// skips the pass rather than letting the delete-first write run on no data.
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

    // Scoped by id prefix, matching the unscoped write below; a join-scoped read missed
    // starred ids with no local row and rewrote loved state every sync.
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
