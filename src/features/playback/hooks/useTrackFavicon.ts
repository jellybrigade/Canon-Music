import { useEffect } from "react";
import canonFaviconUrl from "../../../assets/canon-logo-kit/canon-favicon.svg?url";
import { useCoverUrl } from "../../../hooks/useCoverRevisions";
import { usePlayerStore } from "../store/player";

/** Shows the playing track's cover as the window icon, following a cover chosen mid-track. */
export function useTrackFavicon(): void {
  const coverUrl = useCoverUrl(usePlayerStore((s) => s.currentTrack?.coverArtUrl ?? null));

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) return;
    link.href = coverUrl ?? canonFaviconUrl;
  }, [coverUrl]);
}
