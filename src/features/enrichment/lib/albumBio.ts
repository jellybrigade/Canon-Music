import { fetchAlbumInfo, type LastfmAlbumInfo } from "../../../clients/lastfm";
import { fetchReleaseGroupWikidataId } from "../../../clients/musicbrainz";
import {
  fetchWikipediaSummaryText,
  fetchWikipediaTitleByReleaseGroup,
  fetchWikipediaTitleByWikidataId,
} from "../../../clients/wikipedia";

export interface AlbumBioLookup {
  artist: string;
  album: string;
  /** The album's MusicBrainz match; without one only Last.fm is asked. */
  releaseGroupMbid: string | null;
}

/** Wikidata items carry the release group id less often than MusicBrainz links the item, and the reverse. */
async function wikipediaTitle(releaseGroupMbid: string): Promise<string | null> {
  const title = await fetchWikipediaTitleByReleaseGroup(releaseGroupMbid);
  if (title !== null) return title;
  const itemId = await fetchReleaseGroupWikidataId(releaseGroupMbid);
  return itemId === null ? null : fetchWikipediaTitleByWikidataId(itemId);
}

async function wikipediaBio(releaseGroupMbid: string): Promise<string | null> {
  const title = await wikipediaTitle(releaseGroupMbid);
  return title === null ? null : fetchWikipediaSummaryText(title);
}

/** Last.fm's album description, else the English Wikipedia article's lead. Rejects unless a source gave one
 *  or every source asked answered, so a failure is never stored as "none". */
export async function fetchAlbumBio({ artist, album, releaseGroupMbid }: AlbumBioLookup): Promise<LastfmAlbumInfo> {
  let lastfm: LastfmAlbumInfo | null = null;
  let lastfmError: unknown = null;
  try {
    lastfm = await fetchAlbumInfo(artist, album);
    if (lastfm.bio !== null) return lastfm;
  } catch (err) {
    lastfmError = err;
  }
  const bio = releaseGroupMbid === null ? null : await wikipediaBio(releaseGroupMbid);
  if (bio === null && lastfmError !== null) throw lastfmError;
  return { bio, url: lastfm?.url ?? null };
}
