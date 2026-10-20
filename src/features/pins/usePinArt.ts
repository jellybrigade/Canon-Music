import { resolvePortraitUrl } from "../../clients/lastfm";
import { getCoverArtUrl } from "../../clients/navidromeUrls";
import { useAlbumDisplayName } from "../../hooks/useAlbumDisplayName";
import { resolveArtistImageUrl, useArtistImageMap } from "../../hooks/useArtistImageCache";
import { useAlbumCoverMap } from "../../hooks/useCoverCache";
import type { ServerWithCredential } from "../../hooks/useServer";
import type { PinnedItem } from "./pins";

export function usePinArt({ server, credential }: ServerWithCredential, thumbSize: number) {
  const albumDisplayName = useAlbumDisplayName();
  const artistImageMap = useArtistImageMap();
  const coverMap = useAlbumCoverMap();

  const nameOf = (item: PinnedItem) =>
    item.kind === "artist" ? item.artist.name : albumDisplayName(item.album.name, item.album.id);
  const thumbOf = (item: PinnedItem) => {
    if (item.kind === "artist") {
      return resolveArtistImageUrl(artistImageMap, item.artist.name, resolvePortraitUrl(item.artist));
    }
    const { id, artwork_url } = item.album;
    return (
      coverMap.get(id) ??
      (artwork_url ? getCoverArtUrl(server.url, server.username, credential, artwork_url, thumbSize) : null)
    );
  };
  return { nameOf, thumbOf };
}
