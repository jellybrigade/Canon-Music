import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";

export interface SearchAlbum {
  id: string;
  server_id: string;
  name: string;
  artist: string | null;
  artwork_url: string | null;
}

export interface SearchTrack {
  id: string;
  server_id: string;
  title: string;
  artist: string | null;
  album_id: string;
  album_name: string | null;
  artwork_url: string | null;
  duration: number | null;
  replay_gain_track_gain: number | null;
  replay_gain_track_peak: number | null;
  replay_gain_album_gain: number | null;
  replay_gain_album_peak: number | null;
}

export interface SearchArtist {
  name: string;
  album_count: number;
  lastfm_image_url: string | null;
  wikidata_image_url: string | null;
  navidrome_image_url: string | null;
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

// The pool of FTS hits the per-section queries are allowed to draw from.
// Ranking happens inside this CTE so the cap keeps the *best* matches; without
// the ORDER BY, a bare LIMIT hands back whatever FTS visited first (rowid order,
// i.e. oldest-synced), and the JS re-ranking below never sees the good rows.
//
// MATERIALIZED is load-bearing, not a hint: if SQLite flattens the CTE into the
// outer join it rejects the query outright with "unable to use function bm25 in
// the requested context". Requires SQLite 3.35+ (bundled: 3.46).
//
// Column weights mirror the JS scoring intent below - a title hit beats an
// artist hit beats an album hit beats a genre hit.
const RANKED_POOL = 2000;
const RANKED_CTE = `
  WITH ranked AS MATERIALIZED (
    SELECT fts.id AS id, bm25(tracks_fts, 0.0, 10.0, 8.0, 4.0, 1.0) AS rank
    FROM tracks_fts fts
    WHERE tracks_fts MATCH ?
    ORDER BY rank
    LIMIT ${RANKED_POOL}
  )`;

const SECTION_LIMIT = 200;

async function runSearch(query: string, serverId: string): Promise<SearchResults> {
  const fts = toFtsQuery(query);
  const db = await getDb();

  const [albumRows, trackRows, artistRows] = await Promise.all([
    db.select<SearchAlbum[]>(
      `${RANKED_CTE}
       SELECT a.id, a.server_id, a.name, a.artist, a.artwork_url, MIN(r.rank) AS rank
       FROM ranked r
       JOIN tracks t ON t.id = r.id
       JOIN albums a ON a.id = t.album_id
       WHERE a.server_id = ?
       GROUP BY a.id
       ORDER BY rank
       LIMIT ${SECTION_LIMIT}`,
      [fts, serverId]
    ),
    db.select<SearchTrack[]>(
      `${RANKED_CTE}
       SELECT t.id, t.server_id, t.title, t.artist, t.album_id, a.name AS album_name, a.artwork_url, t.duration,
              t.replay_gain_track_gain, t.replay_gain_track_peak,
              t.replay_gain_album_gain, t.replay_gain_album_peak
       FROM ranked r
       JOIN tracks t ON t.id = r.id
       LEFT JOIN albums a ON a.id = t.album_id
       WHERE t.server_id = ?
       ORDER BY r.rank
       LIMIT ${SECTION_LIMIT}`,
      [fts, serverId]
    ),
    db.select<{ name: string; album_count: number; lastfm_image_url: string | null; wikidata_image_url: string | null; navidrome_image_url: string | null }[]>(
      `${RANKED_CTE}
       SELECT t.artist AS name, COUNT(DISTINCT t.album_id) AS album_count,
              ai.lastfm_image_url, ai.wikidata_image_url, ai.navidrome_image_url,
              MIN(r.rank) AS rank
       FROM ranked r
       JOIN tracks t ON t.id = r.id
       LEFT JOIN artist_identity ai ON ai.artist_name = t.artist
       WHERE t.server_id = ? AND t.artist IS NOT NULL
       GROUP BY t.artist
       ORDER BY rank
       LIMIT ${SECTION_LIMIT}`,
      [fts, serverId]
    ),
  ]);

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

  const FEAT_RE = /^(.+?)\s+(?:feat\.|ft\.|featuring)\s+/i;

  const scoredArtists = artistRows
    .map(a => ({ item: a, s: scoreMatch(a.name, query) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || b.item.album_count - a.item.album_count);

  const primaryNames = new Set(scoredArtists.map(x => x.item.name.toLowerCase()));

  const artists: SearchArtist[] = scoredArtists
    .filter(({ item }) => {
      const m = FEAT_RE.exec(item.name);
      return !m || !m[1] || !primaryNames.has(m[1].toLowerCase());
    })
    .map(x => x.item);

  return { albums, tracks, artists };
}

export function useSearch(query: string, serverId: string | undefined) {
  const trimmed = query.trim();
  return useQuery<SearchResults>({
    queryKey: QK.search(serverId ?? "", trimmed),
    queryFn: () => runSearch(trimmed, serverId!),
    enabled: trimmed.length > 0 && !!serverId,
    staleTime: 10_000,
    // Keep the previous query's rows on screen while the next one runs, so
    // typing doesn't flash the "Searching…" state between every keystroke.
    placeholderData: keepPreviousData,
    // Every prefix typed leaves its own entry behind; don't hold 600 rows per
    // keystroke for the 5min default.
    gcTime: 60_000,
  });
}
