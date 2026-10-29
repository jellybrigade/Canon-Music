import { invoke } from "@tauri-apps/api/core";
import { replaceCoverRevisions, setCoverRevision } from "../../clients/navidromeUrls";
import { getDb } from "../../db";

/** The image the user picked, as the picker found it. */
export interface CoverChoice {
  source: string;
  sourceRef: string | null;
  fullUrl: string;
  width: number | null;
  height: number | null;
}

interface AlbumRef {
  serverId: string;
  albumId: string;
}

/** Album ids are `{server_id}:{navidrome id}`; cover ids name only the latter. */
function albumKey({ serverId, albumId }: AlbumRef): string {
  const prefix = `${serverId}:`;
  return albumId.startsWith(prefix) ? albumId.slice(prefix.length) : albumId;
}

/** Hands Rust the stored choices (it deletes images no row names) and marks the active server's cover URLs. */
export async function loadCoverOverrides(activeServerId: string | null): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ server_id: string; album_id: string; chosen_at: number }[]>(
    "SELECT server_id, album_id, chosen_at FROM album_cover_overrides ORDER BY server_id, album_id",
  );
  await invoke("sync_cover_overrides", {
    activeServerId,
    rows: rows.map((row) => ({ serverId: row.server_id, albumId: row.album_id })),
  });
  replaceCoverRevisions(
    new Map(
      rows
        .filter((row) => row.server_id === activeServerId)
        .map((row) => [albumKey({ serverId: row.server_id, albumId: row.album_id }), row.chosen_at]),
    ),
  );
}

export async function chooseAlbumCover({
  serverId,
  albumId,
  choice,
  now = Date.now(),
}: AlbumRef & { choice: CoverChoice; now?: number }): Promise<void> {
  const mime = await invoke<string>("save_album_cover_override", { serverId, albumId, url: choice.fullUrl });
  try {
    const db = await getDb();
    await db.execute(
      `INSERT OR REPLACE INTO album_cover_overrides
         (server_id, album_id, source, source_ref, full_url, width, height, mime, chosen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [serverId, albumId, choice.source, choice.sourceRef, choice.fullUrl, choice.width, choice.height, mime, now],
    );
  } catch (err) {
    // An image with no row would be served this session and swept at the next start.
    await invoke("clear_album_cover_override", { serverId, albumId }).catch(() => {});
    throw err;
  }
  setCoverRevision(albumKey({ serverId, albumId }), now);
}

export async function clearAlbumCover({ serverId, albumId }: AlbumRef): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM album_cover_overrides WHERE server_id = ? AND album_id = ?", [serverId, albumId]);
  await invoke("clear_album_cover_override", { serverId, albumId });
  setCoverRevision(albumKey({ serverId, albumId }), null);
}

export async function getAlbumCoverOverride({ serverId, albumId }: AlbumRef): Promise<CoverChoice | null> {
  const db = await getDb();
  const rows = await db.select<
    { source: string; source_ref: string | null; full_url: string; width: number | null; height: number | null }[]
  >(
    "SELECT source, source_ref, full_url, width, height FROM album_cover_overrides WHERE server_id = ? AND album_id = ?",
    [serverId, albumId],
  );
  const row = rows[0];
  return row
    ? { source: row.source, sourceRef: row.source_ref, fullUrl: row.full_url, width: row.width, height: row.height }
    : null;
}
