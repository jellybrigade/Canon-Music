import { fetchArtistInfo, type LastfmArtistInfo } from "../../../clients/lastfm";
import { fetchListenBrainzArtistPopularity } from "../../../clients/listenbrainz";
import { fallbackSimilarArtists } from "./similarArtists";

export interface ListenBrainzCounts {
  listens: number | null;
}

export interface ArtistListening {
  info: LastfmArtistInfo;
  /** null when every source failed: keep what's stored. */
  similar: string[] | null;
  /** null when ListenBrainz failed: keep what's stored. A null count when not asked. */
  listenBrainz: ListenBrainzCounts | null;
  /** False when a source failed, so the artist stays due for another try. */
  isComplete: boolean;
}

/** The stored form: null for none, and for unread, which the writers leave as stored. */
export function similarJson(similar: string[] | null): string | null {
  return similar !== null && similar.length > 0 ? JSON.stringify(similar) : null;
}

const NOT_ASKED: ListenBrainzCounts = { listens: null };

async function fallbackSimilarNames(artistName: string, mbid: string | null): Promise<string[] | null> {
  return (await fallbackSimilarArtists(artistName, mbid))?.map((artist) => artist.name) ?? null;
}

async function listenBrainzCounts(mbid: string): Promise<ListenBrainzCounts | null> {
  try {
    const [counts] = await fetchListenBrainzArtistPopularity([mbid]);
    return { listens: counts?.listenCount ?? null };
  } catch (err) {
    console.warn("ListenBrainz listen counts failed for:", mbid, err);
    return null;
  }
}

/** Last.fm's artist info, with no-key sources standing in for its similar artists and stats.
 *  Rejects only when Last.fm itself didn't answer. */
export async function fetchArtistListening({
  artistName,
  lastfmName,
  mbid,
}: {
  artistName: string;
  lastfmName: string;
  mbid: string | null;
}): Promise<ArtistListening> {
  const info = await fetchArtistInfo(lastfmName);
  const [similar, listenBrainz] = await Promise.all([
    info.similar.length > 0 ? Promise.resolve(info.similar) : fallbackSimilarNames(artistName, mbid),
    info.listeners === null && mbid !== null ? listenBrainzCounts(mbid) : Promise.resolve(NOT_ASKED),
  ]);
  return { info, similar, listenBrainz, isComplete: similar !== null && listenBrainz !== null };
}
