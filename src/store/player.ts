import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { getDb } from "../db";
import { LocalTarget, DlnaTarget, type PlaybackTarget } from "./playbackTarget";
import { discoverRenderers, type DlnaRenderer } from "../lib/dlna";

export interface CurrentTrack {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  coverArtUrl?: string | null;
  artworkRef?: string | null;
  album?: string | null;
  albumId?: string | null;
  replayGain?: {
    trackGain?: number | null;
    trackPeak?: number | null;
    albumGain?: number | null;
    albumPeak?: number | null;
  } | null;
}

export type ReplayGainMode = "off" | "track" | "album";

type RepeatMode = "off" | "repeat-all" | "repeat-one";

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

// Deduplicates natural-end advances triggered by both the Rust event and the TS fallback.
let lastEndedTrackId: string | null = null;

// True while a next track has been enqueued via audio_enqueue_next for gapless playback.
// Suppresses the position-based fallback advance so it doesn't interrupt the gapless transition.
let gaplessActive = false;

// Cancels in-flight audio-error retry listener when a new track starts.
let cancelAudioError: (() => void) | null = null;
// Debounces rapid prev/next so only one HTTP fetch fires after the user stops skipping.
let navDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// Current ReplayGain linear amplitude multiplier. Updated on track change and mode change.
// Stored outside the store so setVolume can access the latest value without a selector.
let currentReplayGainLinear = 1.0;

function computeReplayGainLinear(
  rg: CurrentTrack["replayGain"],
  mode: ReplayGainMode,
  preAmpDb: number,
  fallbackDb: number
): number {
  if (mode === "off") return 1.0;
  let gainDb: number;
  let peak: number;
  if (mode === "album" && rg?.albumGain != null) {
    gainDb = rg.albumGain;
    peak = rg.albumPeak ?? 1.0;
  } else if (rg?.trackGain != null) {
    gainDb = rg.trackGain;
    peak = rg.trackPeak ?? 1.0;
  } else {
    gainDb = fallbackDb;
    peak = 1.0;
  }
  const linear = Math.pow(10, (gainDb + preAmpDb) / 20);
  // Clipping prevention: cap so that peak sample stays at or below 1.0
  return Math.min(linear, 1.0 / Math.max(peak, 0.001));
}

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
  radioLabel: string | null;
  radioSimilarityScale: number;

  isQueueOpen: boolean;
  accentColor: string | null;
  waveformPeaks: number[] | null;

  sleepTimerEndsAt: number | null;
  sleepTimerEndOfTrack: boolean;
  setSleepTimer: (preset: number | "end-of-track") => void;
  clearSleepTimer: () => void;

  speed: number;
  pauseFadeMs: number;
  consumeMode: boolean;
  consumeOnSkip: boolean;
  gapless: boolean;
  radioOnQueueEnd: boolean;
  audioFormat: { sampleRate: number; channels: number; codec: string } | null;

  replayGainMode: ReplayGainMode;
  replayGainPreAmp: number;
  replayGainFallbackGain: number;
  setReplayGainMode: (mode: ReplayGainMode) => Promise<void>;
  setReplayGainPreAmp: (db: number) => Promise<void>;
  setReplayGainFallbackGain: (db: number) => Promise<void>;

  castDevice: DlnaRenderer | null;
  availableRenderers: DlnaRenderer[];
  isScanningRenderers: boolean;
  rendererScanError: string | null;
  scanRenderers: () => Promise<void>;
  setCastDevice: (renderer: DlnaRenderer | null) => Promise<void>;

  play: (track: CurrentTrack, streamUrl: string) => Promise<void>;
  playQueue: (tracks: CurrentTrack[], streamUrlFor: (t: CurrentTrack) => string, startIndex?: number) => Promise<void>;
  next: (fromNaturalEnd?: boolean) => Promise<void>;
  prev: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  setVolume: (volume: number) => Promise<void>;
  seek: (seconds: number) => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  toggleRepeat: () => Promise<void>;
  toggleShuffle: () => void;
  setStreamUrlFor: (fn: (t: CurrentTrack) => string) => void;
  setRadioActive: (active: boolean) => void;
  startRadio: (seed: CurrentTrack, mode?: RadioMode, label?: string) => void;
  setRadioMode: (mode: RadioMode) => void;
  setRadioSimilarityScale: (scale: number) => void;
  toggleConsumeMode: () => Promise<void>;
  toggleConsumeOnSkip: () => Promise<void>;
  toggleGapless: () => Promise<void>;
  toggleRadioOnQueueEnd: () => Promise<void>;
  loadSettings: () => Promise<void>;
  addToQueue: (track: CurrentTrack, streamUrlFn: (t: CurrentTrack) => string) => void;
  playNext: (track: CurrentTrack, streamUrlFn: (t: CurrentTrack) => string) => void;
  toggleQueue: () => void;
  removeFromQueue: (position: number) => Promise<void>;
  removeManyFromQueue: (positions: number[]) => Promise<void>;
  setAccentColor: (color: string | null) => void;
  moveQueueItem: (from: number, to: number) => void;
  playFromQueueIndex: (position: number) => Promise<void>;
  setWaveformPeaks: (peaks: number[] | null) => void;
  setPauseFadeMs: (ms: number) => Promise<void>;
}

// Active playback target — swapped when casting to a DLNA renderer.
// Lives outside the store to avoid serialization; all state mutations go through store actions.
let activeTarget: PlaybackTarget = new LocalTarget();

export const usePlayerStore = create<PlayerState>((set, get) => {
  let elapsedInterval: ReturnType<typeof setInterval> | null = null;
  let cancelWaveform: (() => void) | null = null;
  let sleepTimerTimeout: ReturnType<typeof setTimeout> | null = null;
  // Tracks whether the TS fallback already fired next() for the current track position.
  let naturalEndFiredForIndex: number | null = null;

  // Global listener: update audioFormat whenever Rust emits it at play start.
  void listen<{ sample_rate: number; channels: number; codec: string }>("audio-format", (event) => {
    set({ audioFormat: { sampleRate: event.payload.sample_rate, channels: event.payload.channels, codec: event.payload.codec } });
  });

  // Gapless transition: Rust reports that the current source finished and the queued next one started.
  // Advance queue state without calling audio_play — the audio is already playing.
  void listen("track-advanced", () => {
    gaplessActive = false;
    naturalEndFiredForIndex = null;
    lastEndedTrackId = null;
    const { queue, queueIndex, streamUrlFor, isShuffled, shuffleOrder, repeat } = get();
    if (!streamUrlFor) return;
    const nextPosition = queueIndex + 1;
    let newQueueIndex = nextPosition;
    let newShuffleOrder = shuffleOrder;
    if (nextPosition < queue.length) {
      newQueueIndex = nextPosition;
    } else if (repeat === "repeat-all") {
      newQueueIndex = 0;
      newShuffleOrder = isShuffled && queue.length > 1 ? buildShuffleOrder(queue.length, 0) : shuffleOrder;
    } else {
      return;
    }
    const nextTrack = resolveTrack(queue, newShuffleOrder, isShuffled, newQueueIndex);
    if (!nextTrack) return;
    set({
      queueIndex: newQueueIndex,
      shuffleOrder: newShuffleOrder,
      currentTrack: nextTrack,
      streamUrl: streamUrlFor(nextTrack),
      elapsed: 0,
      playStartedAt: Date.now(),
      isPlaying: true,
      isLoading: false,
      waveformPeaks: null,
    });
    // Apply ReplayGain for the gapless-advanced track
    const { volume, replayGainMode, replayGainPreAmp, replayGainFallbackGain, castDevice } = get();
    currentReplayGainLinear = castDevice
      ? 1.0
      : computeReplayGainLinear(nextTrack.replayGain, replayGainMode, replayGainPreAmp, replayGainFallbackGain);
    void activeTarget.setVolume(volume * Math.sqrt(currentReplayGainLinear));
    startElapsedTimer();
    void preloadWaveforms();
    void fetchWaveform(nextTrack.id, streamUrlFor(nextTrack));
    void persistQueueState();
  });

  function startElapsedTimer() {
    if (elapsedInterval) clearInterval(elapsedInterval);
    let prefetchedForIndex: number | null = null;
    let stallPos: number | null = null;
    let stallSince: number | null = null;
    elapsedInterval = setInterval(() => {
      activeTarget.getPosition()
        .then((pos) => {
          set({ elapsed: pos });
          const { isPlaying, isLoading, streamUrl, currentTrack, castDevice } = get();
          // Stall watchdog: only for local target (DLNA handles its own timing).
          if (!castDevice && isPlaying && !isLoading) {
            if (stallPos !== pos) {
              stallPos = pos;
              stallSince = Date.now();
            } else if (stallSince !== null && Date.now() - stallSince >= 5000) {
              stallSince = null;
              if (streamUrl && currentTrack) {
                void activeTarget.load(streamUrl, currentTrack, currentTrack.coverArtUrl ?? null).then(() => {
                  if (get().streamUrl !== streamUrl) return;
                  set({ isPlaying: true, isLoading: false });
                  startElapsedTimer();
                }).catch(() => {});
              }
            }
          } else {
            stallPos = null;
            stallSince = null;
          }
          const { queue, queueIndex, streamUrlFor, isShuffled, shuffleOrder, gapless, repeat, consumeMode } = get();
          const duration = currentTrack?.duration ?? null;
          const nextPosition = queueIndex + 1;
          const hasNext = nextPosition < queue.length || repeat === "repeat-all";
          if (
            duration &&
            pos / duration >= 0.8 &&
            hasNext &&
            streamUrlFor &&
            prefetchedForIndex !== queueIndex
          ) {
            prefetchedForIndex = queueIndex;
            const effectiveNext = nextPosition < queue.length ? nextPosition : 0;
            const nextTrack = resolveTrack(queue, shuffleOrder, isShuffled, effectiveNext);
            if (nextTrack) {
              const nextUrl = streamUrlFor(nextTrack);
              // Gapless: enqueue directly into the audio engine so the transition is seamless.
              // Disabled for DLNA (handles its own gapless), repeat-one (would enqueue wrong track),
              // and consume mode (index shifts after removal would desync the gapless queue).
              const canGapless = !castDevice && gapless && repeat !== "repeat-one" && !consumeMode;
              if (canGapless) {
                gaplessActive = true;
                void invoke<void>("audio_enqueue_next", { url: nextUrl }).catch(() => {
                  gaplessActive = false;
                });
              } else {
                void activeTarget.setNext(nextUrl, nextTrack, nextTrack.coverArtUrl ?? null);
              }
            }
          }
          // Fallback: advance when pos reaches end in case track-ended event doesn't fire.
          // Suppressed while gaplessActive — the Rust engine is handling the transition.
          // For DLNA targets the DlnaTarget fires onTrackEnd directly, so skip fallback there.
          if (!castDevice && !gaplessActive && duration && pos >= duration - 0.25 && naturalEndFiredForIndex !== queueIndex) {
            naturalEndFiredForIndex = queueIndex;
            void get().next(true);
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

  async function preloadWaveforms() {
    try {
      const db = await getDb();
      const settingRows = await db.select<{ value: string }[]>(
        "SELECT value FROM settings WHERE key = 'player.show_waveform'",
        []
      );
      if ((settingRows[0]?.value ?? "false") !== "true") return;

      const { queue, queueIndex, isShuffled, shuffleOrder, streamUrlFor } = get();
      if (!streamUrlFor) return;

      for (let offset = 1; offset <= 2; offset++) {
        const nextPosition = queueIndex + offset;
        if (nextPosition >= queue.length) continue;
        const track = resolveTrack(queue, shuffleOrder, isShuffled, nextPosition);
        if (!track) continue;

        type Row = { peaks_json: string };
        const rows = await db.select<Row[]>(
          "SELECT peaks_json FROM waveform_cache WHERE track_id = ?",
          [track.id]
        );
        if (rows[0]) continue;

        const rawUrl = streamUrlFor(track);
        const waveformUrl = (() => {
          try {
            const u = new URL(rawUrl);
            u.searchParams.set("maxBitRate", "32");
            u.searchParams.set("format", "mp3");
            return u.toString();
          } catch {
            return rawUrl;
          }
        })();

        // One-shot listener: cache result, no state update
        const unlisten = await listen<{ track_id: string; peaks: number[] }>(
          "waveform_complete",
          async (event) => {
            if (event.payload.track_id !== track.id) return;
            unlisten();
            const now = Math.floor(Date.now() / 1000);
            await db.execute(
              "INSERT OR REPLACE INTO waveform_cache (track_id, peaks_json, created_at) VALUES (?, ?, ?)",
              [track.id, JSON.stringify(event.payload.peaks), now]
            ).catch(() => {});
          }
        );

        void invoke("audio_extract_waveform", {
          trackId: track.id,
          url: waveformUrl,
          durationSecs: track.duration ?? 0,
        });
      }
    } catch (e) {
      console.error("Failed to preload waveforms:", e);
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
        const peaks = JSON.parse(rows[0].peaks_json) as number[];
        // Preloaded waveforms from partial streams are padded with trailing zeros.
        // If less than 50% of bars have meaningful data, the cache entry is corrupt — delete and re-generate.
        const lastMeaningful = peaks.reduce((last, v, i) => (v > 0.01 ? i : last), -1);
        const coverage = peaks.length > 0 ? (lastMeaningful + 1) / peaks.length : 0;
        if (coverage >= 0.5) {
          if (get().currentTrack?.id === trackId) {
            set({ waveformPeaks: peaks });
          }
          return;
        }
        await db.execute("DELETE FROM waveform_cache WHERE track_id = ?", [trackId]).catch(() => {});
      }

      // Accumulate raw (un-normalized) chunks as they arrive, normalize for display
      const rawPeaks = new Array<number>(200).fill(0);
      let runningMax = 0;
      let filledCount = 0;

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
          filledCount = Math.max(filledCount, offset + peaks.length);
          if (get().currentTrack?.id !== trackId) return;
          const scale = runningMax > 0 ? 1 / runningMax : 1;
          // Show each bar at its actual position; unfilled bars get a stub so the load direction is clear.
          const display = rawPeaks.map((v, i) => i < filledCount ? v * scale : 0.1);
          set({ waveformPeaks: display });
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

  // Sets up an audio-error listener that retries audio_play up to 4x on stream
  // failures (HTTP error, decode error). Cleans itself up on track change.
  async function setupAudioErrorListener(url: string) {
    let retryCount = 0;
    const retryDelays = [2000, 4000, 8000, 16000];
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const unlisten = await listen<{ url: string; message: string }>("audio-error", (event) => {
      if (event.payload.url !== url) return;
      if (get().streamUrl !== url) return;

      if (retryTimer) clearTimeout(retryTimer);

      if (retryCount < retryDelays.length) {
        const delay = retryDelays[retryCount++]!;
        retryTimer = setTimeout(async () => {
          retryTimer = null;
          if (get().streamUrl !== url) return;
          try {
            await invoke("audio_play", { url });
            if (get().streamUrl !== url) return;
            set({ isPlaying: true, isLoading: false, error: null });
            startElapsedTimer();
          } catch {
            // next audio-error event triggers another retry if attempts remain
          }
        }, delay);
      } else {
        unlisten();
        cancelAudioError = null;
        set({ isPlaying: false, isLoading: false, error: event.payload.message });
      }
    });

    cancelAudioError = () => {
      unlisten();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    };
  }

  // nav=true: debounces 100ms so rapid prev/next coalesces to one HTTP request.
  async function playTrack(track: CurrentTrack, url: string, nav = false) {
    naturalEndFiredForIndex = null;
    lastEndedTrackId = null;
    gaplessActive = false;
    set({ currentTrack: track, streamUrl: url, isPlaying: false, isLoading: true, error: null, elapsed: 0, playStartedAt: Date.now(), waveformPeaks: null, audioFormat: null });
    stopElapsedTimer();

    cancelAudioError?.();
    cancelAudioError = null;

    const doPlay = async () => {
      const { castDevice } = get();
      if (!castDevice) void setupAudioErrorListener(url);
      try {
        await activeTarget.load(url, track, track.coverArtUrl ?? null);
        if (get().currentTrack?.id !== track.id) return;
        set({ isPlaying: true, isLoading: false });
        // Apply ReplayGain for this track now that the sink exists
        const { volume, replayGainMode, replayGainPreAmp, replayGainFallbackGain, castDevice } = get();
        currentReplayGainLinear = castDevice
          ? 1.0
          : computeReplayGainLinear(track.replayGain, replayGainMode, replayGainPreAmp, replayGainFallbackGain);
        void activeTarget.setVolume(volume * Math.sqrt(currentReplayGainLinear));
        startElapsedTimer();
        void fetchWaveform(track.id, url);
        void preloadWaveforms();
      } catch (e) {
        if (get().currentTrack?.id !== track.id) return;
        set({ isPlaying: false, isLoading: false, error: e instanceof Error ? e.message : String(e) });
      }
    };

    if (nav) {
      if (navDebounceTimer) clearTimeout(navDebounceTimer);
      navDebounceTimer = setTimeout(() => {
        navDebounceTimer = null;
        if (get().currentTrack?.id !== track.id) return;
        void doPlay();
      }, 100);
    } else {
      await doPlay();
    }
  }

  async function persistRadioState() {
    try {
      const { radioActive, radioSeed, radioMode, radioLabel, radioSimilarityScale } = get();
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
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('radio_label', ?)",
        [radioLabel ?? ""]
      );
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('radio.similarity_scale', ?)",
        [String(radioSimilarityScale)]
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
    speed: 1,
    pauseFadeMs: 150,
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
    radioLabel: null,
    radioSimilarityScale: 0.5,
    isQueueOpen: false,
    accentColor: null,
    waveformPeaks: null,

    sleepTimerEndsAt: null,
    sleepTimerEndOfTrack: false,
    consumeMode: false,
    consumeOnSkip: false,
    gapless: false,
    radioOnQueueEnd: false,
    audioFormat: null,

    replayGainMode: "off",
    replayGainPreAmp: 0,
    replayGainFallbackGain: -6,

    castDevice: null,
    availableRenderers: [],
    isScanningRenderers: false,
    rendererScanError: null,

    scanRenderers: async () => {
      set({ isScanningRenderers: true, rendererScanError: null });
      try {
        const renderers = await discoverRenderers(4000);
        set({ availableRenderers: renderers });
      } catch (e) {
        console.error("DLNA discovery failed:", e);
        set({ availableRenderers: [], rendererScanError: String(e) });
      } finally {
        set({ isScanningRenderers: false });
      }
    },

    setCastDevice: async (renderer) => {
      const { isPlaying, elapsed, streamUrl, currentTrack } = get();

      // Tear down old target and park playback.
      activeTarget.teardown();

      if (!renderer) {
        activeTarget = new LocalTarget();
        set({ castDevice: null });
        // Restore local playback at the parked position.
        if (currentTrack && streamUrl) {
          try {
            await activeTarget.load(streamUrl, currentTrack, currentTrack.coverArtUrl ?? null);
            if (elapsed > 0) await activeTarget.seek(elapsed);
            if (isPlaying) startElapsedTimer();
            set({ isPlaying, isLoading: false });
          } catch (e) {
            set({ isPlaying: false, isLoading: false, error: String(e) });
          }
        }
      } else {
        let castBitrate = 320;
        try {
          const db2 = await getDb();
          const rows2 = await db2.select<{ value: string }[]>(
            "SELECT value FROM settings WHERE key = 'cast.max_bitrate'", []
          );
          if (rows2[0]) castBitrate = parseInt(rows2[0].value, 10) || 320;
        } catch { /* use default */ }
        activeTarget = new DlnaTarget(renderer, () => {
          // Called by DlnaTarget when track ends on renderer.
          void get().next(true);
        }, castBitrate);
        set({ castDevice: renderer });
        // Resume on renderer at parked position.
        if (currentTrack && streamUrl) {
          try {
            set({ isLoading: true });
            await activeTarget.load(streamUrl, currentTrack, currentTrack.coverArtUrl ?? null);
            if (elapsed > 0) await activeTarget.seek(elapsed);
            if (isPlaying) startElapsedTimer();
            set({ isPlaying, isLoading: false });
          } catch (e) {
            set({ isPlaying: false, isLoading: false, error: String(e) });
          }
        }
      }

      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('cast.device', ?)",
          [renderer ? JSON.stringify(renderer) : ""]
        );
      } catch { /* non-fatal */ }
    },

    setWaveformPeaks: (peaks) => {
      set({ waveformPeaks: peaks });
    },

    toggleConsumeMode: async () => {
      const next = !get().consumeMode;
      set({ consumeMode: next });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.consume_mode', ?)",
          [next ? "true" : "false"]
        );
      } catch (e) {
        console.error("Failed to persist consume mode:", e);
      }
    },

    toggleConsumeOnSkip: async () => {
      const next = !get().consumeOnSkip;
      set({ consumeOnSkip: next });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.consume_on_skip', ?)",
          [next ? "true" : "false"]
        );
      } catch (e) {
        console.error("Failed to persist consume on skip:", e);
      }
    },

    toggleGapless: async () => {
      const next = !get().gapless;
      set({ gapless: next });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.gapless', ?)",
          [next ? "true" : "false"]
        );
      } catch (e) {
        console.error("Failed to persist gapless:", e);
      }
    },

    toggleRadioOnQueueEnd: async () => {
      const next = !get().radioOnQueueEnd;
      set({ radioOnQueueEnd: next });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.radio_on_queue_end', ?)",
          [next ? "true" : "false"]
        );
      } catch (e) {
        console.error("Failed to persist radio_on_queue_end:", e);
      }
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

    next: async (fromNaturalEnd = false) => {
      const { queue, queueIndex, streamUrlFor, repeat, isShuffled, shuffleOrder, consumeMode, consumeOnSkip } = get();
      if (queue.length === 0 || !streamUrlFor) return;

      // Deduplicate: both the Rust event and the TS fallback call next(true); only handle once.
      if (fromNaturalEnd) {
        const trackId = get().currentTrack?.id ?? null;
        if (trackId && trackId === lastEndedTrackId) return;
        lastEndedTrackId = trackId;
      }

      if (fromNaturalEnd && get().sleepTimerEndOfTrack) {
        get().clearSleepTimer();
        stopElapsedTimer();
        set({ isPlaying: false });
        void persistQueueState();
        return;
      }

      if (repeat === "repeat-one") {
        const track = resolveTrack(queue, shuffleOrder, isShuffled, queueIndex);
        if (track) await playTrack(track, streamUrlFor(track), true);
        void persistQueueState();
        return;
      }

      // Consume mode: remove the just-played track from the queue on natural end or manual skip.
      // Shuffle not supported — queue indices would need a full remap.
      if (consumeMode && !isShuffled && (fromNaturalEnd || consumeOnSkip)) {
        const newQueue = queue.filter((_, i) => i !== queueIndex);
        if (newQueue.length === 0) {
          set({ queue: newQueue });
          get().stop();
        } else if (repeat === "repeat-all" && queueIndex >= newQueue.length) {
          set({ queue: newQueue, queueIndex: 0 });
          const t = newQueue[0] ?? null;
          if (t) void playTrack(t, streamUrlFor(t), true);
        } else {
          const nextIdx = Math.min(queueIndex, newQueue.length - 1);
          set({ queue: newQueue, queueIndex: nextIdx });
          const t = newQueue[nextIdx] ?? null;
          if (t) void playTrack(t, streamUrlFor(t), true);
        }
        void persistQueueState();
        return;
      }

      const nextPosition = queueIndex + 1;
      if (nextPosition < queue.length) {
        set({ queueIndex: nextPosition });
        const track = resolveTrack(queue, shuffleOrder, isShuffled, nextPosition);
        if (track) await playTrack(track, streamUrlFor(track), true);
      } else if (repeat === "repeat-all") {
        // Re-shuffle on loop-back so each pass plays a different order
        const newShuffleOrder = isShuffled && queue.length > 1
          ? buildShuffleOrder(queue.length, 0)
          : shuffleOrder;
        set({ queueIndex: 0, shuffleOrder: newShuffleOrder });
        const track = resolveTrack(queue, newShuffleOrder, isShuffled, 0);
        if (track) await playTrack(track, streamUrlFor(track), true);
      } else {
        if (get().radioOnQueueEnd) {
          const seed = get().currentTrack;
          if (seed) {
            activeTarget.stop();
            stopElapsedTimer();
            set({ isPlaying: false, isLoading: false, radioActive: true, radioSeed: seed });
          } else {
            get().stop();
          }
        } else {
          get().stop();
        }
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
      if (track) void playTrack(track, streamUrlFor(track), true);
      void persistQueueState();
    },

    pause: () => {
      const fadeMs = get().pauseFadeMs;
      activeTarget.pause(fadeMs);
      stopElapsedTimer();
      set({ isPlaying: false });
    },

    resume: () => {
      const fadeMs = get().pauseFadeMs;
      activeTarget.resume(fadeMs);
      startElapsedTimer();
      set({ isPlaying: true });
    },

    stop: () => {
      activeTarget.stop();
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

    setVolume: async (rawVolume: number) => {
      set({ volume: rawVolume });
      const { replayGainMode, replayGainPreAmp, replayGainFallbackGain, currentTrack, castDevice } = get();
      currentReplayGainLinear = castDevice
        ? 1.0
        : computeReplayGainLinear(currentTrack?.replayGain, replayGainMode, replayGainPreAmp, replayGainFallbackGain);
      await activeTarget.setVolume(rawVolume * Math.sqrt(currentReplayGainLinear));
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('volume', ?)",
          [String(rawVolume)]
        );
      } catch (e) {
        console.error("Failed to persist volume:", e);
      }
    },

    seek: async (seconds: number) => {
      set({ elapsed: seconds });
      await activeTarget.seek(seconds);
    },

    setSpeed: async (speed: number) => {
      const clamped = Math.max(0.5, Math.min(2.0, speed));
      set({ speed: clamped });
      await invoke("audio_set_speed", { speed: clamped });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.speed', ?)",
          [String(clamped)]
        );
      } catch (e) {
        console.error("Failed to persist speed:", e);
      }
    },

    setPauseFadeMs: async (ms: number) => {
      const clamped = Math.max(0, Math.min(2000, ms));
      set({ pauseFadeMs: clamped });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.pause_fade_ms', ?)",
          [String(clamped)]
        );
      } catch (e) {
        console.error("Failed to persist pause fade:", e);
      }
    },

    setReplayGainMode: async (mode) => {
      set({ replayGainMode: mode });
      const { volume, replayGainPreAmp, replayGainFallbackGain, currentTrack, castDevice } = get();
      currentReplayGainLinear = castDevice
        ? 1.0
        : computeReplayGainLinear(currentTrack?.replayGain, mode, replayGainPreAmp, replayGainFallbackGain);
      await activeTarget.setVolume(volume * Math.sqrt(currentReplayGainLinear));
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.replay_gain_mode', ?)",
          [mode]
        );
      } catch (e) {
        console.error("Failed to persist replay_gain_mode:", e);
      }
    },

    setReplayGainPreAmp: async (db_val) => {
      const clamped = Math.max(-15, Math.min(15, db_val));
      set({ replayGainPreAmp: clamped });
      const { volume, replayGainMode, replayGainFallbackGain, currentTrack, castDevice } = get();
      currentReplayGainLinear = castDevice
        ? 1.0
        : computeReplayGainLinear(currentTrack?.replayGain, replayGainMode, clamped, replayGainFallbackGain);
      await activeTarget.setVolume(volume * Math.sqrt(currentReplayGainLinear));
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.replay_gain_pre_amp', ?)",
          [String(clamped)]
        );
      } catch (e) {
        console.error("Failed to persist replay_gain_pre_amp:", e);
      }
    },

    setReplayGainFallbackGain: async (db_val) => {
      const clamped = Math.max(-15, Math.min(15, db_val));
      set({ replayGainFallbackGain: clamped });
      const { volume, replayGainMode, replayGainPreAmp, currentTrack, castDevice } = get();
      currentReplayGainLinear = castDevice
        ? 1.0
        : computeReplayGainLinear(currentTrack?.replayGain, replayGainMode, replayGainPreAmp, clamped);
      await activeTarget.setVolume(volume * Math.sqrt(currentReplayGainLinear));
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.replay_gain_fallback_gain', ?)",
          [String(clamped)]
        );
      } catch (e) {
        console.error("Failed to persist replay_gain_fallback_gain:", e);
      }
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
      set({ radioActive: active, ...(!active ? { radioSeed: null, radioLabel: null } : {}) });
      void persistRadioState();
    },

    startRadio: (seed: CurrentTrack, mode?: RadioMode, label?: string) => {
      set({ radioActive: true, radioSeed: seed, ...(mode ? { radioMode: mode } : {}), radioLabel: label ?? null });
      void persistRadioState();
    },

    setRadioMode: (mode: RadioMode) => {
      set({ radioMode: mode });
      void persistRadioState();
    },

    setRadioSimilarityScale: (scale: number) => {
      set({ radioSimilarityScale: Math.max(0, Math.min(1, scale)) });
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

    removeManyFromQueue: async (positions: number[]) => {
      if (positions.length === 0) return;
      const { queue, queueIndex, isShuffled, shuffleOrder, streamUrlFor } = get();

      // Sort descending so we remove high indices first — avoids index drift
      const sorted = [...new Set(positions)].sort((a, b) => b - a);

      let newQueue = [...queue];
      let newShuffleOrder = [...shuffleOrder];
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
          "SELECT key, value FROM settings WHERE key IN ('volume', 'repeat', 'queue_state', 'radio_active', 'radio_seed', 'radio_mode', 'radio_label', 'queue.restore_on_startup', 'player.speed', 'player.pause_fade_ms', 'player.consume_mode', 'player.consume_on_skip', 'player.gapless', 'player.radio_on_queue_end', 'player.show_waveform', 'cast.device', 'cast.max_bitrate', 'player.replay_gain_mode', 'player.replay_gain_pre_amp', 'player.replay_gain_fallback_gain')",
          []
        );
        const restoreQueue = rows.find((r) => r.key === "queue.restore_on_startup")?.value === "true";
        let showWaveform = false;
        for (const row of rows) {
          if (row.key === "volume") {
            const volume = parseFloat(row.value);
            if (!isNaN(volume)) {
              set({ volume });
              // Gain not yet loaded at this point; apply raw volume. Re-applied after all settings loaded.
              await invoke("audio_volume", { volume: volume ** 2 });
            }
          } else if (row.key === "repeat") {
            const valid: RepeatMode[] = ["off", "repeat-all", "repeat-one"];
            if (valid.includes(row.value as RepeatMode)) {
              set({ repeat: row.value as RepeatMode });
            }
          } else if (row.key === "queue_state" && restoreQueue) {
            try {
              const saved = JSON.parse(row.value) as QueueSnapshot;
              if (Array.isArray(saved.queue) && saved.queue.length > 0 && get().currentTrack === null) {
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
          } else if (row.key === "radio_label") {
            set({ radioLabel: row.value || null });
          } else if (row.key === "radio.similarity_scale") {
            const scale = parseFloat(row.value);
            if (!isNaN(scale)) set({ radioSimilarityScale: Math.max(0, Math.min(1, scale)) });
          } else if (row.key === "player.speed") {
            const speed = parseFloat(row.value);
            if (!isNaN(speed)) {
              const clamped = Math.max(0.5, Math.min(2.0, speed));
              set({ speed: clamped });
              void invoke("audio_set_speed", { speed: clamped });
            }
          } else if (row.key === "player.pause_fade_ms") {
            const ms = parseInt(row.value, 10);
            if (!isNaN(ms)) set({ pauseFadeMs: Math.max(0, Math.min(2000, ms)) });
          } else if (row.key === "player.consume_mode") {
            set({ consumeMode: row.value === "true" });
          } else if (row.key === "player.consume_on_skip") {
            set({ consumeOnSkip: row.value === "true" });
          } else if (row.key === "player.gapless") {
            set({ gapless: row.value === "true" });
          } else if (row.key === "player.radio_on_queue_end") {
            set({ radioOnQueueEnd: row.value === "true" });
          } else if (row.key === "player.show_waveform") {
            showWaveform = row.value === "true";
          } else if (row.key === "player.replay_gain_mode") {
            const valid: ReplayGainMode[] = ["off", "track", "album"];
            if (valid.includes(row.value as ReplayGainMode)) set({ replayGainMode: row.value as ReplayGainMode });
          } else if (row.key === "player.replay_gain_pre_amp") {
            const v = parseFloat(row.value);
            if (!isNaN(v)) set({ replayGainPreAmp: Math.max(-15, Math.min(15, v)) });
          } else if (row.key === "player.replay_gain_fallback_gain") {
            const v = parseFloat(row.value);
            if (!isNaN(v)) set({ replayGainFallbackGain: Math.max(-15, Math.min(15, v)) });
          } else if (row.key === "cast.device" && row.value) {
            try {
              const savedRenderer = JSON.parse(row.value) as DlnaRenderer;
              const bitrateRow = rows.find((r2) => r2.key === "cast.max_bitrate");
              const savedBitrate = bitrateRow ? (parseInt(bitrateRow.value, 10) || 320) : 320;
              activeTarget = new DlnaTarget(savedRenderer, () => { void get().next(true); }, savedBitrate);
              set({ castDevice: savedRenderer });
            } catch { /* malformed, ignore */ }
          }
        }
        // Load waveform from cache for the restored track — fetchWaveform is only
        // called from playTrack, so a session-restored track would show nothing until
        // the user navigated away and back.
        if (showWaveform) {
          const restoredTrack = get().currentTrack;
          if (restoredTrack) {
            type WRow = { peaks_json: string };
            const wrows = await db.select<WRow[]>(
              "SELECT peaks_json FROM waveform_cache WHERE track_id = ?",
              [restoredTrack.id]
            );
            if (wrows[0]) {
              try {
                const peaks = JSON.parse(wrows[0].peaks_json) as number[];
                const lastMeaningful = peaks.reduce((last, v, i) => (v > 0.01 ? i : last), -1);
                const coverage = peaks.length > 0 ? (lastMeaningful + 1) / peaks.length : 0;
                if (coverage >= 0.5 && get().currentTrack?.id === restoredTrack.id) {
                  set({ waveformPeaks: peaks });
                }
              } catch { /* malformed peaks, ignore */ }
            }
          }
        }
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
    },
  };
});
