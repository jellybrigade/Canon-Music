import { getDb } from "../db";
import { escapeLike } from "./sql";
import { fetchArtistTopTracks, fetchSimilarArtists } from "./lastfm";
import type { AlbumRow } from "../types/library";

/**
 * Queries backing the now-playing overlay's About tab.
 *
 * These live here rather than beside either consumer because there are two: the tab itself
 * and `useNowPlayingPrefetch`, which warms the same React Query keys when the track changes.
 * Held separately they drifted, and a prefetch that runs different SQL under the same key is
 * worse than no prefetch at all. The key derivation (`primaryArtistOf`) is exported for the
 * same reason: the two sides have to agree on the artist name or the warmed entry is never read.
 */

export interface NowPlayingTrack {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  album_name: string | null;
  album_id: string | null;
  artwork_url: string | null;
}

/** Local-SQLite reads only, so an artist's discography stays warm for the session. */
export const NOW_PLAYING_STALE_TIME = 30 * 60 * 1000;
/** Suggestions are randomised per track, so a shorter window keeps them from feeling stuck. */
export const SUGGESTED_STALE_TIME = 5 * 60 * 1000;

const TRACK_COLUMNS = `t.id, t.title, t.artist, t.duration, a.name AS album_name,
          t.album_id, a.artwork_url`;

/**
 * "Burial feat. Four Tet" -> "Burial". The About tab is about the artist, not the collaboration,
 * and Last.fm has no entry for the joined name.
 */
export function primaryArtistOf(artist: string | null | undefined): string | null {
  if (!artist) return null;
  return artist.match(/^(.+?)\s+(?:feat\.|ft\.|featuring)\s+/i)?.[1] ?? artist;
}

export async function fetchArtistAlbums(artistName: string, serverId: string): Promise<AlbumRow[]> {
  const db = await getDb();
  return db.select<AlbumRow[]>(
    `SELECT id, server_id, name, artist, year, artwork_url
     FROM albums WHERE server_id = ? AND artist = ?
     ORDER BY year IS NULL, year DESC, name`,
    [serverId, artistName]
  );
}

/**
 * Last.fm's global popularity ranking, intersected with what the library actually holds.
 * Falls back to local track order when Last.fm has nothing or none of it matches.
 */
export async function fetchArtistTopTracksForNowPlaying(
  artistName: string,
  serverId: string
): Promise<NowPlayingTrack[]> {
  const db = await getDb();
  const like = escapeLike(artistName);
  const featParams = [serverId, artistName, `${like} feat.%`, `${like} ft.%`, `${like} featuring %`];
  // The name match is an OR group, so the server scope has to bracket it or the first
  // alternative alone carries the AND and the three feat. variants stay library-wide.
  const artistMatch = `t.server_id = ?
       AND (t.artist = ?
       OR t.artist LIKE ? ESCAPE '\\'
       OR t.artist LIKE ? ESCAPE '\\'
       OR t.artist LIKE ? ESCAPE '\\')`;

  const trackNames = await fetchArtistTopTracks(artistName).catch(() => []);
  if (trackNames.length > 0) {
    const localTracks = await db.select<NowPlayingTrack[]>(
      `SELECT ${TRACK_COLUMNS}
       FROM tracks t LEFT JOIN albums a ON t.album_id = a.id
       WHERE ${artistMatch}`,
      featParams
    );
    const byTitle = new Map(localTracks.map((t) => [t.title.toLowerCase(), t]));
    const matched: NowPlayingTrack[] = [];
    const seen = new Set<string>();
    for (const { name } of trackNames) {
      const track = byTitle.get(name.toLowerCase());
      if (track && !seen.has(track.id)) {
        seen.add(track.id);
        matched.push(track);
        if (matched.length >= 10) break;
      }
    }
    if (matched.length > 0) return matched;
  }

  return db.select<NowPlayingTrack[]>(
    `SELECT ${TRACK_COLUMNS}
     FROM tracks t LEFT JOIN albums a ON t.album_id = a.id
     WHERE ${artistMatch}
     ORDER BY t.track_number, t.title
     LIMIT 10`,
    featParams
  );
}

export async function fetchSuggestedTracksForNowPlaying(
  artistName: string,
  currentTrackId: string | null,
  serverId: string
): Promise<NowPlayingTrack[]> {
  const similarArtists = await fetchSimilarArtists(artistName).catch(() => []);
  if (similarArtists.length === 0) return [];
  const db = await getDb();
  const placeholders = similarArtists.map(() => "?").join(", ");
  return db.select<NowPlayingTrack[]>(
    `SELECT ${TRACK_COLUMNS}
     FROM tracks t LEFT JOIN albums a ON t.album_id = a.id
     WHERE t.server_id = ?
       AND t.artist IN (${placeholders})
       AND t.id != ?
     ORDER BY random()
     LIMIT 10`,
    [serverId, ...similarArtists, currentTrackId ?? ""]
  );
}
