import { invoke } from "@tauri-apps/api/core";
import { runtime } from "./playerRuntime";
import type { CurrentTrack, PlayerState } from "./playerTypes";
import { resolveTrack } from "./queueOrder";

// For a setting changed after the next track was handed to the engine. Once playback has
// reached it the transition stands, and track-advanced follows it as before.
export async function withdrawGaplessHandOff(): Promise<void> {
  const enqueued = runtime.gaplessEnqueued;
  if (!enqueued) return;
  const isWithdrawn = await invoke<boolean>("audio_withdraw_next").catch(() => false);
  if (!isWithdrawn || runtime.gaplessEnqueued !== enqueued) return;
  runtime.gaplessActive = false;
  runtime.gaplessEnqueued = null;
}

// For a queue edit or shuffle change that left something else next: the user no longer wants it next.
// A shuffled wrap rebuilds its order around the handed-over track, so there it only has to be queued.
export function withdrawGaplessHandOffIfNotNext({
  queue,
  queueIndex,
  isShuffled,
  shuffleOrder,
}: Pick<PlayerState, "queue" | "queueIndex" | "isShuffled" | "shuffleOrder">): void {
  const enqueued = runtime.gaplessEnqueued;
  if (!enqueued) return;
  let next: CurrentTrack | null | undefined;
  if (queueIndex + 1 < queue.length) next = resolveTrack(queue, shuffleOrder, isShuffled, queueIndex + 1);
  else if (enqueued.wraps) next = isShuffled ? queue.find((track) => track.id === enqueued.track.id) : queue[0];
  if (next?.id !== enqueued.track.id) void withdrawGaplessHandOff();
}
