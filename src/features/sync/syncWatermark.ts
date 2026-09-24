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
 * Whether the mirrored track ids are still ids the server answers to.
 *
 * Album metadata is evidence about albums. Navidrome 0.64 rewrote ~87% of track ids while
 * leaving every album row byte-identical, so the sync's per-album skip matched for all 1512
 * albums and the mirror could never heal, on any number of syncs. A few ids drawn at random
 * are cheap and answer the question the skip is actually asking.
 *
 * Only a Subsonic "not found" counts against the mirror: a transport failure or a rejected
 * credential says nothing about the id, and treating it as a miss would turn every offline
 * moment into a 1500-request full pass.
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
 * Forget what the server looked like at the last completed sync, so the next one reads every
 * album's tracks instead of trusting the per-album skip.
 *
 * The user-facing escape hatch for a mirror that is wrong in a way no probe caught: expensive
 * (one track request per album, 1500+ on a real library), which is why nothing calls it on its
 * own. See `watermarkMoved`.
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
