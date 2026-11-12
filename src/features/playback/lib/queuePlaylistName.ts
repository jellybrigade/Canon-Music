import type { CurrentTrack } from "../store/playerTypes";

export function defaultQueuePlaylistName(radioSeed: CurrentTrack | null, now: Date): string {
  return radioSeed ? radioSeed.title : `Queue ${now.toLocaleDateString()}`;
}
