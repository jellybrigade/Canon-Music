import { useState } from "react";
import { fetchItunesCoverArt } from "../clients/itunes";

interface Props {
  src: string | null;
  artist: string | null;
  album: string | null;
  alt?: string;
  className?: string;
  loading?: "lazy" | "eager";
  decoding?: "async" | "sync" | "auto";
}

export function AlbumArt({ src, artist, album, alt = "", className, loading, decoding }: Props) {
  // Keyed by the cover that failed, so a late answer for an earlier cover never replaces the current one.
  const [fallback, setFallback] = useState<{ forSrc: string | null; url: string | null } | null>(null);
  const hasTriedFallback = fallback?.forSrc === src;
  const currentSrc = hasTriedFallback ? fallback.url : src;

  async function handleError() {
    if (hasTriedFallback) return;
    const failedSrc = src;
    setFallback({ forSrc: failedSrc, url: null });
    const url = await fetchItunesCoverArt(artist, album).catch(() => null);
    setFallback((previous) => (previous?.forSrc === failedSrc ? { forSrc: failedSrc, url } : previous));
  }

  if (!currentSrc) return null;

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      loading={loading}
      decoding={decoding}
      onError={() => {
        void handleError();
      }}
    />
  );
}
