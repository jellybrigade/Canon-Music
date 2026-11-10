import { type ComponentProps, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCoverUrl } from "../hooks/useCoverRevisions";
import { isCoverDecoded, markCoverDecoded } from "../lib/decodedCovers";
import { preloadImage } from "../lib/preloadImage";
import "./CoverImg.css";

/** How long a shown cover stays up while the next one loads, before it gives way to a blank. */
export const COVER_SWAP_WAIT_MS = 800;

type Phase = "loading" | "entering" | "shown" | "broken";

// A load event always lands a frame after mount, so a cover already decoded is shown, not hidden till then.
function arrivingPhase(src: string | null | undefined): Phase {
  return typeof src === "string" && isCoverDecoded(src) ? "shown" : "loading";
}

/** Every image goes through here, so a chosen album cover reaches URLs built before it was chosen. */
export function CoverImg({ src, alt, onLoad, onError, ...props }: ComponentProps<"img">) {
  const wantedSrc = useCoverUrl(src);
  const [shownSrc, setShownSrc] = useState(wantedSrc);
  const [phase, setPhase] = useState<Phase>(() => arrivingPhase(wantedSrc));
  const imageRef = useRef<HTMLImageElement>(null);
  const isHoldable = phase === "entering" || phase === "shown";

  // No cover on screen to hold, so there is no reason to wait.
  if (wantedSrc !== shownSrc && (!isHoldable || typeof wantedSrc !== "string")) {
    setShownSrc(wantedSrc);
    setPhase(arrivingPhase(wantedSrc));
  }

  const nextSrc = isHoldable && typeof wantedSrc === "string" && wantedSrc !== shownSrc ? wantedSrc : null;
  useEffect(() => {
    if (nextSrc === null) return;
    let isCurrent = true;
    const timer = setTimeout(() => {
      isCurrent = false;
      setShownSrc(nextSrc);
      setPhase("loading");
    }, COVER_SWAP_WAIT_MS);
    // A failed preload still swaps, so the image's own error reaches the caller.
    const swap = () => {
      if (!isCurrent) return;
      clearTimeout(timer);
      setShownSrc(nextSrc);
    };
    preloadImage(nextSrc).then(swap, swap);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [nextSrc]);

  // A cover the browser already holds is complete before paint; fading it in would only flicker.
  useLayoutEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) setPhase((current) => (current === "loading" ? "shown" : current));
  }, [shownSrc]);

  return (
    <img
      {...props}
      ref={imageRef}
      src={shownSrc}
      alt={alt}
      data-cover={phase}
      onLoad={(event) => {
        if (typeof shownSrc === "string") markCoverDecoded(shownSrc);
        setPhase((current) => (current === "loading" ? "entering" : current));
        onLoad?.(event);
      }}
      onError={(event) => {
        setPhase("broken");
        onError?.(event);
      }}
    />
  );
}
