import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getDb } from "../../../db";
import { resolveTrack } from "./queueOrder";
import { WAVEFORM_BAR_COUNT, WAVEFORM_STUB_PEAK } from "../lib/waveformDisplay";
import { runtime, waveformInFlight } from "./playerRuntime";
import type { PlayerGet, PlayerSet } from "./playerTypes";

export function createPlayerWaveform(set: PlayerSet, get: PlayerGet) {
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
    runtime.cancelWaveform?.();
    runtime.cancelWaveform = null;

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
      const rawPeaks = new Array<number>(WAVEFORM_BAR_COUNT).fill(0);
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
          const display = rawPeaks.map((v, i) => i < filledCount ? v * scale : WAVEFORM_STUB_PEAK);
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
          runtime.cancelWaveform = null;
          if (get().currentTrack?.id === trackId) {
            set({ waveformPeaks: event.payload.peaks });
          }
          // Caching is owned by the global waveform_complete listener.
        }
      );

      // Hold references so a future track can cancel these listeners if it starts before waveform_complete fires
      runtime.cancelWaveform = () => {
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

  return { preloadWaveforms, fetchWaveform };
}

export type PlayerWaveform = ReturnType<typeof createPlayerWaveform>;
