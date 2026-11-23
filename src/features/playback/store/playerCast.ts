import { type DlnaRenderer, getTransportInfo } from "../../../clients/dlna";
import { parseIntegerOr } from "../../../lib/numberSetting";
import { useDismissibleNoticeStore } from "../../../store/dismissibleNotice";
import { DlnaTarget, LocalTarget, type PlaybackTarget } from "./playbackTarget";
import type { PlayerEngine } from "./playerEngine";
import { runtime } from "./playerRuntime";
import { type PlayerGet, type PlayerSet, plainError } from "./playerTypes";

export const CAST_MAX_BITRATE_SETTING = "cast.max_bitrate";
export const CAST_MAX_BITRATE_DEFAULT = 320;

// Held in memory so a skip while casting never waits on SQLite; loadSettings and the
// settings screen keep it current.
let castMaxBitrate = CAST_MAX_BITRATE_DEFAULT;

export function applyCastMaxBitrate(value: string | undefined): void {
  castMaxBitrate = parseIntegerOr(value, CAST_MAX_BITRATE_DEFAULT);
}

function readCastMaxBitrate(): number {
  return castMaxBitrate;
}

function withRenderer(renderers: DlnaRenderer[], renderer: DlnaRenderer): DlnaRenderer[] {
  return renderers.some((r) => r.baseUrl === renderer.baseUrl) ? renderers : [...renderers, renderer];
}

export function createPlayerCast(set: PlayerSet, get: PlayerGet, { stopElapsedTimer, playTrack }: PlayerEngine) {
  function createCastTarget(renderer: DlnaRenderer): DlnaTarget {
    return new DlnaTarget({
      renderer,
      readMaxBitrate: readCastMaxBitrate,
      onTrackEnd: () => {
        void get().next(true);
      },
      onError: (message) => {
        // The renderer stopped answering. Nothing else on the cast path surfaces this:
        // there is no audio-error event, and the target has stopped its own timers.
        set({ error: plainError(message), isPlaying: false, isBuffering: false });
        stopElapsedTimer();
      },
    });
  }

  // The saved cast.device row is left as is, so a later scan can reconnect to it.
  async function verifyRestoredCastDevice(renderer: DlnaRenderer, restoredTarget: PlaybackTarget): Promise<void> {
    let isAnswering = true;
    try {
      await getTransportInfo(renderer.avTransportControlUrl);
    } catch {
      isAnswering = false;
    }
    // Every device choice replaces the target, so a different one means the user already chose.
    if (runtime.activeTarget !== restoredTarget) return;
    if (isAnswering) {
      set((s) => ({ availableRenderers: withRenderer(s.availableRenderers, renderer) }));
      return;
    }
    restoredTarget.teardown();
    runtime.activeTarget = new LocalTarget();
    set({ castDevice: null });
    useDismissibleNoticeStore.getState().report(`${renderer.name} didn't answer, playing on this computer.`);
    // Startup restores the queue without loading it, so a stream URL means the user started a
    // track on the silent device while it was being checked.
    const { currentTrack, streamUrl } = get();
    if (currentTrack && streamUrl && !runtime.pauseRequestedDuringLoad) void playTrack(currentTrack);
  }

  return { createCastTarget, verifyRestoredCastDevice };
}

export type PlayerCast = ReturnType<typeof createPlayerCast>;
