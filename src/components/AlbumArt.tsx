import { useEffect, useRef, useState } from "react";
import { fetchItunesCoverArt } from "../lib/itunes";

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
  const [currentSrc, setCurrentSrc] = useState(src);
  const triedFallback = useRef(false);

  useEffect(() => {
    setCurrentSrc(src);
    triedFallback.current = false;
  }, [src]);

  async function handleError() {
    if (triedFallback.current) return;
    triedFallback.current = true;
    const fallback = await fetchItunesCoverArt(artist, album);
    if (fallback) setCurrentSrc(fallback);
    else setCurrentSrc(null);
  }

  if (!currentSrc) return null;

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      loading={loading}
      decoding={decoding}
      onError={() => { void handleError(); }}
    />
  );
}
