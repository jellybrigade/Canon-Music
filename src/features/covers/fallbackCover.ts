import { searchDeezerAlbums } from "../../clients/deezer";
import { fetchItunesCoverArt } from "../../clients/itunes";
import { cappedSet } from "../../lib/boundedCache";
import { isSameCoverAlbum } from "./lib/coverMatch";

const MAX_CACHE_ENTRIES = 2000;
// Kept in memory only: Deezer's terms forbid storing its images.
const answers = new Map<string, string | null>();

async function deezerCover(artist: string, album: string): Promise<string | null> {
  const hits = await searchDeezerAlbums(artist, album);
  return hits.find((hit) => hit.coverUrl !== null && isSameCoverAlbum(artist, album, hit))?.coverUrl ?? null;
}

/**
 * A cover for an album whose own image broke: Deezer's, else iTunes'. Resolves null only when both
 * answered without one; rejects when a source failed and none had a cover, so nothing is kept.
 */
export async function fetchFallbackCover(artist: string | null, album: string | null): Promise<string | null> {
  if (!artist || !album) return null;
  const key = `${artist}\x00${album}`;
  if (answers.has(key)) return answers.get(key) ?? null;
  let failure: unknown = null;
  let url = await deezerCover(artist, album).catch((error: unknown) => {
    failure = error;
    return null;
  });
  if (url === null) {
    url = await fetchItunesCoverArt(artist, album).catch((error: unknown) => {
      failure = error;
      return null;
    });
  }
  if (url === null && failure !== null) throw failure;
  cappedSet(answers, key, url, MAX_CACHE_ENTRIES);
  return url;
}
