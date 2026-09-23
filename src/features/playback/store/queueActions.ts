import { adjustIndexAfterMove, buildShuffleOrder, normalizeShuffleOrder, resolveTrack, trimQueueToCap } from "./queueOrder";
import type { PlayerEngine } from "./playerEngine";
import type { PlayerPersistence } from "./playerPersistence";
import type { CurrentTrack, PlayerGet, PlayerSet, PlayerState } from "./playerTypes";

type QueueActions = Pick<
  PlayerState,
  | "restoreQueue"
  | "applyTrackIdRemap"
  | "toggleShuffle"
  | "addToQueue"
  | "playNext"
  | "addManyToQueue"
  | "playNextMany"
  | "removeFromQueue"
  | "removeManyFromQueue"
  | "clearQueue"
  | "playFromQueueIndex"
  | "moveQueueItem"
>;

export function createQueueActions(
  set: PlayerSet,
  get: PlayerGet,
  { playTrack }: PlayerEngine,
  { persistQueueState }: PlayerPersistence
): QueueActions {
  return {
    // Seeds the queue from a saved session without starting playback. playQueue cannot be used
    // for this: it calls playTrack, which spawns a download and decode in Rust, so restoring a
    // session used to fetch a whole track at startup and then race a pause() against it. The
    // engine stays empty here, and resume() routes a first play through retryCurrent so the
    // track is loaded on demand.
    restoreQueue: (tracks, streamUrlFn, position) => {
      if (tracks.length === 0) return;
      const clamped = Math.max(0, Math.min(position, tracks.length - 1));
      set({
        queue: tracks,
        queueIndex: clamped,
        shuffleOrder: [],
        isShuffled: false,
        currentTrack: tracks[clamped] ?? null,
        streamUrl: null,
        streamUrlFor: streamUrlFn,
        isPlaying: false,
        elapsed: 0,
      });
      void persistQueueState();
    },

    // Rewrite the ids of tracks the server renamed under us, so the queue the user is looking
    // at keeps playing instead of every entry 404ing. Returns whether the current track is one
    // of them, which is the caller's cue to restart playback against the new id.
    applyTrackIdRemap: (remaps) => {
      if (remaps.length === 0) return false;
      const byOldId = new Map(remaps.map((remap) => [remap.oldId, remap.newId]));
      const rename = (track: CurrentTrack): CurrentTrack => {
        const newId = byOldId.get(track.id);
        return newId === undefined ? track : { ...track, id: newId };
      };
      const { queue, currentTrack, radioSeed } = get();
      const newQueue = queue.map(rename);
      // Reference equality decides the re-render for every queue consumer, so a repair that
      // touched nothing this queue holds must leave the array alone.
      const queueChanged = newQueue.some((track, index) => track !== queue[index]);
      const newCurrent = currentTrack ? rename(currentTrack) : null;
      const newSeed = radioSeed ? rename(radioSeed) : null;
      if (queueChanged) set({ queue: newQueue });
      if (newCurrent !== currentTrack) set({ currentTrack: newCurrent });
      if (newSeed !== radioSeed) set({ radioSeed: newSeed });
      return newCurrent !== currentTrack;
    },

    toggleShuffle: () => {
      const { isShuffled, queue, queueIndex, shuffleOrder } = get();
      if (isShuffled) {
        // Restore: resolve current position back to its actual queue index
        const actualIndex = shuffleOrder.length > 0
          ? (shuffleOrder[queueIndex] ?? queueIndex)
          : queueIndex;
        set({ isShuffled: false, shuffleOrder: [], queueIndex: actualIndex });
      } else {
        if (queue.length <= 1) {
          set({ isShuffled: true, shuffleOrder: queue.length === 1 ? [0] : [] });
          void persistQueueState();
          return;
        }
        const newOrder = buildShuffleOrder(queue.length, queueIndex);
        set({ isShuffled: true, shuffleOrder: newOrder, queueIndex: 0 });
      }
      void persistQueueState();
    },

    addToQueue: (track, streamUrlFn) => {
      get().addManyToQueue([track], streamUrlFn);
    },

    playNext: (track, streamUrlFn) => {
      get().playNextMany([track], streamUrlFn);
    },

    // Batch appends commit once. Looping the single-track action instead (which is what the
    // album "queue last" / "queue next" actions used to do) costs one store commit, one full
    // queue copy and one persist bump per track, so a 20-track album fired 20 re-render passes
    // and copied the queue 20 times.
    addManyToQueue: (tracks, streamUrlFn) => {
      if (tracks.length === 0) return;
      const { queue, queueIndex, isShuffled, shuffleOrder, streamUrlFor, maxQueueSize } = get();
      const newQueue = [...queue, ...tracks];
      let newOrder: number[] = [];
      if (isShuffled) {
        newOrder = normalizeShuffleOrder(shuffleOrder, queue.length);
        for (let i = 0; i < tracks.length; i++) newOrder.push(queue.length + i);
      }
      const trimmed = trimQueueToCap(newQueue, newOrder, queueIndex, isShuffled, maxQueueSize);
      set({
        queue: trimmed?.queue ?? newQueue,
        ...(isShuffled ? { shuffleOrder: trimmed?.shuffleOrder ?? newOrder } : {}),
        ...(trimmed ? { queueIndex: trimmed.queueIndex } : {}),
        streamUrlFor: streamUrlFn ?? streamUrlFor,
      });
      void persistQueueState();
    },

    playNextMany: (tracks, streamUrlFn) => {
      if (tracks.length === 0) return;
      const { queue, queueIndex, isShuffled, shuffleOrder, streamUrlFor, maxQueueSize } = get();
      let newQueue: CurrentTrack[];
      let newOrder: number[] = [];
      if (isShuffled) {
        newQueue = [...queue, ...tracks];
        newOrder = normalizeShuffleOrder(shuffleOrder, queue.length);
        newOrder.splice(queueIndex + 1, 0, ...tracks.map((_, i) => queue.length + i));
      } else {
        newQueue = [...queue];
        newQueue.splice(queueIndex + 1, 0, ...tracks);
      }
      const trimmed = trimQueueToCap(newQueue, newOrder, queueIndex, isShuffled, maxQueueSize);
      set({
        queue: trimmed?.queue ?? newQueue,
        ...(isShuffled ? { shuffleOrder: trimmed?.shuffleOrder ?? newOrder } : {}),
        ...(trimmed ? { queueIndex: trimmed.queueIndex } : {}),
        streamUrlFor: streamUrlFn ?? streamUrlFor,
      });
      void persistQueueState();
    },

    removeFromQueue: async (position) => {
      const { queue, queueIndex, isShuffled, shuffleOrder, streamUrlFor } = get();
      if (position < 0 || position >= queue.length) return;

      let newQueue: CurrentTrack[];
      let newShuffleOrder: number[];
      let newQueueIndex: number;

      if (isShuffled) {
        const order = normalizeShuffleOrder(shuffleOrder, queue.length);
        const actualIdx = order[position]!;
        newQueue = [...queue];
        newQueue.splice(actualIdx, 1);
        newShuffleOrder = order
          .filter((_, i) => i !== position)
          .map((idx) => (idx > actualIdx ? idx - 1 : idx));
        newQueueIndex = position < queueIndex ? queueIndex - 1 : queueIndex;
      } else {
        newQueue = [...queue];
        newQueue.splice(position, 1);
        newShuffleOrder = [];
        newQueueIndex = position < queueIndex ? queueIndex - 1 : queueIndex;
      }

      if (position === queueIndex) {
        // Removing currently playing track, play what's now at that position or stop
        set({ queue: newQueue, shuffleOrder: newShuffleOrder, queueIndex: newQueueIndex });
        if (newQueueIndex < newQueue.length && streamUrlFor) {
          const nextTrack = resolveTrack(newQueue, newShuffleOrder, isShuffled, newQueueIndex);
          if (nextTrack) await playTrack(nextTrack, streamUrlFor(nextTrack));
        } else {
          get().stop();
        }
      } else {
        set({ queue: newQueue, shuffleOrder: newShuffleOrder, queueIndex: newQueueIndex });
        // If queue is now empty and repeat requires it, just stop cleanly
        if (newQueue.length === 0) get().stop();
      }
      void persistQueueState();
    },

    removeManyFromQueue: async (positions: number[]) => {
      if (positions.length === 0) return;
      const { queue, queueIndex, isShuffled, shuffleOrder, streamUrlFor } = get();

      // Sort descending so we remove high indices first, avoids index drift
      const sorted = [...new Set(positions)].sort((a, b) => b - a);

      let newQueue = [...queue];
      let newShuffleOrder = isShuffled ? normalizeShuffleOrder(shuffleOrder, queue.length) : [...shuffleOrder];
      let newQueueIndex = queueIndex;
      let removedCurrentTrack = false;

      for (const pos of sorted) {
        if (pos < 0 || pos >= newQueue.length) continue;
        if (isShuffled && newShuffleOrder.length > 0) {
          const actualIdx = newShuffleOrder[pos]!;
          newQueue.splice(actualIdx, 1);
          newShuffleOrder = newShuffleOrder
            .filter((_, i) => i !== pos)
            .map((idx) => (idx > actualIdx ? idx - 1 : idx));
          if (pos < newQueueIndex) newQueueIndex--;
          else if (pos === newQueueIndex) removedCurrentTrack = true;
        } else {
          newQueue.splice(pos, 1);
          if (pos < newQueueIndex) newQueueIndex--;
          else if (pos === newQueueIndex) removedCurrentTrack = true;
        }
      }

      newQueueIndex = Math.min(newQueueIndex, Math.max(0, newQueue.length - 1));
      set({ queue: newQueue, shuffleOrder: newShuffleOrder, queueIndex: newQueueIndex });

      if (removedCurrentTrack) {
        if (newQueue.length > 0 && streamUrlFor) {
          const next = resolveTrack(newQueue, newShuffleOrder, isShuffled, newQueueIndex);
          if (next) await playTrack(next, streamUrlFor(next));
        } else {
          get().stop();
        }
      }
      void persistQueueState();
    },

    clearQueue: () => {
      // Unlike stop(), this is an explicit request to throw the queue away, so the queue and
      // its shuffle order go too. streamUrlFor is kept: App re-supplies it per server, and
      // dropping it here would leave a later addToQueue with no way to build a stream URL.
      get().stop();
      set({ queue: [], queueIndex: 0, shuffleOrder: [] });
      // A radio session survives an empty queue and would silently start appending again the
      // next time something plays. Clearing the queue is an explicit "stop feeding me tracks".
      if (get().radioActive) get().setRadioActive(false);
      void persistQueueState();
    },

    playFromQueueIndex: async (position: number) => {
      const { queue, streamUrlFor, isShuffled, shuffleOrder } = get();
      if (position < 0 || position >= queue.length || !streamUrlFor) return;
      set({ queueIndex: position });
      const track = resolveTrack(queue, shuffleOrder, isShuffled, position);
      if (track) await playTrack(track, streamUrlFor(track));
      void persistQueueState();
    },

    moveQueueItem: (from, to) => {
      const { queue, queueIndex, isShuffled, shuffleOrder } = get();
      if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
      const newQueueIndex = adjustIndexAfterMove(queueIndex, from, to);

      if (isShuffled) {
        // Splicing an order that does not cover the whole queue shifts every position after
        // the splice point, so this normalizes first for the same reason the append paths do.
        const newOrder = normalizeShuffleOrder(shuffleOrder, queue.length);
        const [item] = newOrder.splice(from, 1);
        newOrder.splice(to, 0, item!);
        set({ shuffleOrder: newOrder, queueIndex: newQueueIndex });
      } else {
        const newQueue = [...queue];
        const [item] = newQueue.splice(from, 1);
        newQueue.splice(to, 0, item!);
        set({ queue: newQueue, queueIndex: newQueueIndex });
      }
      void persistQueueState();
    },
  };
}
