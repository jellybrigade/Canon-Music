import { fetchDeezerDiscography } from "../../../clients/deezer";
import { fetchArtistTopAlbums, normalizeTrackTitle } from "../../../clients/lastfm";
import { fetchListenBrainzReleaseGroupListens } from "../../../clients/listenbrainz";
import { isMatchingRelease } from "../../releaseDates/lib/releaseMatch";
import { findDeezerArtist } from "./deezerArtist";

export interface EssentialAlbumCandidate {
  id: string;
  name: string;
  releaseGroupMbid: string | null;
}

interface EssentialAlbumInput {
  artistName: string;
  lastfmName: string;
  albums: readonly EssentialAlbumCandidate[];
}

function idsByScore(scores: Map<string, number>): string[] {
  return [...scores].sort(([, a], [, b]) => b - a).map(([id]) => id);
}

async function lastfmOrder({ lastfmName, albums }: EssentialAlbumInput): Promise<string[]> {
  const ids: string[] = [];
  for (const top of await fetchArtistTopAlbums(lastfmName)) {
    const key = normalizeTrackTitle(top.name);
    const local = albums.find((album) => normalizeTrackTitle(album.name) === key);
    if (local && !ids.includes(local.id)) ids.push(local.id);
  }
  return ids;
}

// Ranked by the best-saved Deezer edition of the same title and type; only albums, these are the
// artist's albums section.
async function deezerOrder({ artistName, albums }: EssentialAlbumInput): Promise<string[]> {
  const artist = await findDeezerArtist(artistName);
  if (artist === null) return [];
  const discography = await fetchDeezerDiscography(artist.id);
  const fansById = new Map<string, number>();
  for (const album of albums) {
    const local = { name: album.name, artist: artistName, kind: "album" as const, trackCount: 0 };
    for (const entry of discography) {
      if (entry.fans === null) continue;
      if (!isMatchingRelease(local, { ...entry, trackCount: 0, artistName: artist.name })) continue;
      fansById.set(album.id, Math.max(fansById.get(album.id) ?? 0, entry.fans));
    }
  }
  return idsByScore(fansById);
}

async function listenBrainzOrder({ albums }: EssentialAlbumInput): Promise<string[]> {
  const identified = albums.flatMap(({ id, releaseGroupMbid }) =>
    releaseGroupMbid === null ? [] : [{ id, releaseGroupMbid }],
  );
  if (identified.length === 0) return [];
  const listens = await fetchListenBrainzReleaseGroupListens(identified.map((album) => album.releaseGroupMbid));
  const countByMbid = new Map(listens.map(({ mbid, listenCount }) => [mbid, listenCount]));
  const listensById = new Map<string, number>();
  for (const { id, releaseGroupMbid } of identified) {
    const count = countByMbid.get(releaseGroupMbid);
    if (count != null) listensById.set(id, count);
  }
  return idsByScore(listensById);
}

const SOURCES = [lastfmOrder, deezerOrder, listenBrainzOrder];

/** The artist's albums in this library most popular first, by the first of Last.fm, Deezer and
 *  ListenBrainz that ranks any; only the order, never the counts. Rejects unless every source answered. */
export async function fetchEssentialAlbumOrder(input: EssentialAlbumInput): Promise<string[]> {
  let firstFailure: unknown = null;
  for (const source of SOURCES) {
    try {
      const ids = await source(input);
      if (ids.length > 0) return ids;
    } catch (err) {
      firstFailure ??= err;
    }
  }
  if (firstFailure !== null) throw firstFailure;
  return [];
}
