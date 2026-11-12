import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useSetting } from "../../../hooks/useSetting";
import { parseStalenessDays } from "../../../lib/numberSetting";
import { QK } from "../../../lib/queryKeys";
import { useAlbumIdentity } from "../../enrichment/hooks/useAlbumIdentity";
import { isStale, type NormalizedTags, normalizeAlbum, readNormalizedTags } from "../lib/tagNormalize";
import { useTagsStore } from "../store/tags";

export type { NormalizedTags };

export function useNormalizeAlbum(albumId: string) {
  const queryClient = useQueryClient();
  const [stalenessDays, , isStalenessDaysLoaded] = useSetting("tags.staleness_days", "30");
  const { data: identity } = useAlbumIdentity(albumId);
  const decrementEnrichmentPending = useTagsStore((s) => s.decrementEnrichmentPending);
  // undefined = not yet seen (first render); null/string = seen value (genres + tags concatenated for change detection)
  const prevMbGenresJsonRef = useRef<string | null | undefined>(undefined);
  // Albums this mount has already decremented for. A set, not the latest id: `AlbumDetail`
  // has no `key`, so navigating A -> B -> A returns to an id that was already counted.
  const decrementedRef = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey: QK.normalizedTags(albumId),
    queryFn: () => readNormalizedTags(albumId),
    enabled: !!albumId,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!isStalenessDaysLoaded || query.isLoading || !albumId) return;

    const currentMbGenres = identity?.combined_genres_json ?? null;
    const currentMbTags = identity?.combined_tags_json ?? null;
    const currentMbKey = `${currentMbGenres ?? ""}|${currentMbTags ?? ""}`;
    const mbDataJustArrived =
      prevMbGenresJsonRef.current !== undefined &&
      prevMbGenresJsonRef.current !== currentMbKey &&
      (currentMbGenres !== null || currentMbTags !== null);
    prevMbGenresJsonRef.current = currentMbKey;

    if (!mbDataJustArrived && !isStale(query.data ?? null, parseStalenessDays(stalenessDays))) return;

    void normalizeAlbum(albumId).then(() => {
      void queryClient.invalidateQueries({ queryKey: QK.normalizedTags(albumId) });
      void queryClient.invalidateQueries({ queryKey: QK.albumUnmatchedGenres(albumId) });
      if (!decrementedRef.current.has(albumId)) {
        decrementedRef.current.add(albumId);
        decrementEnrichmentPending();
      }
    });
  }, [query.isLoading, query.data, albumId, queryClient, stalenessDays, isStalenessDaysLoaded, identity]);

  return { data: query.data ?? null, isLoading: query.isLoading };
}
