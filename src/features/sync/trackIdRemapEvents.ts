import type { TrackIdRemap } from "./trackRemap";

type TrackIdRemapListener = (remaps: readonly TrackIdRemap[]) => void;

const listeners = new Set<TrackIdRemapListener>();

/** Once a sync has carried a track to its new id the old row is gone, so anything still holding the old id must hear it now. */
export function subscribeTrackIdRemaps(listener: TrackIdRemapListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishTrackIdRemaps(remaps: readonly TrackIdRemap[]): void {
  if (remaps.length === 0) return;
  for (const listener of listeners) listener(remaps);
}
