import { useQuery } from "@tanstack/react-query";
import { fetchAlbumListByType } from "../lib/navidrome";
import type { NavidromeAlbum } from "../lib/navidrome";
import type { ServerWithCredential } from "./useServer";

export function useCarouselAlbums(
  serverWithCred: ServerWithCredential | null | undefined,
  type: "recent" | "frequent" | "newest"
) {
  return useQuery<NavidromeAlbum[]>({
    queryKey: ["carousel", type, serverWithCred?.server.id],
    enabled: !!serverWithCred,
    queryFn: async () => {
      const { server, credential } = serverWithCred!;
      return fetchAlbumListByType(server.url, server.username, credential, type, 20);
    },
    staleTime: 5 * 60 * 1000,
  });
}
