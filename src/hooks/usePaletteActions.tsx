import { Pause, Play, Radio, RefreshCw, Shuffle, SkipForward, Timer } from "lucide-react";
import type { PaletteAction } from "../components/CommandPalette";
import { usePlayerStore } from "../features/playback/store/player";
import { isNextDisabled } from "../features/playback/store/playerTypes";
import { useStartRadio } from "../features/radio/hooks/useStartRadio";
import { loadRandomLibraryTrack } from "../features/radio/lib/librarySeed";
import type { useLibrarySync } from "../features/sync/useLibrarySync";
import { plural } from "../lib/plural";
import { currentTrackFromRow, makeStreamUrlBuilder } from "../lib/track";
import type { ServerWithCredential } from "./useServer";

const SLEEP_TIMER_PRESET_MINUTES = 30;

export function usePaletteActions(
  serverWithCredential: ServerWithCredential | undefined,
  runSync: ReturnType<typeof useLibrarySync>["runSync"],
  isSyncing: boolean,
): PaletteAction[] {
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null && s.streamUrlFor !== null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const radioActive = usePlayerStore((s) => s.radioActive);
  const canSkip = usePlayerStore((s) => !isNextDisabled(s.repeat, s.queueIndex, s.queue.length, s.radioOnQueueEnd));
  const startRadio = useStartRadio();

  const actions: PaletteAction[] = [];
  if (hasTrack) {
    actions.push({
      id: "play-pause",
      label: isPlaying ? "Pause" : "Play",
      icon: isPlaying ? <Pause size={16} /> : <Play size={16} />,
      run: () => {
        const store = usePlayerStore.getState();
        // Matches the transport buttons, which are disabled while a track loads.
        if (store.isLoading) return;
        store.isPlaying ? store.pause() : store.resume();
      },
    });
    if (canSkip) {
      actions.push({
        id: "next",
        label: "Next track",
        icon: <SkipForward size={16} />,
        run: () => void usePlayerStore.getState().next(),
      });
    }
    if (!radioActive) {
      actions.push({
        id: "radio-from-current",
        label: "Start radio from current track",
        icon: <Radio size={16} />,
        run: () => {
          const { currentTrack, streamUrlFor } = usePlayerStore.getState();
          if (!currentTrack || !streamUrlFor) return;
          void startRadio({ tracks: [], seed: currentTrack, streamUrlFor });
        },
      });
    }
    actions.push({
      id: "sleep-timer",
      label: `Sleep timer: ${SLEEP_TIMER_PRESET_MINUTES} ${plural(SLEEP_TIMER_PRESET_MINUTES, "minute")}`,
      icon: <Timer size={16} />,
      run: () => usePlayerStore.getState().setSleepTimer(SLEEP_TIMER_PRESET_MINUTES),
    });
  }
  if (serverWithCredential) {
    actions.push({
      id: "shuffle-library",
      label: "Shuffle library",
      icon: <Shuffle size={16} />,
      run: () => void shuffleLibrary(serverWithCredential, startRadio),
    });
    // A resync asked for during a sync would not start, so it is not offered.
    if (!isSyncing) {
      actions.push({
        id: "resync-library",
        label: "Resync library",
        icon: <RefreshCw size={16} />,
        run: () => runSync(serverWithCredential, { forceTrackPass: true }),
      });
    }
  }
  return actions;
}

async function shuffleLibrary(
  { server, credential }: ServerWithCredential,
  startRadio: ReturnType<typeof useStartRadio>,
): Promise<void> {
  const row = await loadRandomLibraryTrack(server.id);
  if (!row) return;
  const track = currentTrackFromRow(row, server, credential);
  await startRadio({ tracks: [track], streamUrlFor: makeStreamUrlBuilder(server, credential), mode: "random" });
}
