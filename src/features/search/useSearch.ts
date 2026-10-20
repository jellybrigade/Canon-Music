import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getDb } from "../../db";
import { QK } from "../../lib/queryKeys";
import { albumScore, artistScore, toSearchTokens, trackScore } from "./searchScore";

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
  album_id: string | null;
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

// Each token becomes "token"* to match prefixes.
function toFtsQuery(tokens: string[]): string {
  return tokens.map((t) => `"${t}"*`).join(" ");
}

// FTS pool ranked by weighted bm25 (title > artist > album > genre) inside the CTE, so the
// cap keeps the best hits. MATERIALIZED is required: flattened, SQLite rejects bm25 here.
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

async function runSearch(rawQuery: string, serverId: string): Promise<SearchResults> {
  const tokens = toSearchTokens(rawQuery);
  const fts = toFtsQuery(tokens);
  const query = tokens.filter(Boolean).join(" ");
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
      [fts, serverId],
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
      [fts, serverId],
    ),
    db.select<
      {
        name: string;
        album_count: number;
        lastfm_image_url: string | null;
        wikidata_image_url: string | null;
        navidrome_image_url: string | null;
      }[]
    >(
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
      [fts, serverId],
    ),
  ]);

  // Re-rank in JS: FTS5 gives recall, scoring gives relevance. A zero score (e.g. an album
  // matched only via genre) is dropped rather than kept at the bottom.
  const albums: SearchAlbum[] = albumRows
    .map((a) => ({ item: a, s: albumScore(a, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.item.name.localeCompare(b.item.name))
    .map((x) => x.item);

  const tracks: SearchTrack[] = trackRows
    .map((t) => ({ item: t, s: trackScore(t, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.item.title.localeCompare(b.item.title))
    .map((x) => x.item);

  const FEAT_RE = /^(.+?)\s+(?:feat\.|ft\.|featuring)\s+/i;

  const scoredArtists = artistRows
    .map((a) => ({ item: a, s: artistScore(a, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.item.album_count - a.item.album_count);

  const primaryNames = new Set(scoredArtists.map((x) => x.item.name.toLowerCase()));

  const artists: SearchArtist[] = scoredArtists
    .filter(({ item }) => {
      const m = FEAT_RE.exec(item.name);
      return !m?.[1] || !primaryNames.has(m[1].toLowerCase());
    })
    .map((x) => x.item);

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
