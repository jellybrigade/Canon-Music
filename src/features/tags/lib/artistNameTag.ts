import { canonicalKey } from "./canonicalize";

/** Last.fm users tag tracks with the artist's name; such a tag is never a genre ("sting" fuzzy-matched Swing). */
export function isArtistNameTag(raw: string, artistNames: readonly (string | null | undefined)[]): boolean {
  const key = canonicalKey(raw);
  if (key === "") return false;
  return artistNames.some((name) => name != null && canonicalKey(name) === key);
}
