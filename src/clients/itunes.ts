import { isSameCoverAlbum } from "../features/covers/lib/coverMatch";
import type { ItunesAlbum } from "../features/releaseDates/lib/itunesAlbums";
import { isSameArtist } from "../features/releaseDates/lib/releaseMatch";
import { cappedSet } from "../lib/boundedCache";
import { fetchItunesArtistAlbums, searchItunesArtists } from "./itunesCatalog";

const MAX_CACHED_ARTISTS = 500;
// Free-text album search misses albums iTunes has (a new release by one of five artists named
// PISS), so covers come from the catalog of every artist with the same name.
const catalogs = new Map<string, Promise<Catalog>>();

interface Catalog {
  albums: ItunesAlbum[];
  /** Why a same-named artist's catalog couldn't be read; that one may hold the album. */
  failure: unknown;
}

async function readCatalog(artist: string): Promise<Catalog> {
  const artists = (await searchItunesArtists(artist)).filter(({ name }) => isSameArtist(artist, name));
  const lists = await Promise.allSettled(artists.map(({ id }) => fetchItunesArtistAlbums(id)));
  return {
    albums: lists.flatMap((list) => (list.status === "fulfilled" ? list.value : [])),
    failure: lists.find((list) => list.status === "rejected")?.reason ?? null,
  };
}

// Only a complete read is kept; a failed or partial one is read again next time.
function artistCatalog(artist: string): Promise<Catalog> {
  const key = artist.toLowerCase();
  const cached = catalogs.get(key);
  if (cached !== undefined) return cached;
  const read = readCatalog(artist);
  cappedSet(catalogs, key, read, MAX_CACHED_ARTISTS);
  const forget = () => {
    if (catalogs.get(key) === read) catalogs.delete(key);
  };
  read.then(({ failure }) => (failure === null ? undefined : forget()), forget);
  return read;
}

/** The artwork of every release by the artist under the album's title; rejects when none was found and iTunes didn't answer in full. */
async function sameAlbumArtwork(artist: string, album: string): Promise<string[]> {
  const { albums, failure } = await artistCatalog(artist);
  const found = albums.flatMap((hit) =>
    hit.artworkUrl !== null && isSameCoverAlbum(artist, album, hit) ? [hit.artworkUrl] : [],
  );
  if (found.length === 0 && failure !== null) throw failure;
  return found;
}

/** Resolves null when iTunes answered without a cover; rejects when it didn't answer. */
export async function fetchItunesCoverArt(artist: string, album: string): Promise<string | null> {
  const [raw] = await sameAlbumArtwork(artist, album);
  return raw === undefined ? null : raw.replace("100x100bb", "600x600bb");
}

export interface ItunesAlbumCover {
  thumbUrl: string;
  fullUrl: string;
}

// Editions (clean, explicit, deluxe) often share one image, served from whichever image host answered.
function artworkPath(url: string): string {
  return url.replace(/^https:\/\/[^/]+/, "");
}

/** Every iTunes release naming the same artist and album (editions included), as cover choices, each image once. */
export async function fetchItunesAlbumCovers(artist: string, album: string): Promise<ItunesAlbumCover[]> {
  const seen = new Set<string>();
  return (await sameAlbumArtwork(artist, album)).flatMap((raw) => {
    const path = artworkPath(raw);
    if (seen.has(path)) return [];
    seen.add(path);
    return [{ thumbUrl: raw.replace("100x100bb", "600x600bb"), fullUrl: raw.replace("100x100bb", "1200x1200bb") }];
  });
}
