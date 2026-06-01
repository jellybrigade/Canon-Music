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

// Score how well a field matches the query.
// Tiers: exact > starts-with > word-starts-with > substring > no match.
function scoreMatch(field: string | null, query: string): number {
  if (!field || !query) return 0;
  const f = field.toLowerCase();
  const q = query.toLowerCase();
  if (f === q) return 1000;
  if (f.startsWith(q)) return 800;
  if (f.split(/\s+/).some(t => t.startsWith(q))) return 600;
  if (f.includes(q)) return 300;
  return 0;
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
     LIMIT 200`,
    [fts]
  );

  const trackRows = await db.select<{ id: string; title: string; artist: string | null; album_id: string; album_name: string | null; duration: number | null }[]>(
    `SELECT t.id, t.title, t.artist, t.album_id, a.name AS album_name, t.duration
     FROM tracks_fts fts
     JOIN tracks t ON t.id = fts.id
     LEFT JOIN albums a ON a.id = t.album_id
     WHERE tracks_fts MATCH ?
     LIMIT 200`,
    [fts]
  );

  const artistRows = await db.select<{ name: string; album_count: number }[]>(
    `SELECT t.artist AS name, COUNT(DISTINCT t.album_id) AS album_count
     FROM tracks_fts fts
     JOIN tracks t ON t.id = fts.id
     WHERE tracks_fts MATCH ? AND t.artist IS NOT NULL
     GROUP BY t.artist
     LIMIT 200`,
    [fts]
  );

  // Re-rank results in JS. FTS5 gives recall; scoring gives relevance.
  // Albums: primary field = title, secondary = artist (weighted 0.6×).
  // Tracks: same. Albums matched only via genre/album-title score 0 and are dropped.
  // Artists: primary field = name only; artist scoring 0 means FTS matched a track field, not the name.
  const albums: SearchAlbum[] = albumRows
    .map(a => ({ item: a, s: Math.max(scoreMatch(a.name, query), Math.floor(scoreMatch(a.artist, query) * 0.6)) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.item.name.localeCompare(b.item.name))
    .map(x => x.item);

  const tracks: SearchTrack[] = trackRows
    .map(t => ({ item: t, s: Math.max(scoreMatch(t.title, query), Math.floor(scoreMatch(t.artist, query) * 0.6)) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.item.title.localeCompare(b.item.title))
    .map(x => x.item);

  const artists: SearchArtist[] = artistRows
    .map(a => ({ item: a, s: scoreMatch(a.name, query) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || b.item.album_count - a.item.album_count)
    .map(x => x.item);

  return { albums, tracks, artists };
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
