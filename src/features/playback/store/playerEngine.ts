import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SUBSONIC_NOT_FOUND } from "../../../clients/navidrome";
import { buildShuffleOrder, resolveTrack } from "./queueOrder";
import { computeReplayGainLinear } from "./replayGain";
import { runtime } from "./playerRuntime";
import type { PlayerPersistence } from "./playerPersistence";
import type { PlayerWaveform } from "./playerWaveform";
import { plainError, type CurrentTrack, type PlayerGet, type PlayerSet } from "./playerTypes";

const BUFFER_DEADLINE_MS = 30000;

export function createPlayerEngine(
  set: PlayerSet,
  get: PlayerGet,
  { persistQueueState }: PlayerPersistence,
  { preloadWaveforms, fetchWaveform }: PlayerWaveform
) {
  // Rust emits this immediately after sink.append(source): earliest, most accurate signal
  // that the fetch/probe wait is over. The ticker's position check below backstops paths with no format event.
  void listen<{ sample_rate: number; channels: number; codec: string }>("audio-format", (event) => {
    clearBufferDeadline();
    set({
      audioFormat: { sampleRate: event.payload.sample_rate, channels: event.payload.channels, codec: event.payload.codec },
      isBuffering: false,
    });
  });

  function clearBufferDeadline() {
    if (runtime.bufferDeadlineTimer) clearTimeout(runtime.bufferDeadlineTimer);
    runtime.bufferDeadlineTimer = null;
  }

  // Armed whenever playback is asked for and disarmed the moment sound actually starts. If it
  // reaches the end of its wait with the position still at zero, the stream is never going to
  // produce audio and the user is told so instead of watching an indefinite sweep.
  function armBufferDeadline(url: string) {
    clearBufferDeadline();
    runtime.bufferDeadlineTimer = setTimeout(() => {
      runtime.bufferDeadlineTimer = null;
      const { streamUrl, isBuffering, elapsed } = get();
      if (streamUrl !== url || !isBuffering || elapsed > 0) return;
      runtime.cancelAudioError?.();
      runtime.cancelAudioError = null;
      stopElapsedTimer();
      void runtime.activeTarget.stop();
      set({
        isPlaying: false,
        isLoading: false,
        isBuffering: false,
        error: plainError("The track never started playing. The server may be unreachable or overloaded"),
      });
    }, BUFFER_DEADLINE_MS);
  }

  // Non-gapless fallback: Rust reports playback reached natural end of file.
  void listen("track-ended", () => {
    void get().next(true);
  });

  // The Rust enqueue thread gave up on a queued gapless source (fetch failed, decode failed, or a
  // newer play superseded it). Without this the suppression flag below would stay set for the rest
  // of the session, disabling the position-based fallback advance exactly when it is most needed.
  void listen("gapless-cancelled", () => {
    runtime.gaplessActive = false;
    runtime.gaplessEnqueued = null;
  });

  // Gapless transition: Rust reports that the current source finished and the queued next one started.
  // Advance queue state without calling audio_play, the audio is already playing.
  void listen("track-advanced", () => {
    const enqueued = runtime.gaplessEnqueued;
    runtime.gaplessActive = false;
    runtime.gaplessEnqueued = null;
    runtime.naturalEndFiredForIndex = null;
    runtime.lastEndedTrackId = null;
    const { queue, queueIndex, streamUrlFor, isShuffled, shuffleOrder, repeat } = get();
    if (!streamUrlFor) return;
    const nextPosition = queueIndex + 1;
    const wrapped = enqueued ? enqueued.wraps : nextPosition >= queue.length;
    if (wrapped && repeat !== "repeat-all") return;

    let newQueueIndex: number;
    let newShuffleOrder = shuffleOrder;
    let nextTrack: CurrentTrack | null;

    if (wrapped) {
      // Adopt the order the enqueue already built and resolved against the handed-over source;
      // rebuilding would put some other track at position 0. Fall back if a queue edit inside the lead window invalidated it.
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
    const { volume, replayGainMode, replayGainPreAmp, replayGainFallbackGain, castDevice } = get();
    runtime.currentReplayGainLinear = castDevice
      ? 1.0
      : computeReplayGainLinear(nextTrack.replayGain, replayGainMode, replayGainPreAmp, replayGainFallbackGain);
    void runtime.activeTarget.setVolume(volume * Math.sqrt(runtime.currentReplayGainLinear));
    // A sleep timer set after the next source was already enqueued can't stop the transition;
    // honour it here instead (covers only a timer armed inside the gapless lead window).
    if (get().sleepTimerEndOfTrack) {
      get().clearSleepTimer();
      runtime.activeTarget.pause(0);
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
    if (runtime.elapsedInterval) clearInterval(runtime.elapsedInterval);
    // Keyed on index *and* queue revision: a reorder or removal changes which track follows
    // without changing queueIndex, and an index-only guard would lock out the corrected
    // hand-off for the rest of the track.
    let prefetchedFor: string | null = null;
    let stallPos: number | null = null;
    let stallSince: number | null = null;
    // audio_play returns before decode finishes, so position stays 0 during buffering; arming
    // the watchdog then would restart the stream every 5s and it would never start.
    let hasAdvanced = false;
    runtime.elapsedInterval = setInterval(() => {
      const genAtPoll = runtime.seekGen;
      runtime.activeTarget.getPosition()
        .then((pos) => {
          // A seek landed while this poll was in flight, so `pos` predates it. Dropping the
          // whole tick (not just the set) keeps the stall watchdog and the natural-end check
          // from reasoning about a position the engine has already moved away from.
          if (genAtPoll !== runtime.seekGen) return;
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
            if (started && runtime.waveformPreloadedFor !== started.id) {
              runtime.waveformPreloadedFor = started.id;
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
                void runtime.activeTarget.load(streamUrl, currentTrack, currentTrack.coverArtUrl ?? null).then(() => {
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
            prefetchedFor !== `${queueIndex}:${runtime.queueRevision}` &&
            // An end-of-track sleep timer means there is no next track to hand off to. Queuing one
            // anyway makes the engine (or the renderer) advance on its own, past the point where
            // next() would have stopped playback, so the timer never takes effect at all.
            !sleepTimerEndOfTrack
          ) {
            prefetchedFor = `${queueIndex}:${runtime.queueRevision}`;
            // Gapless: enqueue directly into the audio engine so the transition is seamless.
            // Disabled for DLNA (handles its own gapless), repeat-one (would enqueue wrong track),
            // and consume mode (index shifts after removal would desync the gapless queue).
            const canGapless = !castDevice && gapless && repeat !== "repeat-one" && !consumeMode;
            if (repeat === "repeat-one") {
              // This same track plays again, so warming the successor downloads a whole file that
              // will never be heard, once per repetition. Warm the current URL instead: audio_play
              // consumes the prefetch cache, so the loop restarts instantly for the same bytes.
              if (!castDevice && currentTrack && streamUrl) {
                void runtime.activeTarget.setNext(streamUrl, currentTrack, currentTrack.coverArtUrl ?? null);
              }
            } else {
              // A repeat-all loop-back under shuffle installs a fresh order; the opening track is
              // position 0 of that order. rodio can't un-append, so decide the order here and carry it to track-advanced.
              const wrapOrder = canGapless && wrapping && isShuffled && queue.length > 1
                ? buildShuffleOrder(queue.length, -1)
                : null;
              const effectiveNext = wrapping ? 0 : nextPosition;
              const nextTrack = resolveTrack(queue, wrapOrder ?? shuffleOrder, isShuffled, effectiveNext);
              if (nextTrack) {
                const nextUrl = streamUrlFor(nextTrack);
                if (canGapless) {
                  // A queue edit can get us here a second time, but rodio can't un-append; the slot
                  // is already claimed. Re-recording gaplessEnqueued would name a track the engine never received.
                  if (!runtime.gaplessActive) {
                    runtime.gaplessActive = true;
                    runtime.gaplessEnqueued = { track: nextTrack, position: effectiveNext, wraps: wrapping, ...(wrapOrder ? { wrapOrder } : {}) };
                    void invoke<void>("audio_enqueue_next", { url: nextUrl }).catch(() => {
                      runtime.gaplessActive = false;
                      runtime.gaplessEnqueued = null;
                    });
                  }
                } else if (!castDevice && !(wrapping && isShuffled)) {
                  // Skipped for a shuffled wrap: next() builds its own order when it gets there,
                  // so which track opens the new pass is not knowable yet and this would warm the
                  // wrong one.
                  void runtime.activeTarget.setNext(nextUrl, nextTrack, nextTrack.coverArtUrl ?? null);
                }
                // Nothing handed to a cast target ahead of time: it would advance on its own and
                // Canon can't observe the transition (GetTransportInfo reads PLAYING across it).
              }
            }
          }
          // Fallback: advance when pos reaches end in case track-ended doesn't fire (suppressed
          // for gapless/DLNA). Requires isPlaying, or position drift while paused (e.g. the seek-while-paused bug) skips a track.
          if (isPlaying && !castDevice && !runtime.gaplessActive && duration && pos >= duration - 0.25 && runtime.naturalEndFiredForIndex !== queueIndex) {
            runtime.naturalEndFiredForIndex = queueIndex;
            void get().next(true);
          }
        })
        .catch(() => {});
    }, 200);
  }

  function stopElapsedTimer() {
    if (runtime.elapsedInterval) {
      clearInterval(runtime.elapsedInterval);
      runtime.elapsedInterval = null;
    }
  }

  // Sets up an audio-error listener that retries audio_play up to 4x on stream
  // failures (HTTP error, decode error). Cleans itself up on track change.
  async function setupAudioErrorListener(url: string) {
    let retryCount = 0;
    const retryDelays = [2000, 4000, 8000, 16000];
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const unlisten = await listen<{ url: string; message: string; detail?: string; retryable?: boolean; subsonicCode?: number | null }>("audio-error", (event) => {
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
            // empty: the listener above handles the next audio-error retry
          }
        }, delay);
      } else {
        unlisten();
        runtime.cancelAudioError = null;
        if (event.payload.detail) console.error("Playback failed:", event.payload.detail);
        clearBufferDeadline();
        stopElapsedTimer();
        set({
          isPlaying: false,
          isLoading: false,
          isBuffering: false,
          error: {
            message: event.payload.message,
            cause: event.payload.subsonicCode === SUBSONIC_NOT_FOUND ? "stale-track-id" : null,
          },
        });
      }
    });

    runtime.cancelAudioError = () => {
      unlisten();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    };
  }

  // nav=true: debounces 100ms so rapid prev/next coalesces to one HTTP request.
  async function playTrack(track: CurrentTrack, url: string, nav = false) {
    runtime.naturalEndFiredForIndex = null;
    runtime.lastEndedTrackId = null;
    runtime.gaplessActive = false;
    runtime.gaplessEnqueued = null;
    runtime.pauseRequestedDuringLoad = false;
    set({ currentTrack: track, streamUrl: url, isPlaying: false, isLoading: true, isBuffering: true, error: null, elapsed: 0, playStartedAt: Date.now(), waveformPeaks: null, audioFormat: null });
    stopElapsedTimer();
    armBufferDeadline(url);

    runtime.cancelAudioError?.();
    runtime.cancelAudioError = null;

    const doPlay = async () => {
      const { castDevice } = get();
      if (!castDevice) void setupAudioErrorListener(url);
      try {
        await runtime.activeTarget.load(url, track, track.coverArtUrl ?? null);
        if (get().currentTrack?.id !== track.id) return;
        const paused = runtime.pauseRequestedDuringLoad;
        runtime.pauseRequestedDuringLoad = false;
        // isBuffering deliberately not re-asserted: on a prefetch-cache hit, audio-format may
        // already have landed, and setting it back to true would leave it stuck until the ticker cleared it.
        set(get().castDevice ? { isPlaying: !paused, isLoading: false, isBuffering: false } : { isPlaying: !paused, isLoading: false });
        const { volume, replayGainMode, replayGainPreAmp, replayGainFallbackGain, castDevice } = get();
        runtime.currentReplayGainLinear = castDevice
          ? 1.0
          : computeReplayGainLinear(track.replayGain, replayGainMode, replayGainPreAmp, replayGainFallbackGain);
        void runtime.activeTarget.setVolume(volume * Math.sqrt(runtime.currentReplayGainLinear));
        // The user asked to pause while this track was still loading. Re-apply that against the
        // sink that now exists (the earlier pause raced the load and may have hit nothing), and
        // leave the elapsed ticker stopped until they resume.
        if (paused) {
          runtime.activeTarget.pause(0);
        } else {
          startElapsedTimer();
        }
        void fetchWaveform(track.id, url);
        // preloadWaveforms is deliberately not called here, see the elapsed ticker.
      } catch (e) {
        if (get().currentTrack?.id !== track.id) return;
        set({ isPlaying: false, isLoading: false, isBuffering: false, error: plainError(e instanceof Error ? e.message : String(e)) });
      }
    };

    if (nav) {
      if (runtime.navDebounceTimer) clearTimeout(runtime.navDebounceTimer);
      runtime.navDebounceTimer = setTimeout(() => {
        runtime.navDebounceTimer = null;
        if (get().currentTrack?.id !== track.id) return;
        void doPlay();
      }, 100);
    } else {
      await doPlay();
    }
  }

  return { clearBufferDeadline, startElapsedTimer, stopElapsedTimer, playTrack };
}

export type PlayerEngine = ReturnType<typeof createPlayerEngine>;
