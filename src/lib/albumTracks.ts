import { getDb } from "../db";
import type { NavidromeCredential } from "../clients/navidrome";
import type { Server } from "../types/server";
import { syncAlbumTracks } from "../features/sync/sync";
import { useAlbumTracksNoticeStore } from "../store/albumTracksNotice";

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
// Albums the server itself listed as empty. Remembered so a click does not re-fetch them
// every time; only the album page's explicit re-check goes to the server again.
const reportedEmpty = new Set<string>();

export function resetAlbumTrackFetches(): void {
  inFlight.clear();
  reportedEmpty.clear();
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
 * Pull the album's tracks from the server, sharing any fetch already running for it.
 */
export function fetchAlbumTracks(
  server: Server,
  credential: NavidromeCredential,
  albumDbId: string
): Promise<void> {
  reportedEmpty.delete(albumDbId);
  let fetch = inFlight.get(albumDbId);
  if (!fetch) {
    fetch = syncAlbumTracks(server, credential, albumDbId)
      .then(async () => {
        if ((await readMirrored(albumDbId, server.id)).length === 0) reportedEmpty.add(albumDbId);
      })
      .finally(() => {
        inFlight.delete(albumDbId);
      });
    inFlight.set(albumDbId, fetch);
  }
  return fetch;
}

/**
 * The album's tracks, fetching them from the server if the mirror holds none.
 *
 * A sync that stopped short leaves albums with no track rows at all, and every play path
 * used to return silently on that empty list: the user clicked play and nothing happened,
 * with no way to tell it apart from a broken button. One fetch only - an album the server
 * itself reports as empty must not re-fetch on every click.
 */
export async function loadAlbumTracks(
  server: Server,
  credential: NavidromeCredential,
  albumDbId: string
): Promise<AlbumTrackRow[]> {
  const mirrored = await readMirrored(albumDbId, server.id);
  if (mirrored.length > 0 || reportedEmpty.has(albumDbId)) return mirrored;

  await fetchAlbumTracks(server, credential, albumDbId);
  return await readMirrored(albumDbId, server.id);
}

/**
 * `loadAlbumTracks` for a play, queue or radio click. Every way that ends with nothing to
 * play is reported to the user, since the click itself gives no other sign.
 */
export async function loadAlbumTracksForPlay(
  server: Server,
  credential: NavidromeCredential,
  album: { id: string; name: string }
): Promise<AlbumTrackRow[]> {
  const { report } = useAlbumTracksNoticeStore.getState();
  try {
    const tracks = await loadAlbumTracks(server, credential, album.id);
    if (tracks.length === 0) report(`The server lists no tracks for ${album.name}`);
    return tracks;
  } catch (err) {
    console.error("loadAlbumTracksForPlay: fetch failed", err);
    report(`Couldn't get the tracks for ${album.name}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
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
