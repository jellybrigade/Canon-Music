import { useBoolSetting, useSetting } from "../../hooks/useSetting";
import { usePlayerStore } from "../../store/player";
import { SettingRow } from "./SettingRow";

interface Props {
  searchQuery: string;
}

export function PlaybackTab({ searchQuery }: Props) {
  const [showWaveform, setShowWaveform] = useBoolSetting("player.show_waveform", false);
  const [restoreQueue, setRestoreQueue] = useBoolSetting("queue.restore_on_startup", false);
  const [playAction, setPlayAction] = useSetting("album.play_action", "replace");

  const speed = usePlayerStore((s) => s.speed);
  const setSpeed = usePlayerStore((s) => s.setSpeed);
  const pauseFadeMs = usePlayerStore((s) => s.pauseFadeMs);
  const setPauseFadeMs = usePlayerStore((s) => s.setPauseFadeMs);
  const consumeMode = usePlayerStore((s) => s.consumeMode);
  const toggleConsumeMode = usePlayerStore((s) => s.toggleConsumeMode);
  const consumeOnSkip = usePlayerStore((s) => s.consumeOnSkip);
  const toggleConsumeOnSkip = usePlayerStore((s) => s.toggleConsumeOnSkip);

  const fl = searchQuery.toLowerCase().trim();
  const show = (...labels: string[]) => !fl || labels.some(l => l.toLowerCase().includes(fl));

  return (
    <>
      {show("queue", "restore", "play album", "action") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Queue</h3>
          <SettingRow
            title="Restore queue on startup"
            description="Restores your last queue and position when Canon starts. Playback does not resume automatically."
          >
            <input
              type="checkbox"
              checked={restoreQueue}
              onChange={(e) => void setRestoreQueue(e.target.checked)}
            />
          </SettingRow>
          <SettingRow title="Play album action" description="What clicking ▶ Play Album does to the current queue.">
            <select
              value={playAction}
              onChange={(e) => void setPlayAction(e.target.value)}
              className="settings-select"
            >
              <option value="replace">Replace queue</option>
              <option value="queue_next">Play next</option>
              <option value="queue_last">Add to end</option>
              <option value="shuffle">Shuffle &amp; play</option>
            </select>
          </SettingRow>
        </section>
      )}

      {show("audio", "speed", "fade", "pause", "resume") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Audio</h3>
          <SettingRow
            title={`Playback speed — ${speed.toFixed(2)}×`}
            description="Speed up or slow down playback. Affects pitch (no time-stretch)."
            stacked
          >
            <input
              type="range"
              className="settings-range"
              min={0.5}
              max={2.0}
              step={0.05}
              value={speed}
              onChange={(e) => void setSpeed(parseFloat(e.target.value))}
            />
          </SettingRow>
          <SettingRow
            title={`Pause/resume fade — ${pauseFadeMs === 0 ? "off" : `${pauseFadeMs} ms`}`}
            description="Smooth volume fade when pausing and resuming. 0 = instant."
            stacked
          >
            <input
              type="range"
              className="settings-range"
              min={0}
              max={2000}
              step={50}
              value={pauseFadeMs}
              onChange={(e) => { void setPauseFadeMs(parseInt(e.target.value, 10)); }}
            />
          </SettingRow>
        </section>
      )}

      {show("consume", "skip") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Consume</h3>
          <SettingRow
            title="Consume mode"
            description="Remove each track from the queue after it finishes playing. Disabled in shuffle mode."
          >
            <input
              type="checkbox"
              checked={consumeMode}
              onChange={() => void toggleConsumeMode()}
            />
          </SettingRow>
          <SettingRow
            title="Also consume on manual skip"
            description="Remove a track from the queue when you skip it manually."
          >
            <input
              type="checkbox"
              checked={consumeOnSkip}
              disabled={!consumeMode}
              style={{ opacity: consumeMode ? 1 : 0.4 }}
              onChange={() => void toggleConsumeOnSkip()}
            />
          </SettingRow>
        </section>
      )}

      {show("waveform", "display", "progress bar") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Display</h3>
          <SettingRow
            title="Show waveform progress bar"
            description="Displays audio amplitude envelope in the progress bar. Extracted on first play and cached locally."
          >
            <input
              type="checkbox"
              checked={showWaveform}
              onChange={(e) => void setShowWaveform(e.target.checked)}
            />
          </SettingRow>
        </section>
      )}
    </>
  );
}
