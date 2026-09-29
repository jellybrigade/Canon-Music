import Database from "@tauri-apps/plugin-sql";
import type { Server } from "../../types/server";
import { songExists } from "../../clients/navidrome";
import type { NavidromeScanStatus } from "../../clients/navidrome";
import type { NavidromeCredential } from "../../clients/navidromeUrls";

// How many mirrored track ids the skip fast-path checks against the server per sync.
const TRACK_ID_PROBE_COUNT = 3;

/** The server identity stored after the last sync that completed its track pass. */
export interface ServerWatermark {
  last_scan_at: string | null;
  server_version: string | null;
  song_count: number | null;
}

/**
 * Probe a few random mirrored track ids, since album metadata can't reveal a track-id rewrite.
 * Only Subsonic "not found" counts as a miss; transport or credential failures say nothing.
 */
export async function mirroredTrackIdsStillResolve(
  db: Database,
  server: Server,
  credential: NavidromeCredential,
  altUrl: string | undefined,
): Promise<boolean> {
  const sampled = await db.select<{ id: string }[]>(
    "SELECT id FROM tracks WHERE server_id = ? ORDER BY RANDOM() LIMIT ?",
    [server.id, TRACK_ID_PROBE_COUNT]
  );
  if (sampled.length === 0) return true;
  const verdicts = await Promise.all(
    sampled.map((row) =>
      songExists(server.url, server.username, credential, row.id.slice(server.id.length + 1), altUrl)
    )
  );
  return !verdicts.includes(false);
}

/** One string for "the server as it was when these tracks were read", compared per album. */
export function scanIdentity(status: NavidromeScanStatus): string {
  return JSON.stringify([status.serverVersion, status.lastScan, status.songCount]);
}

/** Whether the server's own identity moved since the last completed track pass. */
export function watermarkMoved(stored: ServerWatermark | undefined, status: NavidromeScanStatus | null): boolean {
  if (status === null) return false;
  if (stored === undefined) return true;
  return (
    !sameValue(stored.server_version, status.serverVersion) ||
    !sameValue(stored.last_scan_at, status.lastScan) ||
    !sameValue(stored.song_count, status.songCount)
  );
}

/**
 * Forget the last-sync watermark so the next sync reads every album's tracks. Expensive
 * (one request per album); only the user-triggered resync calls it.
 */
export async function clearSyncWatermark(db: Database, serverId: string): Promise<void> {
  await db.execute(
    "UPDATE servers SET last_scan_at = NULL, server_version = NULL, song_count = NULL WHERE id = ?",
    [serverId]
  );
  // Progress stamps from earlier passes would otherwise let an interrupted resync be resumed
  // as though the albums read before it were part of it.
  await db.execute("UPDATE albums SET tracks_read_scan = NULL WHERE server_id = ?", [serverId]);
}

// Compare a fetched value against the DB's version loosely: SQLite hands back
// numbers where the API may hand back strings (year, play_count), and null and
// "" are interchangeable for these columns.
export function sameValue(a: unknown, b: unknown): boolean {
  return String(a ?? "") === String(b ?? "");
}
