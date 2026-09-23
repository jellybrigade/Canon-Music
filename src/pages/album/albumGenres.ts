import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { QK } from "../../lib/queryKeys";
import { getDb } from "../../db";
import { useBoolSetting } from "../../hooks/useSetting";
import { isYearLikeGenre, type NormalizedTags } from "../../features/tags/lib/tagNormalize";
import { rawGenreId } from "../../features/tags/lib/canonicalize";
import { applyGenreMappings } from "../../hooks/useGenreDisplay";
import type { DisplayGenre, GenreGroups } from "../../components/AlbumGenreEditor";
import type { TrackRow } from "../../types/library";

export interface TrackGenre {
  display: string;
  canonicalId: string;
}

export function trackGenres(
  track: TrackRow,
  trackTagGenresMap: Map<string, TrackGenre[]>,
  genreMappings: Map<string, string | null>
): TrackGenre[] {
  return (
    trackTagGenresMap.get(track.id) ??
    applyGenreMappings(track.genre, genreMappings).map((g) => ({
      display: g,
      canonicalId: rawGenreId(g),
    }))
  );
}

export type RawSourcesByCanonicalId = Map<string, Array<{ raw_value: string; source: string }>>;

export function useTrackTagGenres(albumId: string, genreMappings: Map<string, string | null>) {
  const [skipYearGenres] = useBoolSetting("tags.skip_year_genres", true);
  const { data: trackTagRows = [] } = useQuery({
    queryKey: QK.trackTagsAlbum(albumId),
    queryFn: async () => {
      const db = await getDb();
      return db.select<{ track_id: string; raw_value: string; canonical_id: string | null; source: string }[]>(
        `SELECT tt.track_id, tt.raw_value, tt.canonical_id, tt.source
         FROM track_tags tt
         JOIN tracks t ON tt.track_id = t.id
         WHERE t.album_id = ? AND tt.kind = 'genre'
         ORDER BY tt.track_id,
                  CASE tt.source WHEN 'server' THEN 0 WHEN 'lastfm-track' THEN 1 ELSE 2 END`,
        [albumId]
      );
    },
    staleTime: Infinity,
  });

  return useMemo(() => {
    const map = new Map<string, TrackGenre[]>();
    for (const row of trackTagRows) {
      if (skipYearGenres && isYearLikeGenre(row.raw_value)) continue;
      if (!genreMappings.has(row.raw_value)) continue;
      const display = genreMappings.get(row.raw_value) ?? null;
      if (display === null) continue;
      if (!map.has(row.track_id)) map.set(row.track_id, []);
      const genres = map.get(row.track_id)!;
      if (!genres.some((g) => g.display === display)) {
        genres.push({ display, canonicalId: row.canonical_id ?? rawGenreId(row.raw_value) });
      }
    }
    return map;
  }, [trackTagRows, genreMappings, skipYearGenres]);
}

export function useRawSourcesByCanonicalId(albumId: string): RawSourcesByCanonicalId {
  const { data: rawSourceRows = [] } = useQuery({
    queryKey: QK.albumGenreRawSources(albumId),
    queryFn: async () => {
      const db = await getDb();
      return db.select<{ canonical_id: string; raw_value: string; source: string }[]>(
        `SELECT DISTINCT tt.canonical_id, tt.raw_value, tt.source
         FROM tracks t JOIN track_tags tt ON tt.track_id = t.id
         WHERE t.album_id = ? AND tt.kind = 'genre'`,
        [albumId]
      );
    },
    staleTime: Infinity,
  });

  return useMemo(() => {
    const map: RawSourcesByCanonicalId = new Map();
    for (const r of rawSourceRows) {
      if (!map.has(r.canonical_id)) map.set(r.canonical_id, []);
      map.get(r.canonical_id)!.push({ raw_value: r.raw_value, source: r.source });
    }
    return map;
  }, [rawSourceRows]);
}

// Same query key + shape as TagDrawer's useAlbumUnmatchedGenres so the cache is shared.
export function useUnmatchedGenreCount(albumId: string): number {
  const { data: unmatchedGenres = [] } = useQuery({
    queryKey: QK.albumUnmatchedGenres(albumId),
    queryFn: async () => {
      const db = await getDb();
      return db.select<{ raw_value: string; source: string }[]>(
        `SELECT DISTINCT ug.raw_value, ug.source
         FROM album_unresolved_genres ug
         WHERE ug.album_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM tag_mappings tm
             WHERE tm.raw_value = ug.raw_value AND tm.kind = 'genre'
           )
         ORDER BY ug.source, ug.raw_value`,
        [albumId]
      );
    },
    staleTime: Infinity,
  });
  return unmatchedGenres.length;
}

export function buildDisplayGenres(
  normalizedTags: NormalizedTags | null | undefined,
  tracks: TrackRow[] | undefined,
  genreMappings: Map<string, string | null>
): DisplayGenre[] {
  let raw: DisplayGenre[];
  if (normalizedTags?.genres.length) {
    raw = normalizedTags.genres;
  } else if (tracks) {
    const seen = new Set<string>();
    raw = [];
    for (const t of tracks) {
      if (t.genre && !seen.has(t.genre)) {
        seen.add(t.genre);
        raw.push({ id: null, name: t.genre });
      }
    }
  } else {
    return [];
  }
  // Drop unmapped tags (id=null) that have no decision yet (undecided unmatched),
  // are ignored, or whose mapped name is already shown as a canonical chip.
  const shownNames = new Set(raw.filter((g) => g.id !== null).map((g) => g.name));
  return raw.filter((g) => {
    if (g.id !== null) return true;
    const mapped = genreMappings.get(g.name);
    if (mapped === undefined) return false; // no decision yet, hide from band
    if (mapped === null) return false;      // ignored
    if (shownNames.has(mapped)) return false; // already shown as canonical
    return true;
  });
}

export function groupGenresBySource(displayGenres: DisplayGenre[]): GenreGroups {
  const manual: DisplayGenre[] = [];
  const file: DisplayGenre[] = [];
  const lastfm: DisplayGenre[] = [];
  const musicbrainz: DisplayGenre[] = [];
  const folksonomy: DisplayGenre[] = [];
  const unsourced: DisplayGenre[] = [];
  for (const g of displayGenres) {
    if (g.source === "manual") manual.push(g);
    else if (g.source === "file") file.push(g);
    else if (g.source === "lastfm") lastfm.push(g);
    else if (g.source === "musicbrainz") musicbrainz.push(g);
    else if (g.source === "musicbrainz-folksonomy") folksonomy.push(g);
    else unsourced.push(g);
  }
  const nonEmpty = [manual, file, lastfm, musicbrainz, folksonomy, unsourced].filter((g) => g.length > 0);
  return { manual, file, lastfm, musicbrainz, folksonomy, unsourced, multiSource: nonEmpty.length > 1 };
}
