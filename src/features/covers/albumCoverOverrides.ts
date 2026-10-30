import { invoke } from "@tauri-apps/api/core";
import { albumKeyOfCoverId, replaceCoverRevisions, setCoverRevision } from "../../clients/navidromeUrls";
import { getDb } from "../../db";
import { stripServerPrefix } from "../../lib/ids";
import type { AlbumRow } from "../../types/library";

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

function albumKey({ serverId, albumId }: AlbumRef): string {
  return stripServerPrefix(albumId, serverId);
}

/** A chosen cover is served in place of the album's own cover id, so an album without one can't show it. */
export function canChooseCover(album: Pick<AlbumRow, "id" | "server_id" | "artwork_url">): boolean {
  return (
    album.artwork_url != null &&
    albumKeyOfCoverId(album.artwork_url) === albumKey({ serverId: album.server_id, albumId: album.id })
  );
}

// The stored accent was read from the cover just replaced; a null one is read again from the new.
async function forgetAccent({ serverId, albumId }: AlbumRef): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE albums SET accent_color = NULL WHERE id = ? AND server_id = ?", [albumId, serverId]);
}

// Loading sweeps every image no row names, so it must never run between a save and its row.
let overrideWork: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const result = overrideWork.then(work, work);
  overrideWork = result.catch(() => {});
  return result;
}

/** Hands Rust the stored choices (it deletes images no row names) and marks the active server's cover URLs. */
export function loadCoverOverrides(activeServerId: string | null): Promise<void> {
  return oneAtATime(async () => {
    const db = await getDb();
    const rows = await db.select<{ server_id: string; album_id: string; chosen_at: number }[]>(
      "SELECT server_id, album_id, chosen_at FROM album_cover_overrides ORDER BY server_id, album_id",
    );
    await invoke("sync_cover_overrides", {
      activeServerId,
      rows: rows.map((row) => ({ serverId: row.server_id, albumId: row.album_id, revision: row.chosen_at })),
    });
    replaceCoverRevisions(
      new Map(
        rows
          .filter((row) => row.server_id === activeServerId)
          .map((row) => [albumKey({ serverId: row.server_id, albumId: row.album_id }), row.chosen_at]),
      ),
    );
  });
}

export function chooseAlbumCover({
  serverId,
  albumId,
  choice,
  now = Date.now(),
}: AlbumRef & { choice: CoverChoice; now?: number }): Promise<void> {
  return oneAtATime(async () => {
    const file = { serverId, albumId, revision: now };
    const mime = await invoke<string>("save_album_cover_override", { ...file, url: choice.fullUrl });
    try {
      const db = await getDb();
      await db.execute(
        `INSERT OR REPLACE INTO album_cover_overrides
           (server_id, album_id, source, source_ref, full_url, width, height, mime, chosen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [serverId, albumId, choice.source, choice.sourceRef, choice.fullUrl, choice.width, choice.height, mime, now],
      );
    } catch (err) {
      await invoke("discard_album_cover_file", file).catch(() => {});
      throw err;
    }
    await invoke("use_album_cover_override", file);
    setCoverRevision(albumKey({ serverId, albumId }), now);
    await forgetAccent({ serverId, albumId });
  });
}

export function clearAlbumCover({ serverId, albumId }: AlbumRef): Promise<void> {
  return oneAtATime(async () => {
    const db = await getDb();
    await db.execute("DELETE FROM album_cover_overrides WHERE server_id = ? AND album_id = ?", [serverId, albumId]);
    await invoke("clear_album_cover_override", { serverId, albumId });
    setCoverRevision(albumKey({ serverId, albumId }), null);
    await forgetAccent({ serverId, albumId });
  });
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
