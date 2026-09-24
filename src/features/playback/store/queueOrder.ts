import type { CurrentTrack } from "./playerTypes";

export function adjustIndexAfterMove(currentIdx: number, from: number, to: number): number {
  if (from === currentIdx) return to;
  let adj = currentIdx;
  if (from < adj) adj--;
  if (to <= adj) adj++;
  return adj;
}

// Returns a shuffle order that is guaranteed to cover every queue entry exactly once.
// Appending to a shuffle order that does not already cover the whole queue silently shifts
// every position, so callers that splice into it normalize first. A short order is repaired by
// keeping the positions it does describe and appending whatever queue indices it left out.
// Always returns a fresh array: every caller splices or pushes into the result, and handing
// back the stored order itself would mutate live state in place and leave the reference
// unchanged, so components subscribed to shuffleOrder would not re-render.
export function normalizeShuffleOrder(order: number[], queueLength: number): number[] {
  if (order.length === queueLength) return [...order];
  const seen = new Set<number>();
  const repaired: number[] = [];
  for (const idx of order) {
    if (idx >= 0 && idx < queueLength && !seen.has(idx)) {
      seen.add(idx);
      repaired.push(idx);
    }
  }
  for (let i = 0; i < queueLength; i++) {
    if (!seen.has(i)) repaired.push(i);
  }
  return repaired;
}

// Drops already-played entries off the front of the queue once an append pushes it past the
// user's maxQueueSize. playQueue has always windowed its input to the cap, but appends did not,
// so a radio session (one addToQueue per track played, never trimmed) grew without bound and
// re-serialised the whole array into SQLite on every mutation. Only entries behind the current
// track are ever dropped, so nothing the user is about to hear is lost. Returns null when there
// is nothing to trim.
export function trimQueueToCap(
  queue: CurrentTrack[],
  shuffleOrder: number[],
  queueIndex: number,
  isShuffled: boolean,
  maxQueueSize: number
): { queue: CurrentTrack[]; shuffleOrder: number[]; queueIndex: number } | null {
  if (maxQueueSize <= 0 || queue.length <= maxQueueSize) return null;
  const drop = Math.min(queue.length - maxQueueSize, queueIndex);
  if (drop <= 0) return null;

  if (isShuffled && shuffleOrder.length === queue.length) {
    // Positions, not queue indices, are what "already played" means under shuffle, so the
    // entries to drop come from the head of the order and are scattered through the queue.
    const removed = new Set(shuffleOrder.slice(0, drop));
    const newQueue: CurrentTrack[] = [];
    const remap = new Map<number, number>();
    for (let i = 0; i < queue.length; i++) {
      if (removed.has(i)) continue;
      remap.set(i, newQueue.length);
      newQueue.push(queue[i]!);
    }
    const newOrder = shuffleOrder.slice(drop).map((i) => remap.get(i)!);
    return { queue: newQueue, shuffleOrder: newOrder, queueIndex: queueIndex - drop };
  }

  return { queue: queue.slice(drop), shuffleOrder: [], queueIndex: queueIndex - drop };
}

// shuffleOrder[position] = index into queue[]; empty when not shuffled
export function resolveTrack(
  queue: CurrentTrack[],
  shuffleOrder: number[],
  isShuffled: boolean,
  position: number
): CurrentTrack | null {
  const idx = isShuffled && shuffleOrder.length > 0
    ? (shuffleOrder[position] ?? position)
    : position;
  return queue[idx] ?? null;
}

// anchorQueueIndex pins that queue index to position 0, so the track already playing stays
// playing when shuffle is switched on mid-track. Pass -1 to leave the shuffle unbiased: on a
// repeat-all loop-back nothing is playing yet, and anchoring there would make every pass open
// with the same track, which is the opposite of what re-shuffling on the wrap is for.
export function buildShuffleOrder(length: number, anchorQueueIndex: number): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }
  // Ensure anchor track is at position 0
  const anchorPos = indices.indexOf(anchorQueueIndex);
  if (anchorPos > 0) {
    [indices[0], indices[anchorPos]] = [indices[anchorPos]!, indices[0]!];
  }
  return indices;
}
