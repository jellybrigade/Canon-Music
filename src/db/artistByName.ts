import type Database from "@tauri-apps/plugin-sql";
import type { ArtistRow } from "../types/library";

export type ArtistByNameRow = Pick<
  ArtistRow,
  "name" | "album_count" | "artwork_url" | "lastfm_image_url" | "wikidata_image_url"
>;

/**
 * The artist page's row for a name in any case: a Last.fm card's spelling can drift ("Tyler, The
 * Creator" vs "Tyler, the Creator"), so `name` is the library's own spelling, the exact one when
 * several differ only in case. The cover is picked in the artist grid's order (`artists.rs`).
 */
export async function readArtistByName(
  db: Pick<Database, "select">,
  name: string,
  serverId: string,
): Promise<ArtistByNameRow | null> {
  const wanted = name.trim();
  const rows = await db.select<ArtistByNameRow[]>(
    `SELECT a.name, a.album_count,
       (SELECT al.artwork_url FROM albums al
        WHERE al.artist = a.name AND al.server_id = a.server_id AND al.artwork_url IS NOT NULL
        ORDER BY al.navidrome_created DESC, al.year DESC, al.id
        LIMIT 1) AS artwork_url,
       ai.lastfm_image_url,
       ai.wikidata_image_url
     FROM artists a
     LEFT JOIN artist_identity ai ON ai.artist_name = a.name
     WHERE a.server_id = ? AND a.name = ? COLLATE NOCASE
     ORDER BY a.name = ? DESC, a.name, a.id
     LIMIT 1`,
    [serverId, wanted, wanted],
  );
  return rows[0] ?? null;
}
