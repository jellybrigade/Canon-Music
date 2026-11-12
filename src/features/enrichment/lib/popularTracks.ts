import { fetchDeezerArtistTopTracks } from "../../../clients/deezer";
import { fetchArtistTopTracks } from "../../../clients/lastfm";
import { findDeezerArtist } from "./deezerArtist";

export interface PopularTrack {
  title: string;
  /** Last.fm's play count; Deezer gives none. */
  playcount: number | null;
  /** The release the source counts the plays under, when it says. */
  albumTitle: string | null;
}

export interface PopularTrackRanking {
  source: "lastfm" | "deezer";
  tracks: PopularTrack[];
}

async function deezerRanking(artistName: string): Promise<PopularTrack[]> {
  const artist = await findDeezerArtist(artistName);
  if (artist === null) return [];
  return (await fetchDeezerArtistTopTracks(artist.id)).map(({ title, albumTitle }) => ({
    title,
    playcount: null,
    albumTitle,
  }));
}

/** The artist's tracks most popular first: Last.fm's, else Deezer's. Rejects unless an empty
 *  ranking is every source's answer. */
export async function fetchPopularTrackRanking({
  artistName,
  lastfmName,
}: {
  artistName: string;
  lastfmName: string;
}): Promise<PopularTrackRanking> {
  let lastfmFailure: unknown = null;
  try {
    const lastfm = await fetchArtistTopTracks(lastfmName);
    if (lastfm.length > 0) {
      return {
        source: "lastfm",
        tracks: lastfm.map(({ name, playcount }) => ({ title: name, playcount, albumTitle: null })),
      };
    }
  } catch (err) {
    lastfmFailure = err;
  }
  const tracks = await deezerRanking(artistName);
  if (tracks.length === 0 && lastfmFailure !== null) throw lastfmFailure;
  return { source: "deezer", tracks };
}
