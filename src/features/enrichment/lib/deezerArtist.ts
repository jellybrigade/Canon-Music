import { type DeezerArtist, searchDeezerArtists } from "../../../clients/deezer";
import { isSameArtist } from "../../releaseDates/lib/releaseMatch";

/** The one Deezer artist by that name; null when there's none, or two and no telling which. */
export async function findDeezerArtist(artistName: string): Promise<DeezerArtist | null> {
  const sameName = (await searchDeezerArtists(artistName)).filter((artist) => isSameArtist(artistName, artist.name));
  const [only] = sameName;
  return sameName.length === 1 && only !== undefined ? only : null;
}
