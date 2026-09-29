import { getDb } from "../db";
import type { NavidromeCredential } from "../clients/navidromeUrls";
import type { Server } from "../types/server";
import { syncAlbumTracks } from "../features/sync/syncTracks";
import { useAlbumTracksNoticeStore } from "../store/albumTracksNotice";
import { REPLAY_GAIN_COLUMNS, type ReplayGainColumns } from "./replayGainRow";

export interface AlbumTrackRow extends ReplayGainColumns {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
}

// One fetch per album however many callers ask (grid click and detail view opening behind it
// are two callers on one miss); cleared on the failure side too, or a lost connection strands the album.
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
    `SELECT t.id, t.title, t.artist, t.duration, ${REPLAY_GAIN_COLUMNS}
     FROM tracks t WHERE t.album_id = ? AND t.server_id = ?
     ORDER BY t.disc_number, t.track_number`,
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
 * The album's tracks, fetching once if the mirror holds none, so play never silently no-ops.
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

/** `loadAlbumTracks` for a play, queue or radio click; every way to end with nothing to play is reported. */
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

/** Whether opening an album should fetch its tracks; `attemptedAlbumId` is keyed by album since the view stays mounted across albums. */
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
