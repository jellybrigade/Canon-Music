import type Database from "@tauri-apps/plugin-sql";
import { artistAlbumCountSql, artistInLibrarySql } from "../../lib/libraryArtists";
import type { SearchAlbum, SearchArtist, SearchTrack } from "../search/useSearch";

export const RECENTS_LIMIT = 5;

export type RecentTarget =
  | { kind: "album"; serverId: string; albumId: string }
  | { kind: "artist"; serverId: string; artistName: string }
  | { kind: "track"; serverId: string; trackId: string };

export type RecentTrack = Pick<
  SearchTrack,
  "id" | "server_id" | "title" | "artist" | "album_id" | "album_name" | "artwork_url"
>;

type OpenedAt = { opened_at: number };

export type RecentItem = { key: string; openedAt: number } & (
  | { kind: "album"; album: SearchAlbum }
  | { kind: "artist"; artist: SearchArtist }
  | { kind: "track"; track: RecentTrack }
);

// Each kind keeps its own last few, so the merged list always has RECENTS_LIMIT to choose from.
const WRITES: Record<RecentTarget["kind"], { upsert: string; trim: string }> = {
  album: {
    upsert: `INSERT INTO recent_albums (album_id, server_id, opened_at)
             SELECT id, server_id, ? FROM albums WHERE id = ? AND server_id = ?
             ON CONFLICT (album_id) DO UPDATE SET opened_at = excluded.opened_at`,
    trim: `DELETE FROM recent_albums WHERE server_id = ? AND album_id NOT IN (
             SELECT album_id FROM recent_albums WHERE server_id = ? ORDER BY opened_at DESC, album_id LIMIT ${RECENTS_LIMIT})`,
  },
  artist: {
    upsert: `WITH arg (opened_at, name, server_id) AS (SELECT ?, ?, ?)
             INSERT INTO recent_artists (server_id, artist_name, opened_at)
             SELECT server_id, name, opened_at FROM arg WHERE ${artistInLibrarySql("arg.server_id", "arg.name")}
             ON CONFLICT (server_id, artist_name) DO UPDATE SET opened_at = excluded.opened_at`,
    trim: `DELETE FROM recent_artists WHERE server_id = ? AND artist_name NOT IN (
             SELECT artist_name FROM recent_artists WHERE server_id = ? ORDER BY opened_at DESC, artist_name LIMIT ${RECENTS_LIMIT})`,
  },
  track: {
    upsert: `INSERT INTO recent_tracks (track_id, server_id, opened_at)
             SELECT id, server_id, ? FROM tracks WHERE id = ? AND server_id = ?
             ON CONFLICT (track_id) DO UPDATE SET opened_at = excluded.opened_at`,
    trim: `DELETE FROM recent_tracks WHERE server_id = ? AND track_id NOT IN (
             SELECT track_id FROM recent_tracks WHERE server_id = ? ORDER BY opened_at DESC, track_id LIMIT ${RECENTS_LIMIT})`,
  },
};

const idOf = (target: RecentTarget) =>
  target.kind === "album" ? target.albumId : target.kind === "artist" ? target.artistName : target.trackId;

// Copies server_id off the library row it names, so an id the library doesn't hold records nothing.
// The trim may run without the upsert landing; an extra row in between is harmless.
export async function recordRecent(db: Database, target: RecentTarget, now = Date.now()): Promise<void> {
  const { upsert, trim } = WRITES[target.kind];
  await db.execute(upsert, [now, idOf(target), target.serverId]);
  await db.execute(trim, [target.serverId, target.serverId]);
}

const KIND_ORDER: Record<RecentItem["kind"], number> = { album: 0, artist: 1, track: 2 };

// Inner joins hide an item whose row is gone before the next sync prunes it.
export async function readRecents(db: Database, serverId: string): Promise<RecentItem[]> {
  const [albums, artists, tracks] = await Promise.all([
    db.select<(SearchAlbum & OpenedAt)[]>(
      `SELECT a.id, a.server_id, a.name, a.artist, a.artwork_url, r.opened_at
       FROM recent_albums r
       JOIN albums a ON a.id = r.album_id AND a.server_id = r.server_id
       WHERE r.server_id = ?
       ORDER BY r.opened_at DESC, a.id
       LIMIT ${RECENTS_LIMIT}`,
      [serverId],
    ),
    db.select<(SearchArtist & OpenedAt)[]>(
      `SELECT r.artist_name AS name, ${artistAlbumCountSql("r.server_id", "r.artist_name")} AS album_count,
              r.opened_at, ai.lastfm_image_url, ai.wikidata_image_url, ai.navidrome_image_url
       FROM recent_artists r
       LEFT JOIN artist_identity ai ON ai.artist_name = r.artist_name
       WHERE r.server_id = ? AND ${artistInLibrarySql("r.server_id", "r.artist_name")}
       ORDER BY r.opened_at DESC, r.artist_name COLLATE NOCASE
       LIMIT ${RECENTS_LIMIT}`,
      [serverId],
    ),
    db.select<(RecentTrack & OpenedAt)[]>(
      `SELECT t.id, t.server_id, t.title, t.artist, t.album_id, al.name AS album_name, al.artwork_url, r.opened_at
       FROM recent_tracks r
       JOIN tracks t ON t.id = r.track_id AND t.server_id = r.server_id
       LEFT JOIN albums al ON al.id = t.album_id AND al.server_id = t.server_id
       WHERE r.server_id = ?
       ORDER BY r.opened_at DESC, t.id
       LIMIT ${RECENTS_LIMIT}`,
      [serverId],
    ),
  ]);
  const items: RecentItem[] = [
    ...albums.map(({ opened_at, ...album }) => ({
      kind: "album" as const,
      key: `album:${album.id}`,
      openedAt: opened_at,
      album,
    })),
    ...artists.map(({ opened_at, ...artist }) => ({
      kind: "artist" as const,
      key: `artist:${artist.name}`,
      openedAt: opened_at,
      artist,
    })),
    ...tracks.map(({ opened_at, ...track }) => ({
      kind: "track" as const,
      key: `track:${track.id}`,
      openedAt: opened_at,
      track,
    })),
  ];
  return items
    .sort(
      (a, b) =>
        b.openedAt - a.openedAt ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    )
    .slice(0, RECENTS_LIMIT);
}
