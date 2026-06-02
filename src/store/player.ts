import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { getDb } from "../db";

export interface CurrentTrack {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  coverArtUrl?: string | null;
  artworkRef?: string | null;
  album?: string | null;
  albumId?: string | null;
}

export type RepeatMode = "off" | "repeat-all" | "repeat-one";

export type RadioMode =
  | "curated"
  | "same-genre"
  | "similar-artists"
  | "same-artist"
  | "same-album"
  | "era"
  | "loved"
  | "random";

export const RADIO_MODES: { mode: RadioMode; label: string }[] = [
  { mode: "curated",          label: "Curated" },
  { mode: "same-genre",       label: "Same Genre" },
  { mode: "similar-artists",  label: "Similar Artists" },
  { mode: "same-artist",      label: "Same Artist" },
  { mode: "same-album",       label: "Same Album" },
  { mode: "era",              label: "Same Era" },
  { mode: "loved",            label: "Loved Tracks" },
  { mode: "random",           label: "Random" },
];

const PREV_RESTART_THRESHOLD_S = 3;

function adjustIndexAfterMove(currentIdx: number, from: number, to: number): number {
  if (from === currentIdx) return to;
  let adj = currentIdx;
  if (from < adj) adj--;
  if (to <= adj) adj++;
  return adj;
}

// shuffleOrder[position] = index into queue[]; empty when not shuffled
function resolveTrack(
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

function buildShuffleOrder(length: number, anchorQueueIndex: number): number[] {
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

interface QueueSnapshot {
  queue: CurrentTrack[];
  queueIndex: number;
  shuffleOrder: number[];
  isShuffled: boolean;
  currentTrack: CurrentTrack | null;
}

interface PlayerState {
  currentTrack: CurrentTrack | null;
  streamUrl: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  elapsed: number;
  volume: number;
  repeat: RepeatMode;
  isShuffled: boolean;
  shuffleOrder: number[];
  queue: CurrentTrack[];
  queueIndex: number;
  streamUrlFor: ((track: CurrentTrack) => string) | null;
  playStartedAt: number;
  radioActive: boolean;
  radioSeed: CurrentTrack | null;
  radioMode: RadioMode;

  isQueueOpen: boolean;
  accentColor: string | null;
  waveformPeaks: number[] | null;

  sleepTimerEndsAt: number | null;
  sleepTimerEndOfTrack: boolean;
  setSleepTimer: (preset: number | "end-of-track") => void;
  clearSleepTimer: () => void;

  play: (track: CurrentTrack, streamUrl: string) => Promise<void>;
  playQueue: (tracks: CurrentTrack[], streamUrlFor: (t: CurrentTrack) => string, startIndex?: number) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  setVolume: (volume: number) => Promise<void>;
  seek: (seconds: number) => Promise<void>;
  toggleRepeat: () => Promise<void>;
  toggleShuffle: () => void;
  setStreamUrlFor: (fn: (t: CurrentTrack) => string) => void;
  setRadioActive: (active: boolean) => void;
  startRadio: (seed: CurrentTrack, mode?: RadioMode) => void;
  setRadioMode: (mode: RadioMode) => void;
  loadSettings: () => Promise<void>;
  addToQueue: (track: CurrentTrack, streamUrlFn: (t: CurrentTrack) => string) => void;
  playNext: (track: CurrentTrack, streamUrlFn: (t: CurrentTrack) => string) => void;
  toggleQueue: () => void;
  removeFromQueue: (position: number) => Promise<void>;
  setAccentColor: (color: string | null) => void;
  moveQueueItem: (from: number, to: number) => void;
  playFromQueueIndex: (position: number) => Promise<void>;
  setWaveformPeaks: (peaks: number[] | null) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  let elapsedInterval: ReturnType<typeof setInterval> | null = null;
  let cancelWaveform: (() => void) | null = null;
  let sleepTimerTimeout: ReturnType<typeof setTimeout> | null = null;

  function startElapsedTimer() {
    if (elapsedInterval) clearInterval(elapsedInterval);
    let prefetchedForIndex: number | null = null;
    elapsedInterval = setInterval(() => {
      invoke<number>("audio_get_pos")
        .then((pos) => {
          set({ elapsed: pos });
          const { queue, queueIndex, streamUrlFor, currentTrack, isShuffled, shuffleOrder } = get();
          const duration = currentTrack?.duration ?? null;
          const nextPosition = queueIndex + 1;
          if (
            duration &&
            pos / duration >= 0.8 &&
            nextPosition < queue.length &&
            streamUrlFor &&
            prefetchedForIndex !== queueIndex
          ) {
            prefetchedForIndex = queueIndex;
            const nextTrack = resolveTrack(queue, shuffleOrder, isShuffled, nextPosition);
            if (nextTrack) {
              invoke("audio_prefetch", { url: streamUrlFor(nextTrack) }).catch(() => {});
            }
          }
        })
        .catch(() => {});
    }, 200);
  }

  function stopElapsedTimer() {
    if (elapsedInterval) {
      clearInterval(elapsedInterval);
      elapsedInterval = null;
    }
  }

  async function fetchWaveform(trackId: string, url: string) {
    // Cancel any in-flight extraction from the previous track before registering new listeners
    cancelWaveform?.();
    cancelWaveform = null;

    try {
      const db = await getDb();

      const settingRows = await db.select<{ value: string }[]>(
        "SELECT value FROM settings WHERE key = 'player.show_waveform'",
        []
      );
      if ((settingRows[0]?.value ?? "false") !== "true") return;

      type Row = { peaks_json: string };
      const rows = await db.select<Row[]>(
        "SELECT peaks_json FROM waveform_cache WHERE track_id = ?",
        [trackId]
      );
      if (rows[0]) {
        if (get().currentTrack?.id === trackId) {
          set({ waveformPeaks: JSON.parse(rows[0].peaks_json) as number[] });
        }
        return;
      }

      // Accumulate raw (un-normalized) chunks as they arrive, normalize for display
      const rawPeaks = new Array<number>(200).fill(0);
      let runningMax = 0;

      const unlistenChunk = await listen<{ track_id: string; offset: number; peaks: number[] }>(
        "waveform_chunk",
        (event) => {
          if (event.payload.track_id !== trackId) return;
          const { offset, peaks } = event.payload;
          for (let i = 0; i < peaks.length; i++) {
            const v = peaks[i] ?? 0;
            rawPeaks[offset + i] = v;
            if (v > runningMax) runningMax = v;
          }
          if (get().currentTrack?.id !== trackId) return;
          const normalized = runningMax > 0 ? rawPeaks.map((p) => p / runningMax) : rawPeaks.slice();
          set({ waveformPeaks: normalized });
        }
      );

      const unlistenComplete = await listen<{ track_id: string; peaks: number[] }>(
        "waveform_complete",
        async (event) => {
          // Guard before unlisten: a stale event from a prior track must not kill the current track's listeners
          if (event.payload.track_id !== trackId) return;
          unlistenChunk();
          unlistenComplete();
          cancelWaveform = null;
          if (get().currentTrack?.id === trackId) {
            set({ waveformPeaks: event.payload.peaks });
          }
          const now = Math.floor(Date.now() / 1000);
          await db.execute(
            "INSERT OR REPLACE INTO waveform_cache (track_id, peaks_json, created_at) VALUES (?, ?, ?)",
            [trackId, JSON.stringify(event.payload.peaks), now]
          );
        }
      );

      // Hold references so a future track can cancel these listeners if it starts before waveform_complete fires
      cancelWaveform = () => {
        unlistenChunk();
        unlistenComplete();
      };

      // Request low-bitrate audio for analysis — Navidrome transcodes to ~64kbps mono,
      // 4-8x less data to download and decode vs full-quality stream.
      const waveformUrl = (() => {
        try {
          const u = new URL(url);
          u.searchParams.set("maxBitRate", "32");
          u.searchParams.set("format", "mp3");
          return u.toString();
        } catch {
          return url;
        }
      })();
      void invoke("audio_extract_waveform", { trackId, url: waveformUrl, durationSecs: get().currentTrack?.duration ?? 0 });
    } catch (e) {
      console.error("Failed to fetch waveform:", e);
    }
  }

  async function playTrack(track: CurrentTrack, url: string) {
    set({ currentTrack: track, streamUrl: url, isPlaying: false, isLoading: true, error: null, elapsed: 0, playStartedAt: Date.now(), waveformPeaks: null });
    stopElapsedTimer();
    try {
      await invoke("audio_play", { url });
      set({ isPlaying: true, isLoading: false });
      startElapsedTimer();
      void fetchWaveform(track.id, url);
    } catch (e) {
      set({ isPlaying: false, isLoading: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function persistRadioState() {
    try {
      const { radioActive, radioSeed, radioMode } = get();
      const db = await getDb();
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('radio_active', ?)",
        [radioActive ? "1" : "0"]
      );
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('radio_seed', ?)",
        [radioSeed ? JSON.stringify(radioSeed) : ""]
      );
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('radio_mode', ?)",
        [radioMode]
      );
    } catch (e) {
      console.error("Failed to persist radio state:", e);
    }
  }

  async function persistQueueState() {
    try {
      const { queue, queueIndex, shuffleOrder, isShuffled, currentTrack } = get();
      const snapshot: QueueSnapshot = { queue, queueIndex, shuffleOrder, isShuffled, currentTrack };
      const db = await getDb();
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('queue_state', ?)",
        [JSON.stringify(snapshot)]
      );
    } catch (e) {
      console.error("Failed to persist queue state:", e);
    }
  }

  return {
    currentTrack: null,
    streamUrl: null,
    isPlaying: false,
    isLoading: false,
    error: null,
    elapsed: 0,
    volume: 1,
    repeat: "off",
    isShuffled: false,
    shuffleOrder: [],
    queue: [],
    queueIndex: 0,
    streamUrlFor: null,
    playStartedAt: 0,
    radioActive: false,
    radioSeed: null,
    radioMode: "curated",
    isQueueOpen: false,
    accentColor: null,
    waveformPeaks: null,

    sleepTimerEndsAt: null,
    sleepTimerEndOfTrack: false,

    setWaveformPeaks: (peaks) => {
      set({ waveformPeaks: peaks });
    },

    play: async (track, streamUrl) => {
      set({ queue: [track], queueIndex: 0, streamUrlFor: () => streamUrl, shuffleOrder: [] });
      await playTrack(track, streamUrl);
      void persistQueueState();
    },

    playQueue: async (tracks, streamUrlFor, startIndex = 0) => {
      const { isShuffled } = get();
      let shuffleOrder: number[] = [];
      let position = startIndex;

      if (isShuffled && tracks.length > 1) {
        shuffleOrder = buildShuffleOrder(tracks.length, startIndex);
        position = 0;
      }

      set({ queue: tracks, queueIndex: position, streamUrlFor, shuffleOrder, radioActive: false, radioSeed: null });
      const track = resolveTrack(tracks, shuffleOrder, isShuffled, position);
      if (track) await playTrack(track, streamUrlFor(track));
      void persistQueueState();
      void persistRadioState();
    },

    setSleepTimer: (preset) => {
      if (sleepTimerTimeout) { clearTimeout(sleepTimerTimeout); sleepTimerTimeout = null; }
      if (preset === "end-of-track") {
        set({ sleepTimerEndOfTrack: true, sleepTimerEndsAt: null });
      } else {
        const endsAt = Date.now() + preset * 60 * 1000;
        set({ sleepTimerEndsAt: endsAt, sleepTimerEndOfTrack: false });
        sleepTimerTimeout = setTimeout(() => {
          get().pause();
          get().clearSleepTimer();
        }, preset * 60 * 1000);
      }
    },

    clearSleepTimer: () => {
      if (sleepTimerTimeout) { clearTimeout(sleepTimerTimeout); sleepTimerTimeout = null; }
      set({ sleepTimerEndsAt: null, sleepTimerEndOfTrack: false });
    },

    next: async () => {
      const { queue, queueIndex, streamUrlFor, repeat, isShuffled, shuffleOrder } = get();
      if (queue.length === 0 || !streamUrlFor) return;

      if (get().sleepTimerEndOfTrack) {
        get().clearSleepTimer();
        stopElapsedTimer();
        set({ isPlaying: false });
        void persistQueueState();
        return;
      }

      if (repeat === "repeat-one") {
        const track = resolveTrack(queue, shuffleOrder, isShuffled, queueIndex);
        if (track) await playTrack(track, streamUrlFor(track));
        void persistQueueState();
        return;
      }

      const nextPosition = queueIndex + 1;
      if (nextPosition < queue.length) {
        set({ queueIndex: nextPosition });
        const track = resolveTrack(queue, shuffleOrder, isShuffled, nextPosition);
        if (track) await playTrack(track, streamUrlFor(track));
      } else if (repeat === "repeat-all") {
        // Re-shuffle on loop-back so each pass plays a different order
        const newShuffleOrder = isShuffled && queue.length > 1
          ? buildShuffleOrder(queue.length, 0)
          : shuffleOrder;
        set({ queueIndex: 0, shuffleOrder: newShuffleOrder });
        const track = resolveTrack(queue, newShuffleOrder, isShuffled, 0);
        if (track) await playTrack(track, streamUrlFor(track));
      } else {
        get().stop();
      }
      void persistQueueState();
    },

    prev: async () => {
      const { queue, queueIndex, streamUrlFor, elapsed, isShuffled, shuffleOrder } = get();
      if (queue.length === 0 || !streamUrlFor) return;
      const newPosition = elapsed > PREV_RESTART_THRESHOLD_S
        ? queueIndex
        : Math.max(0, queueIndex - 1);
      set({ queueIndex: newPosition });
      const track = resolveTrack(queue, shuffleOrder, isShuffled, newPosition);
      if (track) await playTrack(track, streamUrlFor(track));
      void persistQueueState();
    },

    pause: () => {
      invoke("audio_pause").catch(console.error);
      stopElapsedTimer();
      set({ isPlaying: false });
    },

    resume: () => {
      invoke("audio_resume").catch(console.error);
      startElapsedTimer();
      set({ isPlaying: true });
    },

    stop: () => {
      invoke("audio_stop").catch(console.error);
      stopElapsedTimer();
      set({
        currentTrack: null,
        streamUrl: null,
        isPlaying: false,
        isLoading: false,
        elapsed: 0,
        // queue, queueIndex, streamUrlFor preserved — accidental stop doesn't destroy queue
      });
      void persistQueueState();
    },

    setVolume: async (volume: number) => {
      set({ volume });
      // Square-law perceptual scaling: linear knob maps to perceived loudness
      await invoke("audio_volume", { volume: volume ** 2 });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('volume', ?)",
          [String(volume)]
        );
      } catch (e) {
        console.error("Failed to persist volume:", e);
      }
    },

    seek: async (seconds: number) => {
      set({ elapsed: seconds });
      await invoke("audio_seek", { seconds });
    },

    toggleRepeat: async () => {
      const { repeat } = get();
      const next: RepeatMode =
        repeat === "off" ? "repeat-all" : repeat === "repeat-all" ? "repeat-one" : "off";
      set({ repeat: next });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('repeat', ?)",
          [next]
        );
      } catch (e) {
        console.error("Failed to persist repeat:", e);
      }
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

    setStreamUrlFor: (fn) => {
      set({ streamUrlFor: fn });
    },

    setRadioActive: (active: boolean) => {
      set({ radioActive: active, ...(!active ? { radioSeed: null } : {}) });
      void persistRadioState();
    },

    startRadio: (seed: CurrentTrack, mode?: RadioMode) => {
      set({ radioActive: true, radioSeed: seed, ...(mode ? { radioMode: mode } : {}) });
      void persistRadioState();
    },

    setRadioMode: (mode: RadioMode) => {
      set({ radioMode: mode });
      void persistRadioState();
    },

    addToQueue: (track, streamUrlFn) => {
      const { queue, isShuffled, shuffleOrder, streamUrlFor } = get();
      const newQueue = [...queue, track];
      const newTrackIdx = queue.length;
      if (isShuffled) {
        set({ queue: newQueue, shuffleOrder: [...shuffleOrder, newTrackIdx], streamUrlFor: streamUrlFn ?? streamUrlFor });
      } else {
        set({ queue: newQueue, streamUrlFor: streamUrlFn ?? streamUrlFor });
      }
      void persistQueueState();
    },

    playNext: (track, streamUrlFn) => {
      const { queue, queueIndex, isShuffled, shuffleOrder, streamUrlFor } = get();
      if (isShuffled) {
        const newQueue = [...queue, track];
        const newTrackIdx = queue.length;
        const newOrder = [...shuffleOrder];
        newOrder.splice(queueIndex + 1, 0, newTrackIdx);
        set({ queue: newQueue, shuffleOrder: newOrder, streamUrlFor: streamUrlFn ?? streamUrlFor });
      } else {
        const newQueue = [...queue];
        newQueue.splice(queueIndex + 1, 0, track);
        set({ queue: newQueue, streamUrlFor: streamUrlFn ?? streamUrlFor });
      }
      void persistQueueState();
    },

    toggleQueue: () => {
      set((s) => ({ isQueueOpen: !s.isQueueOpen }));
    },

    setAccentColor: (color) => {
      set({ accentColor: color });
    },

    removeFromQueue: async (position) => {
      const { queue, queueIndex, isShuffled, shuffleOrder, streamUrlFor } = get();
      if (position < 0 || position >= queue.length) return;

      let newQueue: CurrentTrack[];
      let newShuffleOrder: number[];
      let newQueueIndex: number;

      if (isShuffled) {
        const actualIdx = shuffleOrder[position]!;
        newQueue = [...queue];
        newQueue.splice(actualIdx, 1);
        newShuffleOrder = shuffleOrder
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
        // Removing currently playing track — play what's now at that position or stop
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
        const newOrder = [...shuffleOrder];
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

    loadSettings: async () => {
      try {
        const db = await getDb();
        const rows = await db.select<{ key: string; value: string }[]>(
          "SELECT key, value FROM settings WHERE key IN ('volume', 'repeat', 'queue_state', 'radio_active', 'radio_seed')",
          []
        );
        for (const row of rows) {
          if (row.key === "volume") {
            const volume = parseFloat(row.value);
            if (!isNaN(volume)) {
              set({ volume });
              await invoke("audio_volume", { volume: volume ** 2 });
            }
          } else if (row.key === "repeat") {
            const valid: RepeatMode[] = ["off", "repeat-all", "repeat-one"];
            if (valid.includes(row.value as RepeatMode)) {
              set({ repeat: row.value as RepeatMode });
            }
          } else if (row.key === "queue_state") {
            try {
              const saved = JSON.parse(row.value) as QueueSnapshot;
              if (Array.isArray(saved.queue) && saved.queue.length > 0) {
                set({
                  queue: saved.queue,
                  queueIndex: saved.queueIndex ?? 0,
                  shuffleOrder: saved.shuffleOrder ?? [],
                  isShuffled: saved.isShuffled ?? false,
                  currentTrack: saved.currentTrack ?? null,
                });
              }
            } catch {
              // malformed snapshot, ignore
            }
          } else if (row.key === "radio_active") {
            set({ radioActive: row.value === "1" });
          } else if (row.key === "radio_seed") {
            if (row.value) {
              try {
                const seed = JSON.parse(row.value) as CurrentTrack;
                set({ radioSeed: seed });
              } catch {
                // malformed seed, ignore
              }
            }
          } else if (row.key === "radio_mode") {
            const VALID_MODES: RadioMode[] = ["curated", "same-genre", "similar-artists", "same-artist", "same-album", "era", "loved", "random"];
            if (VALID_MODES.includes(row.value as RadioMode)) {
              set({ radioMode: row.value as RadioMode });
            }
          }
        }
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
    },
  };
});
