import { normalizeForMatch, stripTrailingBrackets } from "../../enrichment/lib/fuzzyMatch";
import { isSameArtist } from "../../releaseDates/lib/releaseMatch";

function albumKey(title: string): string {
  return normalizeForMatch(stripTrailingBrackets(title) ?? title);
}

/** A source's release by the same artist under the same title; editions share their artwork, so brackets don't count. */
export function isSameCoverAlbum(artist: string, album: string, hit: { artistName: string; title: string }): boolean {
  return isSameArtist(artist, hit.artistName) && albumKey(hit.title) === albumKey(album);
}
