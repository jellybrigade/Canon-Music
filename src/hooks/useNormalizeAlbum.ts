import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readNormalizedTags, normalizeAlbum, isStale, type NormalizedTags } from "../lib/tag-normalize";
import { useSetting } from "./useSetting";
import { useAlbumIdentity } from "./useAlbumIdentity";
import { useTagsStore } from "../store/tags";
import type { MbGenre } from "../lib/musicbrainz";

export type { NormalizedTags };

export function useNormalizeAlbum(albumId: string, artist: string, album: string) {
  const queryClient = useQueryClient();
  const [stalenessDays] = useSetting("tags.staleness_days", "30");
  const { data: identity } = useAlbumIdentity(albumId);
  const decrementEnrichmentPending = useTagsStore((s) => s.decrementEnrichmentPending);

  const query = useQuery({
    queryKey: ["normalized-tags", albumId],
    queryFn: () => readNormalizedTags(albumId),
    enabled: !!albumId,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (query.isLoading || !albumId) return;
    if (!isStale(query.data ?? null, Number(stalenessDays) || 30)) return;

    let combinedMbGenres: MbGenre[] | null = null;
    if (identity?.combined_genres_json) {
      try {
        combinedMbGenres = JSON.parse(identity.combined_genres_json) as MbGenre[];
      } catch {
        // Malformed JSON — ignore, proceed without MB genres
      }
    }

    void normalizeAlbum(albumId, artist, album, {
      lastfmArtistName: identity?.lastfm_artist_name ?? null,
      lastfmAlbumName: identity?.lastfm_album_name ?? null,
      combinedMbGenres,
    }).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["normalized-tags", albumId] });
      decrementEnrichmentPending();
    });
  }, [query.isLoading, query.data, albumId, artist, album, queryClient, stalenessDays, identity]);

  return { data: query.data ?? null, isLoading: query.isLoading };
}
