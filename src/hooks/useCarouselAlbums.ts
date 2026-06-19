import { useQuery } from "@tanstack/react-query";
import { fetchAlbumListByType } from "../lib/navidrome";
import type { NavidromeAlbum } from "../lib/navidrome";
import type { ServerWithCredential } from "./useServer";
import { QK } from "../lib/query-keys";

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
    staleTime: 5 * 60 * 1000,
  });
}
