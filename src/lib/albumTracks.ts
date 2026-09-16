import { getDb } from "../db";
import type { NavidromeCredential } from "./navidrome";
import type { Server } from "../types/server";
import { syncAlbumTracks } from "./sync";

export interface AlbumTrackRow {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
}

// One fetch per album, however many callers ask: an album grid click and the detail view
// opening behind it are two callers on one miss, and both would otherwise pull the same
// track list over the network. Cleared on the failure side too, or one lost connection
// leaves the album permanently unfetchable for the life of the process.
const inFlight = new Map<string, Promise<void>>();

export function resetAlbumTrackFetches(): void {
  inFlight.clear();
}

async function readMirrored(albumDbId: string, serverId: string): Promise<AlbumTrackRow[]> {
  const db = await getDb();
  return await db.select<AlbumTrackRow[]>(
    `SELECT id, title, artist, duration
     FROM tracks WHERE album_id = ? AND server_id = ?
     ORDER BY disc_number, track_number`,
    [albumDbId, serverId]
  );
}

/**
 * The album's tracks, fetching them from the server if the mirror holds none.
 *
 * A sync that stopped short leaves albums with no track rows at all, and every play path
 * used to return silently on that empty list: the user clicked play and nothing happened,
 * with no way to tell it apart from a broken button. One retry only - an album the server
 * itself reports as empty must not re-fetch on every click.
 */
export async function loadAlbumTracks(
  server: Server,
  credential: NavidromeCredential,
  albumDbId: string
): Promise<AlbumTrackRow[]> {
  const mirrored = await readMirrored(albumDbId, server.id);
  if (mirrored.length > 0) return mirrored;

  let fetch = inFlight.get(albumDbId);
  if (!fetch) {
    fetch = syncAlbumTracks(server, credential, albumDbId).finally(() => {
      inFlight.delete(albumDbId);
    });
    inFlight.set(albumDbId, fetch);
  }
  await fetch;
  return await readMirrored(albumDbId, server.id);
}

/**
 * Whether opening an album should pull its tracks from the server.
 *
 * Only once the read has actually landed: `undefined` is "not known yet" and firing on it
 * would fetch every album the moment it opens. `attemptedAlbumId` is an album id rather
 * than a flag because the view stays mounted while the user walks between albums, and the
 * fetch writes the rows the caller is watching, so an unkeyed guard either re-fires forever
 * or blocks the second album outright.
 */
export function shouldFetchMissingTracks(state: {
  isLoading: boolean;
  error: unknown;
  tracks: { length: number } | undefined;
  albumId: string;
  attemptedAlbumId: string | null;
}): boolean {
  if (state.isLoading || state.error) return false;
  if (state.tracks === undefined || state.tracks.length > 0) return false;
  return state.attemptedAlbumId !== state.albumId;
}
