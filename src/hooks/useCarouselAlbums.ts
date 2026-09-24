import { useQuery } from "@tanstack/react-query";
import { fetchAlbumListByType } from "../clients/navidrome";
import type { NavidromeAlbum } from "../clients/navidrome";
import type { ServerWithCredential } from "./useServer";
import { QK } from "../lib/queryKeys";
import { HOME_GC_TIME, HOME_STALE_TIME } from "../lib/homeQueryTiming";

export function useCarouselAlbums(
  serverWithCred: ServerWithCredential | null | undefined,
  type: "recent" | "frequent" | "newest"
) {
  return useQuery<NavidromeAlbum[]>({
    queryKey: QK.carousel(type, serverWithCred?.server.id),
    enabled: !!serverWithCred,
    queryFn: async () => {
      const { server, credential } = serverWithCred!;
      return fetchAlbumListByType(server.url, server.username, credential, type, 20, server.alt_url ?? undefined);
    },
    staleTime: HOME_STALE_TIME,
    gcTime: HOME_GC_TIME,
  });
}
