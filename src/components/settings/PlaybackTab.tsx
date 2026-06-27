import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useBoolSetting, useSetting } from "../../hooks/useSetting";
import { usePlayerStore } from "../../store/player";
import { SettingRow } from "./SettingRow";

interface Props {
  searchQuery: string;
}

export function PlaybackTab({ searchQuery }: Props) {
  const [showWaveform, setShowWaveform] = useBoolSetting("player.show_waveform", false);
  const [showAlbumSuffixes, setShowAlbumSuffixes] = useBoolSetting("display.show_album_suffixes", false);
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
  const gapless = usePlayerStore((s) => s.gapless);
  const toggleGapless = usePlayerStore((s) => s.toggleGapless);
  const radioOnQueueEnd = usePlayerStore((s) => s.radioOnQueueEnd);
  const toggleRadioOnQueueEnd = usePlayerStore((s) => s.toggleRadioOnQueueEnd);

  const [minSeconds, setMinSeconds] = useSetting("scrobble.min_seconds", "240");
  const [thresholdPct, setThresholdPct] = useSetting("scrobble.threshold_percent", "50");

  const [autoSyncIntervalMin, setAutoSyncIntervalMin] = useSetting("library.auto_sync_interval_min", "5");
  const [streamMaxBitrate, setStreamMaxBitrate] = useSetting("stream.max_bitrate", "0");
  const [castMaxBitrate, setCastMaxBitrate] = useSetting("cast.max_bitrate", "320");

  const replayGainMode = usePlayerStore((s) => s.replayGainMode);
  const setReplayGainMode = usePlayerStore((s) => s.setReplayGainMode);
  const replayGainPreAmp = usePlayerStore((s) => s.replayGainPreAmp);
  const setReplayGainPreAmp = usePlayerStore((s) => s.setReplayGainPreAmp);
  const replayGainFallbackGain = usePlayerStore((s) => s.replayGainFallbackGain);
  const setReplayGainFallbackGain = usePlayerStore((s) => s.setReplayGainFallbackGain);

  const [showTrayIcon, setShowTrayIcon] = useBoolSetting("tray.show_icon", false);
  const [closeToTray, setCloseToTray] = useBoolSetting("tray.close_to_tray", false);

  const availableRenderers  = usePlayerStore((s) => s.availableRenderers);
  const isScanningRenderers = usePlayerStore((s) => s.isScanningRenderers);
  const scanRenderers       = usePlayerStore((s) => s.scanRenderers);
  const castDevice          = usePlayerStore((s) => s.castDevice);
  const setCastDevice       = usePlayerStore((s) => s.setCastDevice);
  const [scanRan, setScanRan] = useState(false);

  const fl = searchQuery.toLowerCase().trim();
  const show = (...labels: string[]) => !fl || labels.some((l) => l.toLowerCase().includes(fl));

  return (
    <>
      {show("library", "sync", "auto sync", "background sync", "interval") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Library</h3>
          <SettingRow
            title="Background sync interval"
            description="How often Canon automatically re-syncs the library in the background. Set to 0 to disable."
          >
            <select
              value={autoSyncIntervalMin}
              onChange={(e) => void setAutoSyncIntervalMin(e.target.value)}
              className="settings-select"
            >
              <option value="0">Off</option>
              <option value="5">Every 5 minutes</option>
              <option value="15">Every 15 minutes</option>
              <option value="30">Every 30 minutes</option>
              <option value="60">Every hour</option>
            </select>
          </SettingRow>
        </section>
      )}

      {show("queue", "restore", "play album", "action", "radio", "continuous", "autoplay") && (
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
          <SettingRow
            title="Continue with radio when queue ends"
            description="When your queue runs out, Canon automatically starts radio from the last track that played."
          >
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={radioOnQueueEnd}
                onChange={() => void toggleRadioOnQueueEnd()}
              />
              <span className="toggle-track" />
            </label>
          </SettingRow>
        </section>
      )}

      {show("gapless", "seamless", "silence", "gap") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Gapless playback</h3>
          <SettingRow
            title="Gapless playback"
            description="Eliminates silence between tracks by queuing the next track before the current one ends. Disabled during casting, repeat-one, and consume mode."
          >
            <input
              type="checkbox"
              checked={gapless}
              onChange={() => void toggleGapless()}
            />
          </SettingRow>
        </section>
      )}

      {show("audio", "speed", "fade", "pause", "resume", "stream", "quality", "bitrate", "transcod") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Audio</h3>
          <SettingRow
            title="Stream quality"
            description="Max bitrate for audio streaming. Raw sends the original file. Lower bitrates reduce bandwidth via server-side transcoding."
          >
            <select
              value={streamMaxBitrate}
              onChange={(e) => void setStreamMaxBitrate(e.target.value)}
              className="settings-select"
            >
              <option value="0">Raw (original)</option>
              <option value="320">320 kbps</option>
              <option value="192">192 kbps</option>
              <option value="128">128 kbps</option>
            </select>
          </SettingRow>
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

      {show("replay gain", "normalization", "loudness", "volume", "gain", "peak", "preamp") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Volume normalization</h3>
          <SettingRow
            title="ReplayGain mode"
            description="Adjusts playback volume based on ReplayGain tags so tracks play at a consistent loudness. Requires a library sync to pull gain data from the server."
          >
            <select
              value={replayGainMode}
              onChange={(e) => void setReplayGainMode(e.target.value as "off" | "track" | "album")}
              className="settings-select"
            >
              <option value="off">Off</option>
              <option value="track">Track gain</option>
              <option value="album">Album gain</option>
            </select>
          </SettingRow>
          {replayGainMode !== "off" && (
            <>
              <SettingRow
                title={`Pre-amp — ${replayGainPreAmp >= 0 ? "+" : ""}${replayGainPreAmp} dB`}
                description="Offset applied on top of the ReplayGain value. Use to raise or lower the normalized level globally."
                stacked
              >
                <input
                  type="range"
                  className="settings-range"
                  min={-15}
                  max={15}
                  step={0.5}
                  value={replayGainPreAmp}
                  onChange={(e) => void setReplayGainPreAmp(parseFloat(e.target.value))}
                />
              </SettingRow>
              <SettingRow
                title={`Fallback gain — ${replayGainFallbackGain} dB`}
                description="Applied to tracks that have no ReplayGain tags. A negative value prevents clipping on unknown tracks."
                stacked
              >
                <input
                  type="range"
                  className="settings-range"
                  min={-15}
                  max={0}
                  step={0.5}
                  value={replayGainFallbackGain}
                  onChange={(e) => void setReplayGainFallbackGain(parseFloat(e.target.value))}
                />
              </SettingRow>
            </>
          )}
        </section>
      )}

      {show("tray", "system tray", "minimize", "background", "close", "hide") && (
        <section className="settings-section">
          <h3 className="settings-section-title">System tray</h3>
          <SettingRow
            title="Show system tray icon"
            description="Adds a Canon icon to the system tray. Click to toggle window visibility."
          >
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={showTrayIcon}
                onChange={(e) => {
                  void setShowTrayIcon(e.target.checked);
                  void invoke("tray_set_visible", { visible: e.target.checked }).catch(() => {});
                }}
              />
              <span className="toggle-track" />
            </label>
          </SettingRow>
          <SettingRow
            title="Close to tray"
            description="Clicking the window close button hides Canon to the tray instead of quitting. Requires Show system tray icon."
          >
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={closeToTray}
                disabled={!showTrayIcon}
                style={{ opacity: showTrayIcon ? 1 : 0.4 }}
                onChange={(e) => {
                  void setCloseToTray(e.target.checked);
                  void invoke("tray_set_close_to_tray", { enabled: e.target.checked }).catch(() => {});
                }}
              />
              <span className="toggle-track" />
            </label>
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

      {show("scrobble", "last.fm", "threshold", "scrobbling") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Scrobbling</h3>
          <SettingRow
            title={`Min time before scrobble — ${minSeconds}s`}
            description="Track must have played this many seconds before it can be scrobbled."
            stacked
          >
            <input
              type="range"
              className="settings-range"
              min={0}
              max={300}
              step={10}
              value={minSeconds}
              onChange={(e) => void setMinSeconds(e.target.value)}
            />
          </SettingRow>
          <SettingRow
            title={`Completion threshold — ${thresholdPct}%`}
            description="Scrobble after this percentage of the track has played (whichever condition is met first)."
            stacked
          >
            <input
              type="range"
              className="settings-range"
              min={25}
              max={100}
              step={5}
              value={thresholdPct}
              onChange={(e) => void setThresholdPct(e.target.value)}
            />
          </SettingRow>
        </section>
      )}

      {show("cast", "casting", "dlna", "upnp", "renderer", "airplay", "wireless", "device") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Casting</h3>
          <SettingRow
            title="Cast quality"
            description="Max bitrate when streaming to a DLNA renderer. Many renderers cannot play high-bitrate FLAC — transcoding to a lower bitrate improves compatibility."
          >
            <select
              value={castMaxBitrate}
              onChange={(e) => void setCastMaxBitrate(e.target.value)}
              className="settings-select"
            >
              <option value="0">Raw (original)</option>
              <option value="320">320 kbps</option>
              <option value="192">192 kbps</option>
              <option value="128">128 kbps</option>
            </select>
          </SettingRow>
          <SettingRow
            title="Devices"
            description={
              scanRan
                ? isScanningRenderers
                  ? "Scanning for UPnP/DLNA renderers…"
                  : availableRenderers.length === 0
                    ? "No renderers found."
                    : `${availableRenderers.length} renderer${availableRenderers.length === 1 ? "" : "s"} found.`
                : "Scan the network for UPnP/DLNA renderers."
            }
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", alignItems: "flex-end" }}>
              <button
                className="settings-btn"
                disabled={isScanningRenderers}
                onClick={() => { setScanRan(true); void scanRenderers(); }}
              >
                {isScanningRenderers ? "Scanning…" : "Scan now"}
              </button>
              {availableRenderers.map((r) => (
                <button
                  key={r.baseUrl}
                  className={`settings-btn${castDevice?.baseUrl === r.baseUrl ? " settings-btn--active" : ""}`}
                  onClick={() => void setCastDevice(castDevice?.baseUrl === r.baseUrl ? null : r)}
                >
                  {castDevice?.baseUrl === r.baseUrl ? `✓ ${r.name}` : r.name}
                </button>
              ))}
            </div>
          </SettingRow>
        </section>
      )}

      {show("waveform", "display", "progress bar", "album", "suffix", "bracket", "edition") && (
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
          <SettingRow
            title="Show album edition suffixes"
            description='Show trailing parenthetical info in album names — e.g. "(clean)", "(24-bit / 44.1kHz)", "(Deluxe Edition)".'
          >
            <input
              type="checkbox"
              checked={showAlbumSuffixes}
              onChange={(e) => void setShowAlbumSuffixes(e.target.checked)}
            />
          </SettingRow>
        </section>
      )}
    </>
  );
}
