import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readNormalizedTags, normalizeAlbum, isStale, type NormalizedTags } from "../lib/tag-normalize";

export type { NormalizedTags };

export function useNormalizeAlbum(albumId: string, artist: string, album: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["normalized-tags", albumId],
    queryFn: () => readNormalizedTags(albumId),
    enabled: !!albumId,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (query.isLoading || !albumId) return;
    if (!isStale(query.data ?? null)) return;

    void normalizeAlbum(albumId, artist, album).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["normalized-tags", albumId] });
    });
  }, [query.isLoading, query.data, albumId, artist, album, queryClient]);

  return { data: query.data ?? null, isLoading: query.isLoading };
}
