import { fetchDeezerRelatedArtists } from "../../../clients/deezer";
import { fetchSimilarArtistsFull, type SimilarArtistEntry } from "../../../clients/lastfm";
import { fetchListenBrainzSimilarArtists } from "../../../clients/listenbrainz";
import { getDb } from "../../../db";
import { readSignalCache, writeSignalCache } from "../../../db/radioSignalCache";
import { findDeezerArtist } from "./deezerArtist";

// Last.fm's getSimilar asks for 50; ListenBrainz lists up to 100.
const MAX_SIMILAR_ARTISTS = 50;

/** Deezer gives an order and no score: first scores 1, the rest step down evenly. */
function scoresByOrder(names: string[]): SimilarArtistEntry[] {
  return names.map((name, index) => ({ name, match: (names.length - index) / names.length }));
}

/** ListenBrainz scores are session counts on no fixed scale; the best one scores 1. */
function scoresFromBest(artists: { name: string; score: number }[]): SimilarArtistEntry[] {
  const best = artists[0]?.score ?? 0;
  if (best <= 0) return scoresByOrder(artists.map((artist) => artist.name));
  return artists.map(({ name, score }) => ({ name, match: score / best }));
}

async function deezerRelatedArtists(artistName: string): Promise<string[]> {
  const artist = await findDeezerArtist(artistName);
  if (artist === null) return [];
  return (await fetchDeezerRelatedArtists(artist.id)).map((related) => related.name);
}

/** Similar artists when Last.fm has none: ListenBrainz by MBID, then Deezer by name. Null unless a source
 *  gave some or every source asked answered. */
export async function fallbackSimilarArtists(
  artistName: string,
  mbid: string | null,
): Promise<SimilarArtistEntry[] | null> {
  let hasListenBrainzFailed = false;
  if (mbid !== null) {
    try {
      const similar = await fetchListenBrainzSimilarArtists(mbid);
      if (similar.length > 0) return scoresFromBest(similar.slice(0, MAX_SIMILAR_ARTISTS));
    } catch (err) {
      console.warn("ListenBrainz similar artists failed for:", artistName, err);
      hasListenBrainzFailed = true;
    }
  }
  try {
    const related = await deezerRelatedArtists(artistName);
    if (related.length === 0 && hasListenBrainzFailed) return null;
    return scoresByOrder(related.slice(0, MAX_SIMILAR_ARTISTS));
  } catch (err) {
    console.warn("Deezer related artists failed for:", artistName, err);
    return null;
  }
}

async function storedArtistMbid(artistName: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ mb_artist_id: string }[]>(
    "SELECT mb_artist_id FROM artist_identity WHERE artist_name = ? AND mb_artist_id IS NOT NULL",
    [artistName],
  );
  return rows[0]?.mb_artist_id ?? null;
}

/** Similar artists scored 0..1, best first: Last.fm's, else ListenBrainz's or Deezer's. Empty when none
 *  is known or every source failed; only an answer is remembered. */
export async function fetchSimilarArtistScores(artistName: string): Promise<SimilarArtistEntry[]> {
  const lastfm = await fetchSimilarArtistsFull(artistName);
  if (lastfm.length > 0) return lastfm;
  const cacheKey = `similar-artists.fallback:${artistName.toLowerCase()}`;
  const cached = await readSignalCache<SimilarArtistEntry[]>(cacheKey);
  if (cached !== null) return cached;
  const fallback = await fallbackSimilarArtists(artistName, await storedArtistMbid(artistName));
  if (fallback === null) return [];
  await writeSignalCache(cacheKey, fallback);
  return fallback;
}
