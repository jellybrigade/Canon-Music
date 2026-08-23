import { useEffect, useRef, useState } from "react";
import { getBlurredBackdrop } from "../lib/artBlur";
import "./ArtBackdrop.css";

// Crossfading blurred-art backdrop, shared by NowPlayingView and AlbumDetail.
//
// Two stacked layers rather than one, because a single layer cannot crossfade:
// `background-image` is not an interpolatable property, so swapping it is always
// a hard cut. Clearing it first is worse still - the backdrop drops to flat black
// for at least a frame, and the fade then runs up from nothing instead of between
// two covers. Holding the outgoing art underneath while the incoming one fades in
// over it gives a real crossfade without re-introducing a live `filter: blur()`,
// which is the expensive thing src/lib/artBlur.ts exists to avoid.
//
// Layers carry already-blurred pixels (see artBlur.ts), so this only ever costs a
// scale/composite of two small images for the length of one transition.

type Layer = { key: number; src: string };

interface ArtBackdropProps {
  /** Source cover art URL. Blurring and caching are handled internally. */
  imageUrl: string | null;
  /** Applied to the container, for the caller's opacity / position / z-index. */
  className?: string;
}

export function ArtBackdrop({ imageUrl, className }: ArtBackdropProps) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const nextKey = useRef(0);

  useEffect(() => {
    // Deliberately no "clear the layers" here on a URL change - that is exactly the
    // flash-to-black this component exists to remove. The outgoing art stays up
    // until its replacement has been blurred and is ready to fade in over it.
    if (!imageUrl) {
      setLayers([]);
      return;
    }
    let cancelled = false;

    const apply = (dataUrl: string | null) => {
      if (cancelled) return;
      // A cover the cache cannot fetch or decode resolves null (or rejects). Clear
      // rather than stranding the previous track's art behind the new one.
      if (!dataUrl) {
        setLayers([]);
        return;
      }
      setLayers((prev) => {
        if (prev[prev.length - 1]?.src === dataUrl) return prev;
        // Keep at most the outgoing layer plus the incoming one. Skipping tracks
        // faster than the fade completes must not pile up layers.
        return [...prev.slice(-1), { key: nextKey.current++, src: dataUrl }];
      });
    };

    void getBlurredBackdrop(imageUrl)
      .then(apply)
      .catch(() => apply(null));

    return () => { cancelled = true; };
  }, [imageUrl]);

  if (layers.length === 0) return null;

  return (
    <div className={className ? `art-backdrop ${className}` : "art-backdrop"} aria-hidden="true">
      {layers.map((layer, i) => (
        <div
          key={layer.key}
          className="art-backdrop-layer"
          style={{ backgroundImage: `url("${layer.src}")` }}
          // Only the topmost layer animates; the one beneath is already opaque.
          // Pruning on animation end drops the outgoing layer once it is fully
          // covered, so the steady state is a single layer.
          onAnimationEnd={
            i === layers.length - 1
              ? () => setLayers((prev) => prev.slice(-1))
              : undefined
          }
        />
      ))}
    </div>
  );
}
