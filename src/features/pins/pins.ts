import type Database from "@tauri-apps/plugin-sql";
import { artistAlbumCountSql, artistInLibrarySql } from "../../lib/libraryArtists";
import { sortNewestFirst } from "../../lib/newestFirst";
import type { AlbumRow } from "../../types/library";
import type { SearchArtist } from "../search/useSearch";

export type PinTarget =
  | { kind: "album"; serverId: string; albumId: string }
  | { kind: "artist"; serverId: string; artistName: string };

type PinnedAt = { pinned_at: number };

export interface Pins {
  artists: (SearchArtist & PinnedAt)[];
  albums: (AlbumRow & PinnedAt)[];
}

export type PinnedItem = { key: string; pinnedAt: number } & (
  | { kind: "artist"; artist: SearchArtist }
  | { kind: "album"; album: AlbumRow }
);

// Each pin copies server_id off the library row it names, so an id the library doesn't hold pins nothing.
// OR IGNORE keeps the first pin time, and with it the item's place in the newest-first order.
export async function setPinned(db: Database, target: PinTarget, isPinned: boolean, now = Date.now()): Promise<void> {
  switch (target.kind) {
    case "album":
      await db.execute(
        isPinned
          ? "INSERT OR IGNORE INTO pinned_albums (album_id, server_id, pinned_at) SELECT id, server_id, ? FROM albums WHERE id = ? AND server_id = ?"
          : "DELETE FROM pinned_albums WHERE album_id = ? AND server_id = ?",
        isPinned ? [now, target.albumId, target.serverId] : [target.albumId, target.serverId],
      );
      return;
    case "artist":
      await db.execute(
        isPinned
          ? `WITH arg (pinned_at, name, server_id) AS (SELECT ?, ?, ?)
             INSERT OR IGNORE INTO pinned_artists (server_id, artist_name, pinned_at)
             SELECT server_id, name, pinned_at FROM arg WHERE ${artistInLibrarySql("arg.server_id", "arg.name")}`
          : "DELETE FROM pinned_artists WHERE artist_name = ? AND server_id = ?",
        isPinned ? [now, target.artistName, target.serverId] : [target.artistName, target.serverId],
      );
      return;
  }
}

// A pin whose item is gone stays hidden until the next sync prunes it.
export async function readPins(db: Database, serverId: string): Promise<Pins> {
  const [artists, albums] = await Promise.all([
    db.select<Pins["artists"]>(
      `SELECT p.artist_name AS name, ${artistAlbumCountSql("p.server_id", "p.artist_name")} AS album_count,
              p.pinned_at, ai.lastfm_image_url, ai.wikidata_image_url, ai.navidrome_image_url
       FROM pinned_artists p
       LEFT JOIN artist_identity ai ON ai.artist_name = p.artist_name
       WHERE p.server_id = ? AND ${artistInLibrarySql("p.server_id", "p.artist_name")}
       ORDER BY p.pinned_at DESC, p.artist_name COLLATE NOCASE`,
      [serverId],
    ),
    db.select<Pins["albums"]>(
      `SELECT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url, a.accent_color, p.pinned_at
       FROM pinned_albums p
       JOIN albums a ON a.id = p.album_id AND a.server_id = p.server_id
       WHERE p.server_id = ?
       ORDER BY p.pinned_at DESC, a.id`,
      [serverId],
    ),
  ]);
  return { artists, albums };
}

export function isPinnedIn(pins: Pins, target: PinTarget): boolean {
  switch (target.kind) {
    case "album":
      return pins.albums.some((album) => album.id === target.albumId);
    case "artist":
      return pins.artists.some((artist) => artist.name === target.artistName);
  }
}

const KIND_ORDER: Record<PinnedItem["kind"], number> = { album: 0, artist: 1 };

export function pinsNewestFirst(pins: Pins): PinnedItem[] {
  const items: PinnedItem[] = [
    ...pins.artists.map((artist) => ({
      kind: "artist" as const,
      key: `artist:${artist.name}`,
      pinnedAt: artist.pinned_at,
      artist,
    })),
    ...pins.albums.map((album) => ({
      kind: "album" as const,
      key: `album:${album.id}`,
      pinnedAt: album.pinned_at,
      album,
    })),
  ];
  return sortNewestFirst(items, (item) => item.pinnedAt, KIND_ORDER);
}

export function pinTargetOf(item: PinnedItem, serverId: string): PinTarget {
  switch (item.kind) {
    case "artist":
      return { kind: "artist", serverId, artistName: item.artist.name };
    case "album":
      return { kind: "album", serverId: item.album.server_id, albumId: item.album.id };
  }
}
