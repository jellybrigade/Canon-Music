import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { getStreamUrl } from "../../../clients/navidromeUrls";
import { getDb } from "../../../db";
import type { ServerWithCredential } from "../../../hooks/useServer";
import { runPool } from "../../../lib/asyncPool";
import { stripServerPrefix } from "../../../lib/ids";
import { waveformStreamUrl } from "../lib/waveformDisplay";
import { usePlayerStore } from "./player";
import { waveformInFlight } from "./playerRuntime";

// Each extraction holds a download and a decode thread; two keeps the rest of the app responsive.
const CONCURRENCY = 2;

interface WaveformBackfillState {
  progress: { done: number; total: number } | null;
}

export const useWaveformBackfillStore = create<WaveformBackfillState>()(() => ({ progress: null }));

interface BackfillRun {
  controller: AbortController;
  /** Names this run's extractions to Rust, so a stop also reaches one still on its way there. */
  batch: string;
}

let activeRun: BackfillRun | null = null;
// Rust keeps stopped batches for its lifetime, which outlasts a webview reload resetting this count.
let runCount = 0;

const MISSING_WAVEFORMS_SQL = `FROM tracks
  WHERE server_id = ? AND NOT EXISTS (SELECT 1 FROM waveform_cache w WHERE w.track_id = tracks.id)`;

export async function getMissingWaveformCount(serverId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(`SELECT COUNT(*) AS count ${MISSING_WAVEFORMS_SQL}`, [serverId]);
  return rows[0]?.count ?? 0;
}

/** Extracts every waveform this server's library lacks, until done, stopped, or playback starts. */
export async function startWaveformBackfill({ server, credential }: ServerWithCredential): Promise<void> {
  if (activeRun) return;
  const run: BackfillRun = { controller: new AbortController(), batch: `${Date.now()}-${++runCount}` };
  activeRun = run;
  const isCurrent = () => activeRun === run;

  const stopOnPlay = usePlayerStore.subscribe((state, previous) => {
    if (state.playStartedAt !== previous.playStartedAt || (state.isPlaying && !previous.isPlaying)) {
      stopWaveformBackfill();
    }
  });

  try {
    const db = await getDb();
    const tracks = await db.select<{ id: string; duration: number | null }[]>(
      `SELECT id, duration ${MISSING_WAVEFORMS_SQL} ORDER BY id`,
      [server.id],
    );
    await runPool(
      tracks,
      async (track) => {
        // The player or an earlier run already owns this one; a second run would share its temp file.
        if (waveformInFlight.has(track.id)) return;
        const streamUrl = getStreamUrl(server.url, server.username, credential, stripServerPrefix(track.id, server.id));
        waveformInFlight.add(track.id);
        try {
          await invoke("audio_extract_waveform", {
            trackId: track.id,
            url: waveformStreamUrl(streamUrl),
            durationSecs: track.duration ?? 0,
            batch: run.batch,
          });
        } catch {
          // Failed or cancelled: nothing was stored, so the next run tries it again. The error
          // isn't logged because it can quote the stream URL and its credentials.
          waveformInFlight.delete(track.id);
        }
      },
      {
        concurrency: CONCURRENCY,
        signal: run.controller.signal,
        onProgress: (done, total) => {
          if (isCurrent()) useWaveformBackfillStore.setState({ progress: { done, total } });
        },
      },
    );
  } finally {
    stopOnPlay();
    if (isCurrent()) {
      activeRun = null;
      useWaveformBackfillStore.setState({ progress: null });
    }
  }
}

export function stopWaveformBackfill(): void {
  const run = activeRun;
  if (!run) return;
  activeRun = null;
  run.controller.abort();
  useWaveformBackfillStore.setState({ progress: null });
  // The playing track's extraction is the one the player bar is waiting on.
  const keepTrackId = usePlayerStore.getState().currentTrack?.id ?? null;
  void invoke("audio_stop_waveform_batch", { batch: run.batch, keepTrackId }).catch(() => {});
}
