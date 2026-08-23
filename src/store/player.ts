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

// Both player surfaces and the keyboard shortcut have to agree on when "next" does nothing,
// otherwise the button greys out on a track the shortcut will happily skip. Repeat-all wraps,
// and radio-on-queue-end starts a new session off the last track, so neither is a dead end.
export function isNextDisabled(
  repeat: RepeatMode,
  queueIndex: number,
  queueLength: number,
  radioOnQueueEnd: boolean
): boolean {
  return repeat === "off" && !radioOnQueueEnd && queueIndex >= queueLength - 1;
}

export function repeatModeLabel(repeat: RepeatMode): string {
  return repeat === "off" ? "Repeat off" : repeat === "repeat-all" ? "Repeat all" : "Repeat one";
}

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

// What was actually handed to the audio engine for the gapless transition, and the queue
// position it sat at when it was enqueued. The engine takes the source up to a fifth of a
// track before the transition, so the queue can be edited in between; on `track-advanced`
// this is the only record of which track the user is now hearing.
// `wrapOrder` is set only when the hand-off is a repeat-all loop-back under shuffle: the new
// order has to be built at enqueue time, because the enqueued track is resolved against it and
// rodio cannot un-append. `track-advanced` adopts it rather than building a second, different
// order that would not have the audible track at position 0.
let gaplessEnqueued: { track: CurrentTrack; position: number; wrapOrder?: number[] } | null = null;

// Bumped by every queue mutation. The elapsed ticker keys its "already handed off the next
// track" guard on this as well as the index, so an edit that changes the successor re-arms
// the hand-off instead of being locked out for the rest of the track.
let queueRevision = 0;

// Cancels in-flight audio-error retry listener when a new track starts.
let cancelAudioError: (() => void) | null = null;
// Fires if a track that was asked to play never produces a single sample. Rust emits audio-error
// for a connection that fails outright, but a server that accepts the connection and then stalls
// mid-body errors nowhere: the buffering indicator sweeps forever, and the stall watchdog cannot
// help because it only arms once the position has advanced at least once.
let bufferDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
const BUFFER_DEADLINE_MS = 30000;
// Debounces rapid prev/next so only one HTTP fetch fires after the user stops skipping.
let navDebounceTimer: ReturnType<typeof setTimeout> | null = null;
// Debounces local queue-state persistence so a burst of skips/shuffles against a
// large (e.g. library-sized) queue coalesces into one JSON.stringify + SQLite write
// instead of one per action.
let queuePersistTimer: ReturnType<typeof setTimeout> | null = null;

// Track ids with a waveform extraction currently running in Rust. Extraction writes to a
// single temp file per track id, so two concurrent runs for the same track would interleave
// their writes and produce a corrupt analysis. Also avoids downloading the same track twice
// when a preloaded track becomes the current one before its extraction finishes.
const waveformInFlight = new Set<string>();

// Track id whose successors have already been queued for waveform preloading. The preload is
// triggered from the elapsed ticker, which restarts on every resume, so without this a pause and
// resume would re-run the whole preload pass (three SQLite reads per candidate) for no reason.
let waveformPreloadedFor: string | null = null;

// Bumped by every seek. The elapsed ticker samples this before awaiting getPosition() and drops
// the result if it changed, because a poll issued just before a seek resolves just after it and
// would otherwise write the pre-seek position back over the position the user asked for. That
// showed up as the progress bar jumping backwards for one tick after every click-to-seek.
let seekGen = 0;

// Current ReplayGain linear amplitude multiplier. Updated on track change and mode change.
// Stored outside the store so setVolume can access the latest value without a selector.
let currentReplayGainLinear = 1.0;

// Volume to restore on unmute. Lives outside the store (like currentReplayGainLinear above) so
// every mute button (PlayerBar, NowPlayingView) shares one source of truth instead of drifting.
// Updated by setVolume on every audible level, not only by toggleMute, so dragging the slider to
// zero and then unmuting restores where the user actually was. Persisted alongside the volume
// itself: without that, a mute held across a restart loads volume 0 with this back at its 1.0
// default, and the first unmute jumps to full.
let preMuteVolume = 1.0;

// Debounces persistence of the volume. The slider fires onChange per 0.01 step (~100 events per
// drag), the wheel handler fires per wheel tick, and a held ArrowUp repeats at ~30/s, so writing
// on every call meant a SQLite round trip per event against the same WAL db the audio path uses.
// The audible change stays immediate; only the write is deferred.
let volumePersistTimer: ReturnType<typeof setTimeout> | null = null;

// Set when pause() is called while a track is still loading. playTrack's completion handler
// unconditionally sets isPlaying, so without this the pause is silently overwritten: the engine
// ends up paused while the UI claims to be playing, with the position frozen at 0 and the stall
// watchdog unable to arm (it needs the position to have advanced at least once).
let pauseRequestedDuringLoad = false;

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
function trimQueueToCap(
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
  // "A start request is in flight." On the local target audio_play returns as soon as it has
  // spawned its download thread, so this is only the IPC round trip and lasts a few ms. It gates
  // the transport buttons; it is not a signal that audio is being fetched. Use isBuffering for that.
  isLoading: boolean;
  // "Playback has been asked for but no sound is coming out yet." Spans the real wait: HTTP
  // connect, first bytes, format probing. Cleared by the audio-format event (emitted the instant
  // the sink is appended) or by the position ticker seeing the position move off zero.
  isBuffering: boolean;
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
  restoreQueue: (tracks: CurrentTrack[], streamUrlFor: (t: CurrentTrack) => string, position: number) => void;
  next: (fromNaturalEnd?: boolean) => Promise<void>;
  prev: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  // Re-runs the current track from the start after a playback failure, with a fresh retry budget.
  retryCurrent: () => void;
  setVolume: (volume: number) => Promise<void>;
  toggleMute: () => Promise<void>;
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
  addManyToQueue: (tracks: CurrentTrack[], streamUrlFn: (t: CurrentTrack) => string) => void;
  playNextMany: (tracks: CurrentTrack[], streamUrlFn: (t: CurrentTrack) => string) => void;
  toggleQueue: () => void;
  removeFromQueue: (position: number) => Promise<void>;
  removeManyFromQueue: (positions: number[]) => Promise<void>;
  clearQueue: () => void;
  setAccentColor: (color: string | null) => void;
  moveQueueItem: (from: number, to: number) => void;
  playFromQueueIndex: (position: number) => Promise<void>;
  setWaveformPeaks: (peaks: number[] | null) => void;
  setPauseFadeMs: (ms: number) => Promise<void>;
  maxQueueSize: number;
  setMaxQueueSize: (n: number) => Promise<void>;
}

// Active playback target, swapped when casting to a DLNA renderer.
// Lives outside the store to avoid serialization; all state mutations go through store actions.
let activeTarget: PlaybackTarget = new LocalTarget();

export const usePlayerStore = create<PlayerState>((set, get) => {
  let elapsedInterval: ReturnType<typeof setInterval> | null = null;
  let cancelWaveform: (() => void) | null = null;
  let sleepTimerTimeout: ReturnType<typeof setTimeout> | null = null;
  // Tracks whether the TS fallback already fired next() for the current track position.
  let naturalEndFiredForIndex: number | null = null;

  // Global listener: update audioFormat whenever Rust emits it at play start.
  // Rust emits this immediately after sink.append(source), so it is also the earliest and most
  // accurate signal that the fetch/probe wait is over and sound is starting. The ticker's
  // position check below is the backstop for paths that produce no format event.
  void listen<{ sample_rate: number; channels: number; codec: string }>("audio-format", (event) => {
    clearBufferDeadline();
    set({
      audioFormat: { sampleRate: event.payload.sample_rate, channels: event.payload.channels, codec: event.payload.codec },
      isBuffering: false,
    });
  });

  function clearBufferDeadline() {
    if (bufferDeadlineTimer) clearTimeout(bufferDeadlineTimer);
    bufferDeadlineTimer = null;
  }

  // Armed whenever playback is asked for and disarmed the moment sound actually starts. If it
  // reaches the end of its wait with the position still at zero, the stream is never going to
  // produce audio and the user is told so instead of watching an indefinite sweep.
  function armBufferDeadline(url: string) {
    clearBufferDeadline();
    bufferDeadlineTimer = setTimeout(() => {
      bufferDeadlineTimer = null;
      const { streamUrl, isBuffering, elapsed } = get();
      if (streamUrl !== url || !isBuffering || elapsed > 0) return;
      cancelAudioError?.();
      cancelAudioError = null;
      stopElapsedTimer();
      void activeTarget.stop();
      set({
        isPlaying: false,
        isLoading: false,
        isBuffering: false,
        error: "The track never started playing. The server may be unreachable or overloaded",
      });
    }, BUFFER_DEADLINE_MS);
  }

  // Single global listener for preloaded (not-yet-current) waveforms: caches the result and
  // clears the in-flight marker. Registering one listener here instead of one per preloaded
  // track means a failed extraction, which never emits, can't leave a listener behind.
  void listen<{ track_id: string; peaks: number[] }>("waveform_complete", async (event) => {
    const { track_id: trackId, peaks } = event.payload;
    if (!waveformInFlight.delete(trackId)) return;
    try {
      const db = await getDb();
      await db.execute(
        "INSERT OR REPLACE INTO waveform_cache (track_id, peaks_json, created_at) VALUES (?, ?, ?)",
        [trackId, JSON.stringify(peaks), Math.floor(Date.now() / 1000)]
      );
    } catch (e) {
      console.error("Failed to cache preloaded waveform:", e);
    }
  });

  // Non-gapless fallback: Rust reports playback reached natural end of file.
  void listen("track-ended", () => {
    void get().next(true);
  });

  // The Rust enqueue thread gave up on a queued gapless source (fetch failed, decode failed, or a
  // newer play superseded it). Without this the suppression flag below would stay set for the rest
  // of the session, disabling the position-based fallback advance exactly when it is most needed.
  void listen("gapless-cancelled", () => {
    gaplessActive = false;
    gaplessEnqueued = null;
  });

  // Gapless transition: Rust reports that the current source finished and the queued next one started.
  // Advance queue state without calling audio_play, the audio is already playing.
  void listen("track-advanced", () => {
    const enqueued = gaplessEnqueued;
    gaplessActive = false;
    gaplessEnqueued = null;
    naturalEndFiredForIndex = null;
    lastEndedTrackId = null;
    const { queue, queueIndex, streamUrlFor, isShuffled, shuffleOrder, repeat } = get();
    if (!streamUrlFor) return;
    const nextPosition = queueIndex + 1;
    const wrapped = nextPosition >= queue.length;
    if (wrapped && repeat !== "repeat-all") return;

    let newQueueIndex: number;
    let newShuffleOrder = shuffleOrder;
    let nextTrack: CurrentTrack | null;

    if (wrapped) {
      // The enqueue already built the order for this pass and resolved the handed-over source
      // against it, so adopt that one: rebuilding here would produce an order whose position 0
      // is some other track than the one now audible. The length check catches a queue edited
      // inside the lead window, where the carried order no longer describes the queue; fall back
      // to a fresh order anchored on the track the engine actually started.
      const carried = enqueued?.wrapOrder;
      if (carried && carried.length === queue.length) {
        newShuffleOrder = carried;
      } else {
        const anchorIdx = enqueued ? queue.findIndex((t) => t.id === enqueued.track.id) : 0;
        newShuffleOrder = isShuffled && queue.length > 1
          ? buildShuffleOrder(queue.length, anchorIdx >= 0 ? anchorIdx : 0)
          : shuffleOrder;
      }
      newQueueIndex = 0;
      nextTrack = resolveTrack(queue, newShuffleOrder, isShuffled, newQueueIndex);
    } else if (enqueued) {
      // The queue can be edited between the enqueue and the transition (play next, reorder,
      // remove), so queueIndex + 1 is not necessarily still the track that is now audible.
      // Follow the enqueued track to wherever it sits now.
      const positionOf = (): number => {
        if (resolveTrack(queue, shuffleOrder, isShuffled, enqueued.position)?.id === enqueued.track.id) {
          return enqueued.position;
        }
        for (let p = 0; p < queue.length; p++) {
          if (resolveTrack(queue, shuffleOrder, isShuffled, p)?.id === enqueued.track.id) return p;
        }
        return -1;
      };
      const found = positionOf();
      if (found >= 0) {
        newQueueIndex = found;
        nextTrack = resolveTrack(queue, shuffleOrder, isShuffled, found);
      } else {
        // Removed from the queue while it was already handed to the engine. It is still what
        // the user hears, so show it; park the index so the next advance moves forward.
        newQueueIndex = Math.min(nextPosition, Math.max(0, queue.length - 1));
        nextTrack = enqueued.track;
      }
    } else {
      newQueueIndex = nextPosition;
      nextTrack = resolveTrack(queue, newShuffleOrder, isShuffled, newQueueIndex);
    }
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
      // Gapless: the engine already decoded and appended this source, nothing is being fetched.
      isBuffering: false,
      waveformPeaks: null,
    });
    // Apply ReplayGain for the gapless-advanced track
    const { volume, replayGainMode, replayGainPreAmp, replayGainFallbackGain, castDevice } = get();
    currentReplayGainLinear = castDevice
      ? 1.0
      : computeReplayGainLinear(nextTrack.replayGain, replayGainMode, replayGainPreAmp, replayGainFallbackGain);
    void activeTarget.setVolume(volume * Math.sqrt(currentReplayGainLinear));
    // An end-of-track sleep timer set after the next source was already enqueued cannot stop the
    // transition, the audio engine has moved on. Honour it here instead: the queue now sits at the
    // start of the next track, paused. The enqueue itself is blocked while the flag is set (see the
    // elapsed ticker), so this only covers a timer armed inside the gapless lead window.
    if (get().sleepTimerEndOfTrack) {
      get().clearSleepTimer();
      activeTarget.pause(0);
      stopElapsedTimer();
      set({ isPlaying: false });
      void persistQueueState();
      return;
    }
    startElapsedTimer();
    // preloadWaveforms is driven from the ticker's first advancing position, one call site for
    // both the gapless and the audio_play path. Calling it here as well would run the whole pass
    // twice, ~200ms apart, for the same track.
    void fetchWaveform(nextTrack.id, streamUrlFor(nextTrack));
    void persistQueueState();
  });

  function startElapsedTimer() {
    if (elapsedInterval) clearInterval(elapsedInterval);
    // Keyed on index *and* queue revision: a reorder or removal changes which track follows
    // without changing queueIndex, and an index-only guard would lock out the corrected
    // hand-off for the rest of the track.
    let prefetchedFor: string | null = null;
    let stallPos: number | null = null;
    let stallSince: number | null = null;
    // Audio is only considered started once the position has actually advanced.
    // audio_play returns before the download/decode finishes, so position stays at 0
    // during initial buffering; arming the watchdog then would tear the stream down
    // and restart it every 5s, meaning a slow-starting track never starts at all.
    // A genuinely dead stream is handled by the audio-error retry listener instead.
    let hasAdvanced = false;
    elapsedInterval = setInterval(() => {
      const genAtPoll = seekGen;
      activeTarget.getPosition()
        .then((pos) => {
          // A seek landed while this poll was in flight, so `pos` predates it. Dropping the
          // whole tick (not just the set) keeps the stall watchdog and the natural-end check
          // from reasoning about a position the engine has already moved away from.
          if (genAtPoll !== seekGen) return;
          set({ elapsed: pos });
          if (pos > 0 && !hasAdvanced) {
            hasAdvanced = true;
            // Backstop for the audio-format event: a retry, a prefetch-cache hit or a cast
            // target can all get sound out without one arriving in the expected order.
            clearBufferDeadline();
            if (get().isBuffering) set({ isBuffering: false });
            // Waveform extraction for the *next* two tracks pulls two more full downloads off
            // the same server. Running it from playTrack put them in direct contention with the
            // audio the user is waiting to hear, so it waits until this track is audible.
            const started = get().currentTrack;
            if (started && waveformPreloadedFor !== started.id) {
              waveformPreloadedFor = started.id;
              void preloadWaveforms();
            }
          }
          const { isPlaying, isLoading, streamUrl, currentTrack, castDevice } = get();
          // Stall watchdog: only for local target (DLNA handles its own timing).
          if (!castDevice && isPlaying && !isLoading && hasAdvanced) {
            if (stallPos !== pos) {
              stallPos = pos;
              stallSince = Date.now();
            } else if (stallSince !== null && Date.now() - stallSince >= 5000) {
              stallSince = null;
              if (streamUrl && currentTrack) {
                void activeTarget.load(streamUrl, currentTrack, currentTrack.coverArtUrl ?? null).then(() => {
                  if (get().streamUrl !== streamUrl) return;
                  // The stream is being fetched from scratch again, so the wait is real.
                  set({ isPlaying: true, isLoading: false, isBuffering: true });
                  startElapsedTimer();
                }).catch(() => {});
              }
            }
          } else {
            stallPos = null;
            stallSince = null;
          }
          const { queue, queueIndex, streamUrlFor, isShuffled, shuffleOrder, gapless, repeat, consumeMode, sleepTimerEndOfTrack } = get();
          const duration = currentTrack?.duration ?? null;
          const nextPosition = queueIndex + 1;
          const wrapping = nextPosition >= queue.length;
          const hasNext = !wrapping || repeat === "repeat-all";
          if (
            duration &&
            pos / duration >= 0.8 &&
            hasNext &&
            streamUrlFor &&
            prefetchedFor !== `${queueIndex}:${queueRevision}` &&
            // An end-of-track sleep timer means there is no next track to hand off to. Queuing one
            // anyway makes the engine (or the renderer) advance on its own, past the point where
            // next() would have stopped playback, so the timer never takes effect at all.
            !sleepTimerEndOfTrack
          ) {
            prefetchedFor = `${queueIndex}:${queueRevision}`;
            // Gapless: enqueue directly into the audio engine so the transition is seamless.
            // Disabled for DLNA (handles its own gapless), repeat-one (would enqueue wrong track),
            // and consume mode (index shifts after removal would desync the gapless queue).
            const canGapless = !castDevice && gapless && repeat !== "repeat-one" && !consumeMode;
            if (repeat === "repeat-one") {
              // This same track plays again, so warming the successor downloads a whole file that
              // will never be heard, once per repetition. Warm the current URL instead: audio_play
              // consumes the prefetch cache, so the loop restarts instantly for the same bytes.
              if (!castDevice && currentTrack && streamUrl) {
                void activeTarget.setNext(streamUrl, currentTrack, currentTrack.coverArtUrl ?? null);
              }
            } else {
              // A repeat-all loop-back under shuffle installs a fresh order, and the track that
              // opens the new pass is position 0 of *that* order, not of the one being replaced.
              // rodio cannot un-append, so the order has to be decided here, before the source is
              // handed over, and travel with it to track-advanced.
              const wrapOrder = canGapless && wrapping && isShuffled && queue.length > 1
                ? buildShuffleOrder(queue.length, -1)
                : null;
              const effectiveNext = wrapping ? 0 : nextPosition;
              const nextTrack = resolveTrack(queue, wrapOrder ?? shuffleOrder, isShuffled, effectiveNext);
              if (nextTrack) {
                const nextUrl = streamUrlFor(nextTrack);
                if (canGapless) {
                  // A queue edit bumps the revision and gets us here a second time, but rodio
                  // cannot un-append a source: audio_enqueue_next sees its slot already claimed
                  // and returns without doing anything. Re-recording gaplessEnqueued here would
                  // name a track the engine never received, which is exactly the mismatch the
                  // record exists to prevent. Leave the first one standing.
                  if (!gaplessActive) {
                    gaplessActive = true;
                    gaplessEnqueued = { track: nextTrack, position: effectiveNext, ...(wrapOrder ? { wrapOrder } : {}) };
                    void invoke<void>("audio_enqueue_next", { url: nextUrl }).catch(() => {
                      gaplessActive = false;
                      gaplessEnqueued = null;
                    });
                  }
                } else if (!castDevice && !(wrapping && isShuffled)) {
                  // Skipped for a shuffled wrap: next() builds its own order when it gets there,
                  // so which track opens the new pass is not knowable yet and this would warm the
                  // wrong one.
                  void activeTarget.setNext(nextUrl, nextTrack, nextTrack.coverArtUrl ?? null);
                }
                // Nothing is handed to a cast target ahead of time. A renderer that has been
                // given the next URI advances on its own, and Canon cannot observe that
                // transition (GetTransportInfo reads PLAYING across it), so the UI would sit
                // on the finished track for the whole of the next one and then play it again.
              }
            }
          }
          // Fallback: advance when pos reaches end in case track-ended event doesn't fire.
          // Suppressed while gaplessActive, the Rust engine is handling the transition.
          // For DLNA targets the DlnaTarget fires onTrackEnd directly, so skip fallback there.
          // Requires isPlaying: a paused player must never advance on its own, whatever the
          // reported position is. Without this, any position drift while paused (such as the
          // seek-while-paused bug in audio_seek) silently skipped the user to the next track.
          if (isPlaying && !castDevice && !gaplessActive && duration && pos >= duration - 0.25 && naturalEndFiredForIndex !== queueIndex) {
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
      if ((settingRows[0]?.value ?? "true") !== "true") return;

      const { queue, queueIndex, isShuffled, shuffleOrder, streamUrlFor } = get();
      if (!streamUrlFor) return;

      for (let offset = 1; offset <= 2; offset++) {
        const nextPosition = queueIndex + offset;
        if (nextPosition >= queue.length) continue;
        const track = resolveTrack(queue, shuffleOrder, isShuffled, nextPosition);
        if (!track) continue;

        type Row = { peaks_json: string };
        if (waveformInFlight.has(track.id)) continue;

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

        // Result is cached by the global waveform_complete listener registered above.
        waveformInFlight.add(track.id);
        void invoke("audio_extract_waveform", {
          trackId: track.id,
          url: waveformUrl,
          durationSecs: track.duration ?? 0,
        }).catch(() => {
          // Extraction failed, so no waveform_complete will arrive to clear the marker.
          waveformInFlight.delete(track.id);
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
      if ((settingRows[0]?.value ?? "true") !== "true") return;

      type Row = { peaks_json: string };
      const rows = await db.select<Row[]>(
        "SELECT peaks_json FROM waveform_cache WHERE track_id = ?",
        [trackId]
      );
      if (rows[0]) {
        const peaks = JSON.parse(rows[0].peaks_json) as number[];
        // Preloaded waveforms from partial streams are padded with trailing zeros.
        // If less than 50% of bars have meaningful data, the cache entry is corrupt, delete and re-generate.
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
        (event) => {
          // Guard before unlisten: a stale event from a prior track must not kill the current track's listeners
          if (event.payload.track_id !== trackId) return;
          unlistenChunk();
          unlistenComplete();
          cancelWaveform = null;
          if (get().currentTrack?.id === trackId) {
            set({ waveformPeaks: event.payload.peaks });
          }
          // Caching is owned by the global waveform_complete listener.
        }
      );

      // Hold references so a future track can cancel these listeners if it starts before waveform_complete fires
      cancelWaveform = () => {
        unlistenChunk();
        unlistenComplete();
      };

      // Request low-bitrate audio for analysis, Navidrome transcodes to ~64kbps mono,
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
      // An extraction started by the preload pass may already be running for this track.
      // Its chunk/complete events are broadcast, so the listeners above still receive them;
      // invoking again would download the track a second time and both runs would write the
      // same temp file, corrupting the analysis.
      if (!waveformInFlight.has(trackId)) {
        waveformInFlight.add(trackId);
        void invoke("audio_extract_waveform", { trackId, url: waveformUrl, durationSecs: get().currentTrack?.duration ?? 0 })
          .catch(() => {
            waveformInFlight.delete(trackId);
          });
      }
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

    const unlisten = await listen<{ url: string; message: string; detail?: string; retryable?: boolean }>("audio-error", (event) => {
      if (event.payload.url !== url) return;
      if (get().streamUrl !== url) return;

      if (retryTimer) clearTimeout(retryTimer);

      // A 404, a decode failure or a missing output device produce the same result on every
      // attempt. Retrying them costs the user 30 seconds of silence before the error appears.
      const retryable = event.payload.retryable !== false;

      if (retryable && retryCount < retryDelays.length) {
        const delay = retryDelays[retryCount++]!;
        retryTimer = setTimeout(async () => {
          retryTimer = null;
          if (get().streamUrl !== url) return;
          try {
            await invoke("audio_play", { url });
            if (get().streamUrl !== url) return;
            set({ isPlaying: true, isLoading: false, isBuffering: true, error: null });
            armBufferDeadline(url);
            startElapsedTimer();
          } catch {
            // next audio-error event triggers another retry if attempts remain
          }
        }, delay);
      } else {
        unlisten();
        cancelAudioError = null;
        if (event.payload.detail) console.error("Playback failed:", event.payload.detail);
        clearBufferDeadline();
        stopElapsedTimer();
        set({ isPlaying: false, isLoading: false, isBuffering: false, error: event.payload.message });
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
    gaplessEnqueued = null;
    pauseRequestedDuringLoad = false;
    set({ currentTrack: track, streamUrl: url, isPlaying: false, isLoading: true, isBuffering: true, error: null, elapsed: 0, playStartedAt: Date.now(), waveformPeaks: null, audioFormat: null });
    stopElapsedTimer();
    armBufferDeadline(url);

    cancelAudioError?.();
    cancelAudioError = null;

    const doPlay = async () => {
      const { castDevice } = get();
      if (!castDevice) void setupAudioErrorListener(url);
      try {
        await activeTarget.load(url, track, track.coverArtUrl ?? null);
        if (get().currentTrack?.id !== track.id) return;
        const paused = pauseRequestedDuringLoad;
        pauseRequestedDuringLoad = false;
        // isBuffering is deliberately not re-asserted here. A DLNA load has genuinely finished by
        // this point so it clears, but on the local target audio_play has only spawned its
        // download thread; audio-format may already have landed for a prefetch-cache hit, and
        // setting the flag back to true would leave it stuck until the ticker cleared it.
        set(get().castDevice ? { isPlaying: !paused, isLoading: false, isBuffering: false } : { isPlaying: !paused, isLoading: false });
        // Apply ReplayGain for this track now that the sink exists
        const { volume, replayGainMode, replayGainPreAmp, replayGainFallbackGain, castDevice } = get();
        currentReplayGainLinear = castDevice
          ? 1.0
          : computeReplayGainLinear(track.replayGain, replayGainMode, replayGainPreAmp, replayGainFallbackGain);
        void activeTarget.setVolume(volume * Math.sqrt(currentReplayGainLinear));
        // The user asked to pause while this track was still loading. Re-apply that against the
        // sink that now exists (the earlier pause raced the load and may have hit nothing), and
        // leave the elapsed ticker stopped until they resume.
        if (paused) {
          activeTarget.pause(0);
        } else {
          startElapsedTimer();
        }
        void fetchWaveform(track.id, url);
        // preloadWaveforms is deliberately not called here, see the elapsed ticker.
      } catch (e) {
        if (get().currentTrack?.id !== track.id) return;
        set({ isPlaying: false, isLoading: false, isBuffering: false, error: e instanceof Error ? e.message : String(e) });
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

  async function persistQueueStateNow() {
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

  function persistQueueState() {
    // Every queue mutation funnels through here, so this is the one place that sees them all.
    // The ticker's hand-off guard reads it to notice that the successor may have changed.
    queueRevision++;
    if (queuePersistTimer) clearTimeout(queuePersistTimer);
    queuePersistTimer = setTimeout(() => {
      queuePersistTimer = null;
      void persistQueueStateNow();
    }, 500);
  }

  async function persistVolumeNow(rawVolume: number) {
    try {
      const db = await getDb();
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('volume', ?), ('player.pre_mute_volume', ?)",
        [String(rawVolume), String(preMuteVolume)]
      );
    } catch (e) {
      console.error("Failed to persist volume:", e);
    }
  }

  function persistVolume(rawVolume: number) {
    if (volumePersistTimer) clearTimeout(volumePersistTimer);
    volumePersistTimer = setTimeout(() => {
      volumePersistTimer = null;
      void persistVolumeNow(rawVolume);
    }, 500);
  }

  // Flush the debounced writes on quit so a skip/shuffle/volume change right before close
  // isn't lost.
  window.addEventListener("beforeunload", () => {
    if (queuePersistTimer) {
      clearTimeout(queuePersistTimer);
      queuePersistTimer = null;
      void persistQueueStateNow();
    }
    if (volumePersistTimer) {
      clearTimeout(volumePersistTimer);
      volumePersistTimer = null;
      void persistVolumeNow(get().volume);
    }
  });

  return {
    currentTrack: null,
    streamUrl: null,
    isPlaying: false,
    isLoading: false,
    isBuffering: false,
    error: null,
    elapsed: 0,
    volume: 1,
    speed: 1,
    pauseFadeMs: 150,
    maxQueueSize: 100,
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
            // load() starts audio on every target. Writing isPlaying: false without telling
            // the target would leave a paused player audibly playing on the new one.
            if (!isPlaying) activeTarget.pause(0);
            // Back on the local engine, so the same rule as playTrack applies: load() has
            // returned but nothing has been fetched yet. audio-format or the ticker clears this.
            set({ isPlaying, isLoading: false, isBuffering: isPlaying });
          } catch (e) {
            set({ isPlaying: false, isLoading: false, isBuffering: false, error: String(e) });
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
        }, castBitrate, (message) => {
          // The renderer stopped answering. Nothing else on the cast path surfaces this:
          // there is no audio-error event, and the target has stopped its own timers.
          set({ error: message, isPlaying: false, isBuffering: false });
          stopElapsedTimer();
        });
        set({ castDevice: renderer });
        // Resume on renderer at parked position.
        if (currentTrack && streamUrl) {
          try {
            set({ isLoading: true, isBuffering: true });
            await activeTarget.load(streamUrl, currentTrack, currentTrack.coverArtUrl ?? null);
            if (elapsed > 0) await activeTarget.seek(elapsed);
            if (isPlaying) startElapsedTimer();
            // avPlay ran inside load(), so a player that was paused has to be paused again
            // on the renderer, not just recorded as paused in the store.
            if (!isPlaying) activeTarget.pause(0);
            set({ isPlaying, isLoading: false, isBuffering: false });
          } catch (e) {
            set({ isPlaying: false, isLoading: false, isBuffering: false, error: String(e) });
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
      // A one-track queue still needs an order covering that track while shuffle is on. Leaving
      // it empty lets the queue-mutating writers that index shuffleOrder without normalising
      // first (removeFromQueue, moveQueueItem) read past the end of it. Same case playQueue
      // handles for its single-track input.
      const { isShuffled } = get();
      set({ queue: [track], queueIndex: 0, streamUrlFor: () => streamUrl, shuffleOrder: isShuffled ? [0] : [] });
      await playTrack(track, streamUrl);
      void persistQueueState();
    },

    playQueue: async (tracks, streamUrlFor, startIndex = 0) => {
      const { isShuffled, maxQueueSize, radioActive: hadRadio, radioSeed: hadSeed } = get();
      let workingTracks = tracks;
      let workingStart = startIndex;

      // Cap the queue instead of storing the whole (possibly library-sized) list:
      // keeps playback-state re-renders, persistence writes, and Up Next rendering
      // bounded regardless of source size. Window is centered on the clicked track
      // so skipping in either direction still has room to move.
      if (maxQueueSize > 0 && tracks.length > maxQueueSize) {
        const half = Math.floor(maxQueueSize / 2);
        let begin = Math.max(0, startIndex - half);
        let end = begin + maxQueueSize;
        if (end > tracks.length) {
          end = tracks.length;
          begin = Math.max(0, end - maxQueueSize);
        }
        workingTracks = tracks.slice(begin, end);
        workingStart = startIndex - begin;
      }

      let shuffleOrder: number[] = [];
      let position = workingStart;

      if (isShuffled && workingTracks.length > 1) {
        shuffleOrder = buildShuffleOrder(workingTracks.length, workingStart);
        position = 0;
      } else if (isShuffled && workingTracks.length === 1) {
        // A one-track shuffled queue still needs an order covering that track. Leaving it empty
        // lets a later addToQueue/playNext splice into [] and produce an order that is one short
        // and offset by one, which makes queue[0] unreachable. Reached by every "start radio"
        // entry point, which seeds playQueue with a single track and then appends to it.
        shuffleOrder = [0];
      }

      set({ queue: workingTracks, queueIndex: position, streamUrlFor, shuffleOrder, radioActive: false, radioSeed: null });
      const track = resolveTrack(workingTracks, shuffleOrder, isShuffled, position);
      if (track) await playTrack(track, streamUrlFor(track));
      void persistQueueState();
      // Only write radio state if this call actually cleared one. The "start radio" callers run
      // playQueue and startRadio back to back, and startRadio has already written the new state
      // by the time this resumes, so persisting again is five redundant SQLite executes.
      if (hadRadio || hadSeed) void persistRadioState();
    },

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
      // Shuffle not supported, queue indices would need a full remap.
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
        // Re-shuffle on loop-back so each pass plays a different order. Unanchored (-1): the
        // previous pass has finished, so there is no playing track to keep at position 0, and
        // anchoring on queue index 0 made every single wrap open with queue[0].
        const newShuffleOrder = isShuffled && queue.length > 1
          ? buildShuffleOrder(queue.length, -1)
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
      const { queue, queueIndex, streamUrlFor, elapsed, isShuffled, shuffleOrder, error, currentTrack } = get();
      if (queue.length === 0 || !streamUrlFor) return;
      const restart = elapsed > PREV_RESTART_THRESHOLD_S;
      // Restarting the track the engine already holds is a seek, not a load. Going through
      // playTrack re-fetched and re-decoded the whole file just to get back to zero, so the
      // most common use of this button paid a network round trip and a buffering spinner for
      // something the sink can do instantly. This is what the button's own hold-to-restart
      // gesture already does. A failed track has no sink to seek, so that still reloads.
      if (restart && currentTrack && !error) {
        await get().seek(0);
        return;
      }
      const newPosition = restart ? queueIndex : Math.max(0, queueIndex - 1);
      set({ queueIndex: newPosition });
      const track = resolveTrack(queue, shuffleOrder, isShuffled, newPosition);
      if (track) void playTrack(track, streamUrlFor(track), true);
      void persistQueueState();
    },

    pause: () => {
      const { pauseFadeMs, currentTrack, isLoading } = get();
      if (!currentTrack) return;
      if (isLoading) pauseRequestedDuringLoad = true;
      activeTarget.pause(pauseFadeMs);
      stopElapsedTimer();
      set({ isPlaying: false });
    },

    resume: () => {
      const { pauseFadeMs, currentTrack, error, streamUrl } = get();
      // Nothing loaded (queue ran out, queue cleared, or stop()). Without this guard an
      // OS-level play command leaves isPlaying true with no audio and an elapsed ticker
      // polling a position that counts up against silence.
      if (!currentTrack) return;
      // The current track failed, so there is no sink to resume. Pressing play (or the media
      // key) means "try this again", which is what the Retry button does.
      if (error) {
        get().retryCurrent();
        return;
      }
      // A session restored from queue_state has a currentTrack but has never loaded anything
      // into the engine, so there is no sink to resume either. Resuming one anyway left the
      // store claiming to play with the position stuck at 0, which the stall watchdog cannot
      // recover from because it requires the position to have advanced at least once.
      if (!streamUrl) {
        get().retryCurrent();
        return;
      }
      pauseRequestedDuringLoad = false;
      activeTarget.resume(pauseFadeMs);
      startElapsedTimer();
      set({ isPlaying: true });
    },

    retryCurrent: () => {
      const { currentTrack, streamUrl, streamUrlFor } = get();
      if (!currentTrack) return;
      // Rebuild the URL where possible: a failure caused by an expired or rotated credential
      // would otherwise be retried against the same stale URL forever.
      const url = streamUrlFor ? streamUrlFor(currentTrack) : streamUrl;
      if (!url) return;
      void playTrack(currentTrack, url);
    },

    stop: () => {
      pauseRequestedDuringLoad = false;
      activeTarget.stop();
      stopElapsedTimer();
      clearBufferDeadline();
      cancelAudioError?.();
      cancelAudioError = null;
      set({
        currentTrack: null,
        streamUrl: null,
        isPlaying: false,
        isLoading: false,
        isBuffering: false,
        error: null,
        elapsed: 0,
        // queue, queueIndex, streamUrlFor preserved, accidental stop doesn't destroy queue
      });
      void persistQueueState();
    },

    setVolume: async (rawVolume: number) => {
      set({ volume: rawVolume });
      if (rawVolume > 0) preMuteVolume = rawVolume;
      const { replayGainMode, replayGainPreAmp, replayGainFallbackGain, currentTrack, castDevice } = get();
      currentReplayGainLinear = castDevice
        ? 1.0
        : computeReplayGainLinear(currentTrack?.replayGain, replayGainMode, replayGainPreAmp, replayGainFallbackGain);
      await activeTarget.setVolume(rawVolume * Math.sqrt(currentReplayGainLinear));
      persistVolume(rawVolume);
    },

    toggleMute: async () => {
      const { volume, setVolume } = get();
      // setVolume keeps preMuteVolume at the last audible level, so this restores where the
      // user was whether they got to zero via this button or by dragging the slider down.
      await setVolume(volume > 0 ? 0 : preMuteVolume || 1);
    },

    seek: async (seconds: number) => {
      seekGen++;
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

    setMaxQueueSize: async (n: number) => {
      const clamped = Math.max(1, Math.min(1000, Math.round(n)));
      set({ maxQueueSize: clamped });
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('player.max_queue_size', ?)",
          [String(clamped)]
        );
      } catch (e) {
        console.error("Failed to persist max queue size:", e);
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

    loadSettings: async () => {
      try {
        const db = await getDb();
        const rows = await db.select<{ key: string; value: string }[]>(
          "SELECT key, value FROM settings WHERE key IN ('volume', 'player.pre_mute_volume', 'repeat', 'queue_state', 'radio_active', 'radio_seed', 'radio_mode', 'radio_label', 'queue.restore_on_startup', 'player.speed', 'player.pause_fade_ms', 'player.consume_mode', 'player.consume_on_skip', 'player.gapless', 'player.radio_on_queue_end', 'player.show_waveform', 'cast.device', 'cast.max_bitrate', 'player.replay_gain_mode', 'player.replay_gain_pre_amp', 'player.replay_gain_fallback_gain', 'player.max_queue_size')",
          []
        );
        const restoreQueue = rows.find((r) => r.key === "queue.restore_on_startup")?.value === "true";
        let showWaveform = true;
        for (const row of rows) {
          if (row.key === "volume") {
            const volume = parseFloat(row.value);
            if (!isNaN(volume)) {
              set({ volume });
              // Gain not yet loaded at this point; apply raw volume. Re-applied after all settings loaded.
              await invoke("audio_volume", { volume: volume ** 2 });
            }
          } else if (row.key === "player.pre_mute_volume") {
            // Restores the unmute level across a restart. Without it a session that quit while
            // muted loads volume 0 with preMuteVolume back at its 1.0 default, so the first
            // unmute jumps to full instead of returning to the level the user was using.
            const preMute = parseFloat(row.value);
            if (!isNaN(preMute) && preMute > 0) preMuteVolume = preMute;
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
          } else if (row.key === "player.max_queue_size") {
            const n = parseInt(row.value, 10);
            if (!isNaN(n)) set({ maxQueueSize: Math.max(1, Math.min(1000, n)) });
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
              activeTarget = new DlnaTarget(
                savedRenderer,
                () => { void get().next(true); },
                savedBitrate,
                (message) => {
                  set({ error: message, isPlaying: false, isBuffering: false });
                  stopElapsedTimer();
                }
              );
              set({ castDevice: savedRenderer });
            } catch { /* malformed, ignore */ }
          }
        }
        // Load waveform from cache for the restored track, fetchWaveform is only
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
