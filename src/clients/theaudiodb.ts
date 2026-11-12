import { normalizeForMatch } from "../features/enrichment/lib/fuzzyMatch";
import { boundedNativeFetch } from "./boundedFetch";

// TheAudioDB's free public key; the older key 2 was retired and answers 404 to every query.
const THEAUDIODB_PUBLIC_KEY = "123";

interface TheAudioDbArtist {
  strArtist?: string;
  strBiographyEN?: string;
  strArtistThumb?: string;
}

interface TheAudioDbResponse {
  artists: TheAudioDbArtist[] | null;
}

/** Rejects when TheAudioDB didn't answer, so a missing portrait isn't taken as "there is none". */
async function searchTheAudioDb(name: string): Promise<TheAudioDbArtist | null> {
  const res = await boundedNativeFetch(
    `https://www.theaudiodb.com/api/v1/json/${THEAUDIODB_PUBLIC_KEY}/search.php?s=${encodeURIComponent(name)}`,
    {
      method: "GET",
      headers: { "User-Agent": "Canon Music Player" },
    },
  );
  if (!res.ok) throw new Error(`TheAudioDB returned ${res.status}`);
  const data = (await res.json()) as TheAudioDbResponse;
  const wanted = normalizeForMatch(name);
  // The search matches loosely, so its first hit can be a different artist.
  return (
    data?.artists?.find(
      (artist) => typeof artist.strArtist === "string" && normalizeForMatch(artist.strArtist) === wanted,
    ) ?? null
  );
}

export async function fetchTheAudioDbArtist(name: string): Promise<{ bio: string | null; thumbUrl: string | null }> {
  let artist = await searchTheAudioDb(name);
  // Strip leading "The " if no result
  if (!artist && name.toLowerCase().startsWith("the ")) {
    artist = await searchTheAudioDb(name.slice(4));
  }
  return {
    bio: artist?.strBiographyEN?.trim() || null,
    thumbUrl: artist?.strArtistThumb?.trim() || null,
  };
}
