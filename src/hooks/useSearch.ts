import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";

export interface SearchAlbum {
  id: string;
  name: string;
  artist: string | null;
  artwork_url: string | null;
}

export interface SearchTrack {
  id: string;
  title: string;
  artist: string | null;
  album_id: string;
  album_name: string | null;
  duration: number | null;
}

export interface SearchArtist {
  name: string;
  album_count: number;
}

export interface SearchResults {
  albums: SearchAlbum[];
  tracks: SearchTrack[];
  artists: SearchArtist[];
}

// Converts raw query text to an FTS5 prefix-match expression.
// Each whitespace-separated token becomes "token"* to match prefixes.
// Double quotes in input are stripped to avoid breaking FTS5 syntax.
function toFtsQuery(q: string): string {
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, "")}"*`)
    .join(" ");
}

async function runSearch(query: string): Promise<SearchResults> {
  const fts = toFtsQuery(query);
  const db = await getDb();

  const albumRows = await db.select<{ id: string; name: string; artist: string | null; artwork_url: string | null }[]>(
    `SELECT DISTINCT a.id, a.name, a.artist, a.artwork_url
     FROM tracks_fts fts
     JOIN tracks t ON t.id = fts.id
     JOIN albums a ON a.id = t.album_id
     WHERE tracks_fts MATCH ?
     LIMIT 50`,
    [fts]
  );

  const trackRows = await db.select<{ id: string; title: string; artist: string | null; album_id: string; album_name: string | null; duration: number | null }[]>(
    `SELECT t.id, t.title, t.artist, t.album_id, a.name AS album_name, t.duration
     FROM tracks_fts fts
     JOIN tracks t ON t.id = fts.id
     LEFT JOIN albums a ON a.id = t.album_id
     WHERE tracks_fts MATCH ?
     LIMIT 50`,
    [fts]
  );

  const artistRows = await db.select<{ name: string; album_count: number }[]>(
    `SELECT t.artist AS name, COUNT(DISTINCT t.album_id) AS album_count
     FROM tracks_fts fts
     JOIN tracks t ON t.id = fts.id
     WHERE tracks_fts MATCH ? AND t.artist IS NOT NULL
     GROUP BY t.artist
     LIMIT 50`,
    [fts]
  );

  return { albums: albumRows, tracks: trackRows, artists: artistRows };
}

export function useSearch(query: string) {
  const trimmed = query.trim();
  return useQuery<SearchResults>({
    queryKey: ["search", trimmed],
    queryFn: () => runSearch(trimmed),
    enabled: trimmed.length > 0,
    staleTime: 10_000,
  });
}
